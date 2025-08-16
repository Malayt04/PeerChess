/* eslint-disable @typescript-eslint/no-explicit-any */
import { Device } from "mediasoup-client";
import { Consumer, Producer, Transport } from "mediasoup-client/types";

export class MediaSoupService {
    private device: Device;
    private socket: WebSocket;
    private gameId: string;
    private sendTransport: Transport | null = null;
    private recvTransport: Transport | null = null;
    private producers = new Map<string, Producer>();
    private consumers = new Map<string, Consumer>();
    private remoteStream: MediaStream = new MediaStream();
    private localStream: MediaStream | null = null;
    private eventListeners = new Map<string, (...args: any[]) => void>();
    private messageHandler: (event: MessageEvent) => void;

    constructor(socket: WebSocket, gameId: string) {
        this.device = new Device();
        this.socket = socket;
        this.gameId = gameId;
        
        // Create message handler that can be removed later
        this.messageHandler = (event: MessageEvent) => {
            this.handleMessage(event);
        };
        
        // Add the message event listener
        this.socket.addEventListener('message', this.messageHandler);
    }

    public on(event: string, listener: (...args: any[]) => void) {
        this.eventListeners.set(event, listener);
    }

    private emit(event: string, ...args: any[]) {
        this.eventListeners.get(event)?.(...args);
    }

    private sendRequest(type: string, payload: any) {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type, payload }));
        }
    }

    private async handleMessage(event: MessageEvent) {
        try {
            const { type, payload } = JSON.parse(event.data);
            
            switch (type) {
                case "GET_ROUTER_RTP_CAPABILITIES":
                    await this.device.load({ routerRtpCapabilities: payload });
                    await this.createTransports();
                    break;
                    
                case "CREATE_WEBRTC_TRANSPORT":
                    await this.setupTransport(payload);
                    break;
                    
                case "NEW_PRODUCER":
                    await this.consume(payload.producerId);
                    break;
                    
                case "CONSUME":
                    const consumer = await this.recvTransport?.consume(payload);
                    if (consumer) {
                        this.consumers.set(consumer.id, consumer);
                        this.remoteStream.addTrack(consumer.track);
                        this.emit('remoteStream', this.remoteStream);
                        this.sendRequest("RESUME", { gameId: this.gameId, consumerId: consumer.id });
                    }
                    break;
                    
                case "CONNECT_WEBRTC_TRANSPORT":
                    // This is an acknowledgment, no action needed
                    break;
                    
                case "PRODUCE":
                    // This is an acknowledgment, no action needed
                    break;
            }
        } catch (error) {
            console.error("Error handling message:", error);
        }
    }

    public async joinRoom(localStream: MediaStream) {
        this.localStream = localStream;
        this.sendRequest("GET_ROUTER_RTP_CAPABILITIES", { gameId: this.gameId });
    }

    private async createTransports() {
        this.sendRequest("CREATE_WEBRTC_TRANSPORT", { gameId: this.gameId, isSender: true });
        this.sendRequest("CREATE_WEBRTC_TRANSPORT", { gameId: this.gameId, isSender: false });
    }

    private async setupTransport(payload: any) {
        if (payload.isSender) {
            if (this.sendTransport) {
                console.warn("Send transport already exists");
                return;
            }
            
            this.sendTransport = this.device.createSendTransport(payload);
            
            this.sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
                this.sendRequest("CONNECT_WEBRTC_TRANSPORT", { 
                    gameId: this.gameId, 
                    transportId: this.sendTransport?.id, 
                    dtlsParameters 
                });
                
                // Wait for acknowledgment
                const connectHandler = (event: MessageEvent) => {
                    const { type } = JSON.parse(event.data);
                    if (type === "CONNECT_WEBRTC_TRANSPORT") {
                        this.socket.removeEventListener('message', connectHandler);
                        callback();
                    }
                };
                this.socket.addEventListener('message', connectHandler);
            });
            
            this.sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
                this.sendRequest("PRODUCE", { 
                    gameId: this.gameId, 
                    transportId: this.sendTransport?.id, 
                    kind, 
                    rtpParameters 
                });
                
                // Wait for acknowledgment with producer ID
                const produceHandler = (event: MessageEvent) => {
                    const { type, payload } = JSON.parse(event.data);
                    if (type === "PRODUCE") {
                        this.socket.removeEventListener('message', produceHandler);
                        callback({ id: payload.id });
                    }
                };
                this.socket.addEventListener('message', produceHandler);
            });

            if (this.localStream) {
                this.startProducing(this.localStream);
            }
        } else {
            if (this.recvTransport) {
                console.warn("Receive transport already exists");
                return;
            }
            
            this.recvTransport = this.device.createRecvTransport(payload);
            
            this.recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
                this.sendRequest("CONNECT_WEBRTC_TRANSPORT", { 
                    gameId: this.gameId, 
                    transportId: this.recvTransport?.id, 
                    dtlsParameters 
                });
                
                // Wait for acknowledgment
                const connectHandler = (event: MessageEvent) => {
                    const { type } = JSON.parse(event.data);
                    if (type === "CONNECT_WEBRTC_TRANSPORT") {
                        this.socket.removeEventListener('message', connectHandler);
                        callback();
                    }
                };
                this.socket.addEventListener('message', connectHandler);
            });
        }
    }

    private async startProducing(stream: MediaStream) {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        if (videoTrack) {
            try {
                const videoProducer = await this.sendTransport.produce({ track: videoTrack });
                this.producers.set(videoProducer.id, videoProducer);
            } catch (error) {
                console.error("Error producing video:", error);
            }
        }
        
        if (audioTrack) {
            try {
                const audioProducer = await this.sendTransport.produce({ track: audioTrack });
                this.producers.set(audioProducer.id, audioProducer);
            } catch (error) {
                console.error("Error producing audio:", error);
            }
        }
    }

    private async consume(producerId: string) {
        if (this.recvTransport && this.device.rtpCapabilities) {
            this.sendRequest("CONSUME", {
                gameId: this.gameId,
                transportId: this.recvTransport.id,
                producerId,
                rtpCapabilities: this.device.rtpCapabilities,
            });
        }
    }

    public close() {
        // Remove the message event listener
        this.socket.removeEventListener('message', this.messageHandler);
        
        // Close transports
        this.sendTransport?.close();
        this.recvTransport?.close();
        
        // Close producers
        this.producers.forEach(producer => producer.close());
        this.producers.clear();
        
        // Close consumers
        this.consumers.forEach(consumer => consumer.close());
        this.consumers.clear();
    }
}