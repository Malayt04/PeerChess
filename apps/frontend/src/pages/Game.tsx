import { Button } from '@/components/ui/button';
import { useSocket } from '@/hooks/useSocket';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@radix-ui/react-alert-dialog';
import { configuration } from '@/lib/ice-candidates';



function Game() {
    
    const socket = useSocket();
    
    const [chess, setChess] = useState(new Chess());
    const [started, setStarted] = useState(false);
    const colorRef = useRef<string>('white');
    const [error, setError] = useState<string | null>(null);
    const [resignDialogOpen, setResignDialogOpen] = useState(false);
    const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 0);
    const [whiteMinute, setWhiteMinute] = useState(10);
    const [whiteSecond, setWhiteSecond] = useState(0);
    const [blackMinute, setBlackMinute] = useState(10);
    const [blackSecond, setBlackSecond] = useState(0);
    const [waiting, setWaiting] = useState(false);

    const [messages, setMessages] = useState<Array<{text: string, sender: string, timestamp: string}>>([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const socketRef = useRef<WebSocket | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const handleMessage = useCallback(async (event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data);

            switch (data.type) {
                case 'INIT_GAME':
                    colorRef.current = data.payload.color;
                    setWaiting(false);
                    setStarted(true);
                    break;

                case 'MOVE':
                    setChess(prev => {
                        const newChess = new Chess(prev.fen());
                        newChess.move(data.payload.move);
                        return newChess;
                    });
                    break;

                case 'CLOCK_UPDATE':
                    handleClock(data.payload);
                    break;
                
                case 'MESSAGE':
                    handleChat(data.payload);
                    break;

                case 'GAME_OVER':
                    setStarted(false);
                    handleGameOver(data.payload.winner);
                    socket?.close();
                    break;

                case 'WEBRTC_OFFER':
                    console.log('Received offer:', data.payload);
                    await handleOffer(data.payload);
                    break;

                case 'WEBRTC_ANSWER':
                    console.log('Received answer:', data.payload);
                    await handleAnswer(data.payload);
                    break;

                case 'ICE_CANDIDATE':
                    console.log('Received ICE candidate:', data.payload);
                    await handleIceCandidate(data.payload);
                    break;

                default:
                    console.warn('Unhandled message type:', data.type);
                    break;
            }
        } catch (err) {
            console.error("Error processing message:", err);
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (!socket) return;
        
        console.log("Socket connected:", socket.readyState);
        socketRef.current = socket;
        socket.addEventListener('message', handleMessage);
        
        return () => {
            socket.removeEventListener('message', handleMessage);
        };
    }, [socket, handleMessage]);
    
    const initializeWebRTC = async () => {
        try {
            // Close any existing connection
            if (pcRef.current) {
                pcRef.current.close();
            }
            
            // Stop any existing tracks
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
            
            const pc = new RTCPeerConnection(configuration);
            pcRef.current = pc;

            // Try to get media with video first, fallback to audio only
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: true, 
                    audio: true 
                });
                localStreamRef.current = stream;
            } catch (err) {
                console.warn('Could not get video, trying audio only:', err);
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({ 
                        audio: true 
                    });
                    localStreamRef.current = audioStream;
                    setError('Video access denied, using audio only');
                } catch (audioErr) {
                    console.error('Could not get audio either:', audioErr);
                    setError('Media access completely denied');
                    throw audioErr;
                }
            }

            if (localVideoRef.current && localStreamRef.current) {
                localVideoRef.current.srcObject = localStreamRef.current;
            }

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => {
                    pc.addTrack(track, localStreamRef.current!);
                });
            }

            pc.ontrack = event => {
                console.log('Remote stream received:', event.streams[0]);
                if (remoteVideoRef.current && event.streams[0]) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
            };

            pc.onicecandidate = event => {
                if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN) {
                    console.log('Sending ICE candidate:', event.candidate);
                    socketRef.current.send(JSON.stringify({
                        type: 'ICE_CANDIDATE',
                        payload: event.candidate,
                    }));
                } else if (!event.candidate) {
                    console.log('End of ICE candidates');
                }
            };

            pc.onconnectionstatechange = () => {
                console.log('Connection state changed:', pc.connectionState);
                if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                    console.log('Connection failed or disconnected, attempting to restart ICE');
                    pc.restartIce();
                }
            };

            pc.oniceconnectionstatechange = () => {
                console.log('ICE connection state changed:', pc.iceConnectionState);
                if (pc.iceConnectionState === 'failed') {
                    console.log('ICE connection failed, restarting...');
                    pc.restartIce();
                }
            };

            // Add signaling state change monitoring
            pc.onsignalingstatechange = () => {
                console.log('Signaling state changed:', pc.signalingState);
            };

            if (colorRef.current === 'white') {
                setTimeout(async () => {
                    try {
                        const offer = await pc.createOffer();
                        console.log('Created offer:', offer);
                        await pc.setLocalDescription(offer);
                        console.log('Set local description (offer)');

                        // Wait for ICE gathering to complete or timeout after 2 seconds
                        await new Promise<void>((resolve) => {
                            const checkState = () => {
                                if (pc.iceGatheringState === 'complete') {
                                    resolve();
                                }
                            };
                            
                            pc.onicegatheringstatechange = checkState;
                            checkState();
                            
                            // Timeout to prevent waiting indefinitely
                            setTimeout(resolve, 2000);
                        });

                        if (socketRef.current?.readyState === WebSocket.OPEN) {
                            console.log('Sending offer via WebSocket');
                            socketRef.current.send(JSON.stringify({
                                type: 'WEBRTC_OFFER',
                                payload: pc.localDescription,
                            }));
                        } else {
                            console.error('WebSocket not ready for sending offer');
                            setError('Connection issue: WebSocket not ready');
                        }
                    } catch (err) {
                        console.error('Error creating offer:', err);
                        setError('Failed to create offer: ' + err.message);
                    }
                }, 1000);
            }
        } catch (err) {
            console.error('Error initializing WebRTC:', err);
            setError('Failed to start video call: ' + err.message);
        }
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
        if (!pcRef.current) {
            console.error("PeerConnection not initialized when handling offer");
            return;
        }
        
        const activeSocket = socketRef.current;
        if (!activeSocket) {
            console.error("WebSocket is not available when handling the offer");
            return;
        }

        try {
            console.log('Setting remote description (offer):', offer);
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('Remote description set successfully');
            
            const answer = await pcRef.current.createAnswer();
            console.log('Created answer:', answer);
            await pcRef.current.setLocalDescription(answer);
            console.log('Set local description (answer)');

            // Wait a short time for ICE candidates to gather
            await new Promise(resolve => setTimeout(resolve, 500));

            if (activeSocket?.readyState === WebSocket.OPEN) {
                console.log('Sending answer via WebSocket');
                activeSocket.send(JSON.stringify({
                    type: 'WEBRTC_ANSWER',
                    payload: pcRef.current.localDescription,
                }));
            } else {
                console.error('WebSocket not ready for sending answer');
                setError('Connection issue: WebSocket not ready');
            }
        } catch (err) {
            console.error('Error handling offer:', err);
            setError('Failed to process offer: ' + err.message);
        }
    };

    const closeWebRTCConnection = () => {
        console.log('Closing WebRTC connection...');
        
        // 1. Remove all event listeners from peer connection
        if (pcRef.current) {
            if (pcRef.current.onicecandidate) 
                pcRef.current.removeEventListener('icecandidate', pcRef.current.onicecandidate);
            
            if (pcRef.current.ontrack)
                pcRef.current.removeEventListener('track', pcRef.current.ontrack);
            
            if (pcRef.current.onnegotiationneeded)
                pcRef.current.removeEventListener('negotiationneeded', pcRef.current.onnegotiationneeded);
                
            if (pcRef.current.oniceconnectionstatechange)
                pcRef.current.removeEventListener('iceconnectionstatechange', pcRef.current.oniceconnectionstatechange);
                
            if (pcRef.current.onsignalingstatechange)
                pcRef.current.removeEventListener('signalingstatechange', pcRef.current.onsignalingstatechange);
                
            if (pcRef.current.onconnectionstatechange)
                pcRef.current.removeEventListener('connectionstatechange', pcRef.current.onconnectionstatechange);
            
            // 2. Close the peer connection
            pcRef.current.close();
            console.log('Peer connection closed');
        }
        
        // 3. Stop all tracks in the local stream
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                track.stop();
                console.log('Media track stopped:', track.kind);
            });
        }
        
        // 4. Clear video elements
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }
        
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }
        
        // 5. Release references for garbage collection
        pcRef.current = null;
        localStreamRef.current = null;
        
        console.log('WebRTC connection cleanup completed');
    };
    

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
        if (!pcRef.current) {
            console.error("PeerConnection not initialized when handling answer");
            return;
        }
    
        try {
            console.log("Current Signaling State:", pcRef.current.signalingState);
            
            // Only set remote description if we're in the right state
            if (pcRef.current.signalingState === "have-local-offer") {
                console.log("Setting remote description (answer):", answer);
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                console.log("Remote description set successfully");
            } else {
                console.error("Cannot set remote answer in state:", pcRef.current.signalingState);
                // Consider resetting the connection here
            }
        } catch (err) {
            console.error("Error setting remote description:", err);
            setError("Failed to set remote description: " + err.message);
        }
    };
    
    const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
        if (!pcRef.current) return;
        
        try {
            if (candidate && candidate.candidate) {
                console.log('Adding ICE candidate:', candidate);
                await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('ICE candidate added successfully');
            } else {
                console.log('End of candidates');
            }
        } catch (err) {
            console.error('Error adding ICE candidate:', err);
        }
    };

    const makeMove = useCallback((move: { from: string; to: string }) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'MOVE',
                payload: { move },
            }));
        } else {
            console.error('WebSocket not ready for sending move');
            setError('Connection issue: Cannot send move');
        }
    }, []);

    const onDrop = useCallback((source: string, target: string) => {
        const newChess = new Chess(chess.fen());
        const move = newChess.move({ from: source, to: target });

        if (!move) return false;
        makeMove(move);
        return true;
    }, [chess, makeMove]);

    const handlePlay = useCallback(() => {
        if (!socket) {
            console.error("WebSocket not connected yet.");
            setError("Connection issue: WebSocket not connected");
            return;
        }
    
        socket.send(JSON.stringify({ type: 'INIT_GAME' }));
        setWaiting(true);
        initializeWebRTC();
    }, [socket]);

    useEffect(() => {
        return () => {
            if (pcRef.current) {
                pcRef.current.close();
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleResign = () => {
        setResignDialogOpen(true);
    };

    const confirmResign = () => {
        const winner = colorRef.current === 'white' ? 'black' : 'white';
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'GAME_OVER',
                payload: { winner },
            }));
        }
        handleGameOver(winner);
        closeWebRTCConnection()
        setChess(new Chess())
        
    };

    const handleGameOver = (winner: string) => {
        alert(`${winner} won the game.`);
        setStarted(false);

        closeWebRTCConnection()
        setChess(new Chess())
    };


        
        const handleClock = (data: {
            white: number;
            black: number;
        }) => {
            const whiteMinutes = Math.floor(data.white / 60);
            const whiteSeconds = data.white % 60;
            
            const blackMinutes = Math.floor(data.black / 60);
            const blackSeconds = data.black % 60;
            
            setWhiteMinute(whiteMinutes);
            setWhiteSecond(whiteSeconds);
            
            setBlackMinute(blackMinutes);
            setBlackSecond(blackSeconds);
        };
        


    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (newMessage.trim()) {
            setMessages(prev => [...prev, {
                text: newMessage,
                sender: 'me',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
            
            sendMessage();
        }
    };

    const handleChat = (message: string) => {
        setMessages(prev => [...prev, {
            text: message,
            sender: 'opponent',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
    }

    const sendMessage = () => {
        if(newMessage.trim() === '') {
            return;
        }

        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'MESSAGE',
                payload: newMessage,
            }));
            setNewMessage('');
        } else {
            console.error('WebSocket not ready for sending message');
            setError('Connection issue: Cannot send message');
        }
    } 

    return (
        <div className="flex flex-col min-h-screen bg-[#312E2B] text-white p-4">
            {error && <div className="bg-red-500 text-white p-4 mb-4 rounded">{error}</div>}

            <div className="flex justify-center items-center flex-1">
                <div className="flex gap-4 items-center">
                    {/* Local Player Section */}
                    <div className="w-1/2 flex flex-col gap-2">
                        <div className="bg-[#272522] text-amber-500 text-4xl font-bold text-center p-4 rounded-lg shadow-lg">
                            {colorRef.current === 'white' ? whiteMinute + ":"  + whiteSecond : blackMinute + ":" +blackSecond}
                        </div>
                        <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video">
                            <video ref={localVideoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                        </div>
                    </div>
                    
                    <div className="w-1/2">
                        <Chessboard
                            position={chess.fen()}
                            onPieceDrop={onDrop}
                            boardWidth={Math.min(windowWidth * 0.4, 600)}
                            boardOrientation={colorRef.current as 'white' | 'black'}
                            customBoardStyle={{
                                borderRadius: "8px",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            }}
                        />
                    </div>
                    
                    <div className="w-1/2 flex flex-col gap-2">
                        <div className="bg-[#272522] text-amber-500 text-4xl font-bold text-center p-4 rounded-lg shadow-lg">
                            {colorRef.current === 'white' ? blackMinute + ":" +blackSecond : whiteMinute + ":"  + whiteSecond}
                        </div>
                        <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video">
                            <video ref={remoteVideoRef} className="w-full h-full object-cover" autoPlay playsInline />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-center gap-4 mt-4">
                <Button
                    onClick={handlePlay}
                    disabled={!socket || started}
                    className="px-8 py-4 text-lg bg-yellow-400 hover:bg-yellow-500 text-[#312E2B] transition-colors rounded-full"
                >
                    {!socket || waiting ? "Connecting..." : started && !waiting ? "Game Started" : "Start Match"}
                </Button>

                <div className="flex flex-col items-center gap-4 mt-4">
                    <Button onClick={handleResign} disabled={!started} className="px-8 py-4 text-lg bg-red-400 hover:bg-red-500">
                        Resign
                    </Button>
                </div>

            <AlertDialog open={resignDialogOpen} onOpenChange={setResignDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogTitle>Confirm Resignation</AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure you want to resign? Your opponent will be declared the winner.
                    </AlertDialogDescription>
                    <div className="flex justify-end gap-4 mt-4">
                        <AlertDialogCancel onClick={() => setResignDialogOpen(false)}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={confirmResign}>
                            Confirm
                        </AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>

        <div className="mt-8 w-full max-w-2xl mx-auto">
    <div className="bg-[#272522] rounded-lg p-4 shadow-xl">
      <div className="h-48 overflow-y-auto mb-4 space-y-3">
      <div className="h-48 overflow-y-auto mb-4 space-y-3 scrollbar-custom">
        {messages.map((msg, index) => (
          <div 
            key={index}
            className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-xs p-3 rounded-lg ${msg.sender === 'me' ? 'bg-[#538D4E] ml-auto' : 'bg-[#565452] mr-auto'}`}>
              <p className="text-sm text-gray-200">{msg.text}</p>
              <p className="text-xs text-gray-400 mt-1">{msg.timestamp}</p>
            </div>
          </div>
        ))}
          <div ref={messagesEndRef} />
          </div>
      </div>
      
      <form onSubmit={handleSendMessage} className="flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 bg-[#3A3937] text-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <Button
          type="submit"
          className="bg-amber-500 hover:bg-amber-600 text-[#312E2B] font-medium px-6 py-2"
          onClick={sendMessage}
        >
          Send
        </Button>
      </form>
    </div>
  </div>
    </div>
);
}

export default Game;