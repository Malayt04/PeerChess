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
    private pendingCallbacks = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timeout: NodeJS.Timeout }>();

    constructor(socket: WebSocket, gameId: string) {
        this.device = new Device();
        this.socket = socket;
        this.gameId = gameId;
    }

    public on(event: string, listener: (...args: any[]) => void) {
        this.eventListeners.set(event, listener);
    }

    private emit(event: string, ...args: any[]) {
        const listener = this.eventListeners.get(event);
        if (listener) {
            listener(...args);
        }
    }

    private sendRequest(type: string, payload: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.socket.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const requestId = `${type}-${Date.now()}-${Math.random()}`;
            
            // Set up timeout - increased from 10s to 30s for router capabilities
            const timeoutMs = type === "GET_ROUTER_RTP_CAPABILITIES" ? 30000 : 15000;
            const timeout = setTimeout(() => {
                this.pendingCallbacks.delete(requestId);
                reject(new Error(`Request timeout for ${type} (${timeoutMs}ms)`));
            }, timeoutMs);

            this.pendingCallbacks.set(requestId, { resolve, reject, timeout });

            console.log(`Sending ${type} request with ID ${requestId}`, payload);
            this.socket.send(JSON.stringify({ 
                type, 
                payload: { ...payload, requestId }
            }));
        });
    }

    public handleMessage(data: any) {
        const { type, payload } = data;
        
        console.log(`MediaSoup handling message: ${type}`, payload);
        
        // Handle responses with requestId
        if (payload?.requestId) {
            const callback = this.pendingCallbacks.get(payload.requestId);
            if (callback) {
                clearTimeout(callback.timeout);
                this.pendingCallbacks.delete(payload.requestId);
                console.log(`Resolving request ${payload.requestId} with response:`, payload);
                
                // For GET_ROUTER_RTP_CAPABILITIES, the payload itself contains the RTP capabilities
                if (type === "GET_ROUTER_RTP_CAPABILITIES") {
                    // Remove requestId from payload before resolving
                    const { requestId, ...rtpCapabilities } = payload;
                    callback.resolve(rtpCapabilities);
                } else {
                    callback.resolve(payload);
                }
                return;
            }
        }
        
        // Handle broadcast messages (without requestId)
        switch (type) {
            case "NEW_PRODUCER":
                this.handleNewProducer(payload);
                break;
                
            case "CONSUME":
                this.handleConsume(payload);
                break;
                
            default:
                console.log(`Unhandled MediaSoup message: ${type}`, payload);
                break;
        }
    }

    private async handleRouterRtpCapabilities(rtpCapabilities: any) {
        try {
            await this.device.load({ routerRtpCapabilities: rtpCapabilities });
            console.log('Device loaded with RTP capabilities');
        } catch (error) {
            console.error('Failed to load device:', error);
        }
    }

    private handleCreateWebRtcTransport(payload: any) {
        // The callback will be handled by the promise resolution
    }

    private async handleNewProducer(payload: { producerId: string }) {
        console.log('New producer available:', payload.producerId);
        await this.consume(payload.producerId);
    }

    private async handleConsume(payload: any) {
        try {
            if (!this.recvTransport) {
                console.error('Receive transport not available');
                return;
            }

            const consumer = await this.recvTransport.consume({
                id: payload.id,
                producerId: payload.producerId,
                kind: payload.kind,
                rtpParameters: payload.rtpParameters,
            });

            this.consumers.set(consumer.id, consumer);
            
            // Add track to remote stream
            this.remoteStream.addTrack(consumer.track);
            console.log('Added track to remote stream:', consumer.kind);
            
            // Emit remote stream update
            this.emit('remoteStream', this.remoteStream);
            
            // Resume the consumer
            try {
                await this.sendRequest("RESUME", { 
                    gameId: this.gameId, 
                    consumerId: consumer.id 
                });
                console.log('Consumer resumed:', consumer.id);
            } catch (error) {
                console.error('Failed to resume consumer:', error);
            }
        } catch (error) {
            console.error('Error consuming:', error);
        }
    }

    public async joinRoom(localStream: MediaStream) {
        try {
            this.localStream = localStream;
            
            // Step 1: Get router RTP capabilities
            console.log('Getting router RTP capabilities...');
            const rtpCapabilities = await this.sendRequest("GET_ROUTER_RTP_CAPABILITIES", { 
                gameId: this.gameId 
            });
            
            await this.device.load({ routerRtpCapabilities: rtpCapabilities });
            console.log('Device loaded successfully');
            
            // Step 2: Create transports
            await this.createTransports();
            
            // Step 3: Start producing
            await this.startProducing();
            
            console.log('Successfully joined room');
        } catch (error) {
            console.error('Failed to join room:', error);
            throw error;
        }
    }

    private async createTransports() {
        try {
            // Create send transport
            console.log('Creating send transport...');
            const sendTransportInfo = await this.sendRequest("CREATE_WEBRTC_TRANSPORT", { 
                gameId: this.gameId 
            });
            
            this.sendTransport = this.device.createSendTransport({
                id: sendTransportInfo.id,
                iceParameters: sendTransportInfo.iceParameters,
                iceCandidates: sendTransportInfo.iceCandidates,
                dtlsParameters: sendTransportInfo.dtlsParameters,
            });

            // Create receive transport
            console.log('Creating receive transport...');
            const recvTransportInfo = await this.sendRequest("CREATE_WEBRTC_TRANSPORT", { 
                gameId: this.gameId 
            });
            
            this.recvTransport = this.device.createRecvTransport({
                id: recvTransportInfo.id,
                iceParameters: recvTransportInfo.iceParameters,
                iceCandidates: recvTransportInfo.iceCandidates,
                dtlsParameters: recvTransportInfo.dtlsParameters,
            });

            // Set up transport event handlers
            this.setupTransportEvents();
            
            console.log('Transports created successfully');
        } catch (error) {
            console.error('Failed to create transports:', error);
            throw error;
        }
    }

    private setupTransportEvents() {
        if (this.sendTransport) {
            this.sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
                try {
                    console.log('Connecting send transport...');
                    await this.sendRequest("CONNECT_WEBRTC_TRANSPORT", {
                        gameId: this.gameId,
                        transportId: this.sendTransport!.id,
                        dtlsParameters,
                    });
                    callback();
                    console.log('Send transport connected');
                } catch (error) {
                    console.error('Failed to connect send transport:', error);
                    errback(error);
                }
            });

            this.sendTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
                try {
                    console.log('Producing', kind);
                    const result = await this.sendRequest("PRODUCE", {
                        gameId: this.gameId,
                        transportId: this.sendTransport!.id,
                        kind,
                        rtpParameters,
                    });
                    callback({ id: result.id });
                    console.log('Producer created:', result.id);
                } catch (error) {
                    console.error('Failed to produce:', error);
                    errback(error);
                }
            });
        }

        if (this.recvTransport) {
            this.recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
                try {
                    console.log('Connecting receive transport...');
                    await this.sendRequest("CONNECT_WEBRTC_TRANSPORT", {
                        gameId: this.gameId,
                        transportId: this.recvTransport!.id,
                        dtlsParameters,
                    });
                    callback();
                    console.log('Receive transport connected');
                } catch (error) {
                    console.error('Failed to connect receive transport:', error);
                    errback(error);
                }
            });
        }
    }

    private async startProducing() {
        if (!this.sendTransport || !this.localStream) {
            console.error('Send transport or local stream not available');
            return;
        }

        try {
            const videoTrack = this.localStream.getVideoTracks()[0];
            const audioTrack = this.localStream.getAudioTracks()[0];

            if (videoTrack) {
                console.log('Producing video track...');
                const videoProducer = await this.sendTransport.produce({ track: videoTrack });
                this.producers.set(videoProducer.id, videoProducer);
                console.log('Video producer created:', videoProducer.id);
            }

            if (audioTrack) {
                console.log('Producing audio track...');
                const audioProducer = await this.sendTransport.produce({ track: audioTrack });
                this.producers.set(audioProducer.id, audioProducer);
                console.log('Audio producer created:', audioProducer.id);
            }
        } catch (error) {
            console.error('Failed to start producing:', error);
            throw error;
        }
    }

    private async consume(producerId: string) {
        if (!this.recvTransport || !this.device.rtpCapabilities) {
            console.error('Receive transport or RTP capabilities not available');
            return;
        }

        try {
            console.log('Consuming producer:', producerId);
            await this.sendRequest("CONSUME", {
                gameId: this.gameId,
                transportId: this.recvTransport.id,
                producerId,
                rtpCapabilities: this.device.rtpCapabilities,
            });
        } catch (error) {
            console.error('Failed to consume:', error);
        }
    }

    public close() {
        console.log('Closing MediaSoup service');
        
        // Clear pending callbacks
        this.pendingCallbacks.forEach(({ timeout }) => {
            clearTimeout(timeout);
        });
        this.pendingCallbacks.clear();
        
        // Close transports
        if (this.sendTransport) {
            this.sendTransport.close();
            this.sendTransport = null;
        }
        
        if (this.recvTransport) {
            this.recvTransport.close();
            this.recvTransport = null;
        }
        
        // Close producers
        this.producers.forEach(producer => producer.close());
        this.producers.clear();
        
        // Close consumers
        this.consumers.forEach(consumer => consumer.close());
        this.consumers.clear();
        
        // Clear event listeners
        this.eventListeners.clear();
    }
}