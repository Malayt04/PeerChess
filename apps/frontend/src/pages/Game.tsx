import { Button } from '@/components/ui/button';
import { useSocket } from '@/hooks/useSocket';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@radix-ui/react-alert-dialog';


const configuration = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    ],
    iceCandidatePoolSize: 10,
};

function Game() {

    const socket = useSocket();
    console.log(socket)
    const [chess, setChess] = useState(new Chess());
    const [started, setStarted] = useState(false);
    const colorRef = useRef<string>('white');
    const [error, setError] = useState<string | null>(null);
    const [resignDialogOpen, setResignDialogOpen] = useState(false);
    const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 0)
    const [whiteClock, setWhiteClock] = useState(600)
    const [blackClock, setBlackClock] = useState(600)
    const [waiting, setWaiting] = useState(false)

    const [messages, setMessages] = useState<Array<{text: string, sender: string, timestamp: string}>>([]);
      const [newMessage, setNewMessage] = useState('');

      const messagesEndRef = useRef<HTMLDivElement>(null);

const scrollToBottom = () => {
  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
};
    

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const socketRef = useRef<WebSocket | null>(null);

    const handleMessage = useCallback(async (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);

        switch (data.type) {
            case 'INIT_GAME':
                colorRef.current = data.payload.color;
                setWaiting(false)
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
                handleClock(data.payload)
                break;
            
            case 'MESSAGE':
                handleChat(data.payload)
                break;
            case 'GAME_OVER':
                setStarted(false);
                handleGameOver(data.payload.winner)
                socket?.close()
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
    }, []);

    
    useEffect(() => {
        scrollToBottom();
      }, [messages]);

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth)
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
      }, [])

    useEffect(() => {
        if (!socket) return;
        
        console.log(socket)
        socketRef.current = socket
        socket.addEventListener('message', handleMessage);

    }, [socket, handleMessage]);
    

    const initializeWebRTC = async () => {
        try {
            const pc = new RTCPeerConnection(configuration);
            pcRef.current = pc;

            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                .catch(err => {
                    console.error('Error accessing media devices:', err);
                    setError('Camera/microphone access denied');
                    throw err;
                });

            localStreamRef.current = stream;

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
            });

            pc.ontrack = event => {
                console.log('Remote stream received:', event.streams[0]);
                if (remoteVideoRef.current && event.streams[0]) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
            };

            pc.onicecandidate = event => {
                if (event.candidate && socket?.readyState === WebSocket.OPEN) {
                    console.log('Sending ICE candidate:', event.candidate);
                    socket.send(JSON.stringify({
                        type: 'ICE_CANDIDATE',
                        payload: event.candidate,
                    }));
                }
            };

            pc.onconnectionstatechange = () => {
                console.log('Connection state changed:', pc.connectionState);
            };

            pc.oniceconnectionstatechange = () => {
                if (pc.iceConnectionState === 'failed') {
                    console.log('ICE connection failed, restarting...');
                    pc.restartIce();
                }
            };

            if (colorRef.current === 'white') {
                setTimeout(async () => {
                    try {
                        const offer = await pc.createOffer();
                        console.log('Sending offer:', offer);
                        await pc.setLocalDescription(offer);

                        console.log(socket)

                            socket?.send(JSON.stringify({
                                type: 'WEBRTC_OFFER',
                                payload: offer,
                            }));

                    } catch (err) {
                        console.error('Error creating offer:', err);
                        setError('Failed to create offer');
                    }
                }, 1000);
            }
        } catch (err) {
            console.error('Error initializing WebRTC:', err);
            setError('Failed to start video call');
        }
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
        if (!pcRef.current) return;
        const activeSocket = socketRef.current;

        if (!activeSocket) {
            console.error("WebSocket is not available when handling the offer");
            return;
        }

        try {
            console.log("................................................................................................................................................................")
            console.log('Setting remote description (offer):', offer);
            await pcRef.current.setRemoteDescription(offer);
            const answer = await pcRef.current.createAnswer();
            console.log('Sending answer:', answer);
            await pcRef.current.setLocalDescription(answer);

            console.log("Socket value: ", socket)

            if (activeSocket?.readyState === WebSocket.OPEN) {
                activeSocket.send(JSON.stringify({
                    type: 'WEBRTC_ANSWER',
                    payload: answer,
                }));
            } else {
                console.error('WebSocket not ready for sending answer');
            }
        } catch (err) {
            console.error('Error handling offer:', err);
            setError('Failed to process offer');
        }
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
        if (!pcRef.current) return;
    
        try {
            console.log("answer received: ........................", answer)
            console.log("Current Signaling State:", pcRef.current.signalingState);
    
            if (pcRef.current.signalingState !== "have-local-offer") {
                console.error(
                    "Invalid state for setting remote answer:",
                    pcRef.current.signalingState
                );
                return;
            }
    
            console.log("Setting remote description (answer):", answer);
            await pcRef.current.setRemoteDescription(answer);
    
        } catch (err) {
            console.error("Error setting remote description:", err);
            setError("Failed to set remote description");
        }
    };
    
    const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
        if (!pcRef.current) return;
        try {
            if (candidate.candidate) {
                console.log('Adding ICE candidate:', candidate);
                await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                console.warn('Received empty ICE candidate');
            }
        } catch (err) {
            console.error('Error adding ICE candidate:', err);
        }
    };

    const makeMove = useCallback((move: { from: string; to: string }) => {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'MOVE',
                payload: { move },
            }));
        } else {
            console.error('WebSocket not ready for sending move');
        }
    }, [socket]);

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
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'GAME_OVER',
                payload: { winner },
            }));
        }
        handleGameOver(winner);
    };

    const handleGameOver = (winner: string) => {
        alert(`${winner} won the game.`);
        setStarted(false);
    };

    const handleClock = (data:  {
        white: number;
        black: number;
    }
) => {
        setBlackClock(data.black);
        setWhiteClock(data.white);
    }

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (newMessage.trim()) {
          setMessages(prev => [...prev, {
            text: newMessage,
            sender: 'me',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
          setNewMessage('');
        }
      };

      const handleChat = (message: string) => {
        setMessages(prev => [...prev, {
          text: message,
          sender: 'opponent',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }])
      }

      const sendMessage = () => {
        if(newMessage.trim() === '') {
            return;
        }

        socket?.send(JSON.stringify({
            type: 'MESSAGE',
            payload: newMessage,
        }))
    } 

    return (
        <div className="flex flex-col min-h-screen bg-[#312E2B] text-white p-4">
        {error && <div className="bg-red-500 text-white p-4 mb-4 rounded">{error}</div>}

        <div className="flex justify-center items-center flex-1">
  <div className="flex gap-4 items-center">
    {/* Local Player Section */}
    <div className="w-1/2 flex flex-col gap-2">
      <div className="bg-[#272522] text-amber-500 text-4xl font-bold text-center p-4 rounded-lg shadow-lg">
        {colorRef.current === 'white' ? whiteClock : blackClock}
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
            {colorRef.current === 'white' ? blackClock : whiteClock}
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