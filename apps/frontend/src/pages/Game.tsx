import { Button } from '@/components/ui/button';
import { useSocket } from '@/hooks/useSocket';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@radix-ui/react-alert-dialog';

function Game() {
    const socket = useSocket();
    
    // Use FEN string instead of Chess instance to avoid unnecessary object recreation
    const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
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
    const [whiteClock, setWhiteClock] = useState(600);
    const [blackClock, setBlackClock] = useState(600);
    const [currentTurn, setCurrentTurn] = useState<'white' | 'black'>('white');
    
    // Chat functionality
    const [messages, setMessages] = useState<Array<{text: string, sender: string, timestamp: string}>>([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    const socketRef = useRef<WebSocket | null>(null);
    
    // Create Chess instance only when needed, memoized by FEN
    const chess = useMemo(() => new Chess(fen), [fen]);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    // Memoize time formatting to avoid recalculation
    const formatTime = useCallback((seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }, []);

    // Memoized formatted times
    const formattedWhiteTime = useMemo(() => formatTime(whiteClock), [whiteClock, formatTime]);
    const formattedBlackTime = useMemo(() => formatTime(blackClock), [blackClock, formatTime]);

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
                    // Only update FEN if it's actually different
                    if (data.payload.fen && data.payload.fen !== fen) {
                        setFen(data.payload.fen);
                    }
                    setCurrentTurn(data.payload.activePlayer || 'white');
                    setGameStatus(data.payload.isCheck ? 'Check!' : '');
                    break;

                case 'CLOCK_UPDATE':
                    // Batch clock updates to avoid multiple re-renders
                    const updates: any = {};
                    if (data.payload.whiteClock !== undefined && data.payload.whiteClock !== whiteClock) {
                        updates.whiteClock = data.payload.whiteClock;
                    }
                    if (data.payload.blackClock !== undefined && data.payload.blackClock !== blackClock) {
                        updates.blackClock = data.payload.blackClock;
                    }
                    if (data.payload.activePlayer && data.payload.activePlayer !== currentTurn) {
                        updates.currentTurn = data.payload.activePlayer;
                    }
                    
                    // Apply all updates at once
                    if (Object.keys(updates).length > 0) {
                        if (updates.whiteClock !== undefined) setWhiteClock(updates.whiteClock);
                        if (updates.blackClock !== undefined) setBlackClock(updates.blackClock);
                        if (updates.currentTurn !== undefined) setCurrentTurn(updates.currentTurn);
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
                        setFen(data.payload.fen);
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
    }, [fen, whiteClock, blackClock, currentTurn]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

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

        // Create a temporary chess instance to validate the move
        const tempChess = new Chess(fen);
        const move = tempChess.move({ from: source, to: target });

        if (!move) {
            setError("Invalid move!");
            setTimeout(() => setError(null), 3000);
            return false;
        }

        makeMove({ from: source, to: target });
        return true;
    }, [fen, makeMove, currentTurn, playerColor]);

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

    const handleResign = useCallback(() => {
        setResignDialogOpen(true);
    }, []);

    const confirmResign = useCallback(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'FORFEIT',
                payload: { gameId },
            }));
        }
        setResignDialogOpen(false);
    }, [gameId]);

    const handleOfferDraw = useCallback(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'DRAW_OFFER',
                payload: { gameId },
            }));
        }
        setGameStatus('Draw offer sent to opponent');
        setTimeout(() => setGameStatus(''), 3000);
    }, [gameId]);

    const acceptDraw = useCallback(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'DRAW_OFFER',
                payload: { gameId },
            }));
        }
        setDrawOfferDialogOpen(false);
    }, [gameId]);

    const declineDraw = useCallback(() => {
        setDrawOfferDialogOpen(false);
        // You might want to send a decline message to the backend
    }, []);

    const handleGameOver = useCallback((payload: any) => {
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
            setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
            setWhiteClock(600);
            setBlackClock(600);
            setGameStatus('');
            setGameId('');
        }, 5000);
    }, [playerColor]);

    const handleSendMessage = useCallback((e?: React.FormEvent | React.MouseEvent) => {
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
    }, [newMessage, gameId]);

    const handleIncomingMessage = useCallback((payload: any) => {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setMessages(prev => [...prev, {
            text: payload.message || payload,
            sender: 'opponent',
            timestamp
        }]);
    }, []);

    const resetGame = useCallback(() => {
        setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
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
    }, []);

    // Memoize board width calculation
    const boardWidth = useMemo(() => Math.min(windowWidth * 0.6, 600), [windowWidth]);

    // Memoize custom board style
    const customBoardStyle = useMemo(() => ({
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    }), []);

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
                        {playerColor === 'white' ? formattedBlackTime : formattedWhiteTime}
                    </div>

                    {/* Chess Board */}
                    <div className="relative">
                        <Chessboard
                            position={fen}
                            onPieceDrop={onDrop}
                            boardWidth={boardWidth}
                            boardOrientation={playerColor}
                            customBoardStyle={customBoardStyle}
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
                        {playerColor === 'white' ? formattedWhiteTime : formattedBlackTime}
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