import { Button } from '@/components/ui/button';
import { useSocket } from '@/hooks/useSocket';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@radix-ui/react-alert-dialog';

function Game() {
    const socket = useSocket();
    
    const [chess, setChess] = useState(new Chess());
    const [gameStarted, setGameStarted] = useState(false);
    const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white');
    const [gameId, setGameId] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [gameStatus, setGameStatus] = useState<string>('');
    const [resignDialogOpen, setResignDialogOpen] = useState(false);
    const [drawOfferDialogOpen, setDrawOfferDialogOpen] = useState(false);
    const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 0);
    const [waitingForOpponent, setWaitingForOpponent] = useState(false);
    
    // Clock state
    const [whiteClock, setWhiteClock] = useState(600); // 10 minutes in seconds
    const [blackClock, setBlackClock] = useState(600);
    const [currentTurn, setCurrentTurn] = useState<'white' | 'black'>('white');
    
    // Chat functionality
    const [messages, setMessages] = useState<Array<{text: string, sender: string, timestamp: string}>>([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    const socketRef = useRef<WebSocket | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Format time display
    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const handleMessage = useCallback(async (event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data);

            switch (data.type) {
                case 'INIT_GAME':
                    setPlayerColor(data.payload.color);
                    setGameId(data.payload.gameId || '');
                    setWaitingForOpponent(false);
                    setGameStarted(true);
                    setGameStatus(`Game started! You are playing as ${data.payload.color}`);
                    setError(null);
                    break;

                case 'MOVE':
                    setChess(prev => {
                        const newChess = new Chess(data.payload.fen || prev.fen());
                        return newChess;
                    });
                    setCurrentTurn(data.payload.activePlayer || 'white');
                    setGameStatus(data.payload.isCheck ? 'Check!' : '');
                    break;

                case 'CLOCK_UPDATE':
                    if (data.payload.whiteClock !== undefined) {
                        setWhiteClock(data.payload.whiteClock);
                    }
                    if (data.payload.blackClock !== undefined) {
                        setBlackClock(data.payload.blackClock);
                    }
                    if (data.payload.activePlayer) {
                        setCurrentTurn(data.payload.activePlayer);
                    }
                    break;

                case 'INVALID_MOVE':
                    setError(data.payload.message || 'Invalid move');
                    setTimeout(() => setError(null), 3000);
                    break;

                case 'INVALID_TURN':
                    setError(data.payload.message || "It's not your turn");
                    setTimeout(() => setError(null), 3000);
                    break;

                case 'GAME_OVER':
                    setGameStarted(false);
                    handleGameOver(data.payload);
                    break;

                case 'DRAW_OFFER':
                    setDrawOfferDialogOpen(true);
                    break;

                case 'MESSAGE':
                    handleIncomingMessage(data.payload);
                    break;

                case 'GAME_STATE':
                    // Handle reconnection
                    if (data.payload.isActive) {
                        setGameStarted(true);
                        setPlayerColor(data.payload.currentTurn === 'white' ? 'white' : 'black');
                        setChess(new Chess(data.payload.fen));
                        setWhiteClock(data.payload.clocks.white);
                        setBlackClock(data.payload.clocks.black);
                        setCurrentTurn(data.payload.currentTurn);
                    }
                    break;

                default:
                    console.warn('Unhandled message type:', data.type);
                    break;
            }
        } catch (err) {
            console.error("Error processing message:", err);
            setError("Failed to process server message");
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

    const makeMove = useCallback((move: { from: string; to: string }) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'MOVE',
                payload: { 
                    move,
                    gameId 
                },
            }));
        } else {
            console.error('WebSocket not ready for sending move');
            setError('Connection issue: Cannot send move');
        }
    }, [gameId]);

    const onDrop = useCallback((source: string, target: string) => {
        // Check if it's the player's turn
        if (currentTurn !== playerColor) {
            setError("It's not your turn!");
            setTimeout(() => setError(null), 3000);
            return false;
        }

        const newChess = new Chess(chess.fen());
        const move = newChess.move({ from: source, to: target });

        if (!move) {
            setError("Invalid move!");
            setTimeout(() => setError(null), 3000);
            return false;
        }

        makeMove({ from: source, to: target });
        return true;
    }, [chess, makeMove, currentTurn, playerColor]);

    const handlePlay = useCallback(() => {
        if (!socket) {
            console.error("WebSocket not connected yet.");
            setError("Connection issue: WebSocket not connected");
            return;
        }

        socket.send(JSON.stringify({ type: 'INIT_GAME' }));
        setWaitingForOpponent(true);
        setError(null);
        setGameStatus('Looking for an opponent...');
    }, [socket]);

    const handleResign = () => {
        setResignDialogOpen(true);
    };

    const confirmResign = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'FORFEIT',
                payload: { gameId },
            }));
        }
        setResignDialogOpen(false);
    };

    const handleOfferDraw = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'DRAW_OFFER',
                payload: { gameId },
            }));
        }
        setGameStatus('Draw offer sent to opponent');
        setTimeout(() => setGameStatus(''), 3000);
    };

    const acceptDraw = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'DRAW_OFFER',
                payload: { gameId },
            }));
        }
        setDrawOfferDialogOpen(false);
    };

    const declineDraw = () => {
        setDrawOfferDialogOpen(false);
        // You might want to send a decline message to the backend
    };

    const handleGameOver = (payload: any) => {
        const { winner, reason, finalFen } = payload;
        
        let message = '';
        if (winner === 'draw') {
            message = `Game ended in a draw: ${reason}`;
        } else if (winner === playerColor) {
            message = `You won! ${reason}`;
        } else {
            message = `You lost! ${reason}`;
        }
        
        setGameStatus(message);
        setGameStarted(false);
        setCurrentTurn('white');
        
        // Reset the board after a delay to show final position
        setTimeout(() => {
            setChess(new Chess());
            setWhiteClock(600);
            setBlackClock(600);
            setGameStatus('');
            setGameId('');
        }, 5000);
    };

    const handleSendMessage = (e?: React.FormEvent | React.MouseEvent) => {
        if (e) e.preventDefault();
        if (newMessage.trim() && socketRef.current?.readyState === WebSocket.OPEN) {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            setMessages(prev => [...prev, {
                text: newMessage,
                sender: 'me',
                timestamp
            }]);
            
            socketRef.current.send(JSON.stringify({
                type: 'MESSAGE',
                payload: { 
                    message: newMessage,
                    gameId 
                },
            }));
            
            setNewMessage('');
        }
    };

    const handleIncomingMessage = (payload: any) => {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setMessages(prev => [...prev, {
            text: payload.message || payload,
            sender: 'opponent',
            timestamp
        }]);
    };

    const resetGame = () => {
        setChess(new Chess());
        setGameStarted(false);
        setWaitingForOpponent(false);
        setPlayerColor('white');
        setGameId('');
        setError(null);
        setGameStatus('');
        setCurrentTurn('white');
        setWhiteClock(600);
        setBlackClock(600);
        setMessages([]);
    };

    return (
        <div className="flex flex-col min-h-screen bg-[#312E2B] text-white p-4">
            {error && (
                <div className="bg-red-500 text-white p-4 mb-4 rounded-lg shadow-lg">
                    {error}
                </div>
            )}

            {gameStatus && (
                <div className="bg-blue-500 text-white p-4 mb-4 rounded-lg shadow-lg text-center">
                    {gameStatus}
                </div>
            )}

            <div className="flex justify-center items-center flex-1">
                <div className="flex flex-col items-center gap-6">
                    
                    {/* Opponent's clock */}
                    <div className="bg-[#272522] text-amber-500 text-4xl font-bold text-center p-4 rounded-lg shadow-lg min-w-[200px]">
                        <div className="text-sm text-gray-400 mb-2">
                            {playerColor === 'white' ? 'Black' : 'White'}
                            {currentTurn !== playerColor && gameStarted && (
                                <span className="ml-2 text-green-400">●</span>
                            )}
                        </div>
                        {formatTime(playerColor === 'white' ? blackClock : whiteClock)}
                    </div>

                    {/* Chess Board */}
                    <div className="relative">
                        <Chessboard
                            position={chess.fen()}
                            onPieceDrop={onDrop}
                            boardWidth={Math.min(windowWidth * 0.6, 600)}
                            boardOrientation={playerColor}
                            customBoardStyle={{
                                borderRadius: "8px",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            }}
                        />
                        
                        {/* Turn indicator overlay */}
                        {gameStarted && (
                            <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white px-3 py-1 rounded-lg text-sm">
                                {currentTurn === playerColor ? "Your turn" : "Opponent's turn"}
                            </div>
                        )}
                    </div>

                    {/* Player's clock */}
                    <div className="bg-[#272522] text-amber-500 text-4xl font-bold text-center p-4 rounded-lg shadow-lg min-w-[200px]">
                        <div className="text-sm text-gray-400 mb-2">
                            You ({playerColor})
                            {currentTurn === playerColor && gameStarted && (
                                <span className="ml-2 text-green-400">●</span>
                            )}
                        </div>
                        {formatTime(playerColor === 'white' ? whiteClock : blackClock)}
                    </div>
                </div>
            </div>

            {/* Game Controls */}
            <div className="flex justify-center items-center gap-4 mt-6">
                {!gameStarted && !waitingForOpponent && (
                    <Button
                        onClick={handlePlay}
                        disabled={!socket}
                        className="px-8 py-4 text-lg bg-yellow-400 hover:bg-yellow-500 text-[#312E2B] transition-colors rounded-full font-bold"
                    >
                        {!socket ? "Connecting..." : "Find Match"}
                    </Button>
                )}

                {waitingForOpponent && (
                    <div className="flex items-center gap-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
                        <span className="text-lg">Waiting for opponent...</span>
                    </div>
                )}

                {gameStarted && (
                    <div className="flex gap-4">
                        <Button 
                            onClick={handleResign} 
                            className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg"
                        >
                            Resign
                        </Button>
                        <Button 
                            onClick={handleOfferDraw} 
                            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg"
                        >
                            Offer Draw
                        </Button>
                    </div>
                )}

                {(!gameStarted && !waitingForOpponent && gameId) && (
                    <Button
                        onClick={resetGame}
                        className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg"
                    >
                        New Game
                    </Button>
                )}
            </div>

            {/* Chat Section */}
            {gameStarted && (
                <div className="mt-8 w-full max-w-2xl mx-auto">
                    <div className="bg-[#272522] rounded-lg p-4 shadow-xl">
                        <h3 className="text-lg font-semibold mb-4 text-amber-500">Chat</h3>
                        <div className="h-48 overflow-y-auto mb-4 space-y-3">
                            {messages.map((msg, index) => (
                                <div 
                                    key={index}
                                    className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div className={`max-w-xs p-3 rounded-lg ${
                                        msg.sender === 'me' 
                                            ? 'bg-[#538D4E] ml-auto' 
                                            : 'bg-[#565452] mr-auto'
                                    }`}>
                                        <p className="text-sm text-gray-200">{msg.text}</p>
                                        <p className="text-xs text-gray-400 mt-1">{msg.timestamp}</p>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                        
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(e)}
                                placeholder="Type your message..."
                                className="flex-1 bg-[#3A3937] text-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                            <Button
                                onClick={handleSendMessage}
                                className="bg-amber-500 hover:bg-amber-600 text-[#312E2B] font-medium px-6 py-2"
                            >
                                Send
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Resign Confirmation Dialog */}
            <AlertDialog open={resignDialogOpen} onOpenChange={setResignDialogOpen}>
                <AlertDialogContent className="bg-[#272522] text-white border border-gray-600">
                    <AlertDialogTitle className="text-xl font-semibold text-amber-500">
                        Confirm Resignation
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-300 mt-2">
                        Are you sure you want to resign? Your opponent will be declared the winner.
                    </AlertDialogDescription>
                    <div className="flex justify-end gap-4 mt-6">
                        <AlertDialogCancel 
                            onClick={() => setResignDialogOpen(false)}
                            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg"
                        >
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={confirmResign}
                            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
                        >
                            Resign
                        </AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>

            {/* Draw Offer Dialog */}
            <AlertDialog open={drawOfferDialogOpen} onOpenChange={setDrawOfferDialogOpen}>
                <AlertDialogContent className="bg-[#272522] text-white border border-gray-600">
                    <AlertDialogTitle className="text-xl font-semibold text-amber-500">
                        Draw Offer
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-300 mt-2">
                        Your opponent has offered a draw. Do you accept?
                    </AlertDialogDescription>
                    <div className="flex justify-end gap-4 mt-6">
                        <AlertDialogCancel 
                            onClick={declineDraw}
                            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg"
                        >
                            Decline
                        </AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={acceptDraw}
                            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
                        >
                            Accept Draw
                        </AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default Game;