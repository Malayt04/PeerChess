import { Button } from "@/components/ui/button";
import { useSocket } from "@/hooks/useSocket";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Complete WebRTC Hook Implementation
function useWebRTC(gameId: string, socket: WebSocket | null) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isWebRTCReady, setIsWebRTCReady] = useState(false);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'failed'>('disconnected');
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const messageQueueRef = useRef<Array<{type: string, payload: any}>>([]);

  // Add message to queue for processing when WebRTC is ready
  const queueMessage = useCallback((type: string, payload: any) => {
    console.log(`[Client] Queuing message: ${type}`);
    messageQueueRef.current.push({ type, payload });
    console.log(`[Client] Queue size: ${messageQueueRef.current.length}`);
  }, []);

  const startWebRTC = useCallback(async () => {
    try {
      console.log("[Client] Starting WebRTC...");
      setConnectionState('connecting');
      
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });
      setLocalStream(stream);
      console.log("[Client] Local stream obtained");

      // Create peer connection
      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };
      
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;
      console.log("[Client] RTCPeerConnection created");

      // Add local stream to peer connection
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
        console.log("[Client] Track added to peer connection:", track.kind);
      });

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log("[Client] Received remote stream");
        setRemoteStream(event.streams[0]);
      };

      // Handle ICE candidates - FIXED: Check socket before sending
      peerConnection.onicecandidate = (event) => {
        console.log("[Client] ICE candidate event:", event.candidate ? "candidate" : "end-of-candidates");
        
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          console.error("[Client] Socket not available for ICE candidate");
          return;
        }

        if (event.candidate) {
          console.log("[Client] Sending ICE candidate to server");
          socket.send(JSON.stringify({
            type: 'ICE_CANDIDATE',
            payload: {
              candidate: event.candidate,
              gameId: gameId
            }
          }));
        } else {
          console.log("[Client] Sending end-of-candidates signal");
          socket.send(JSON.stringify({
            type: 'ICE_CANDIDATE',
            payload: {
              candidate: null,
              gameId: gameId
            }
          }));
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('[Client] Connection state:', peerConnection.connectionState);
        setConnectionState(peerConnection.connectionState as any);
        
        if (peerConnection.connectionState === 'connected') {
          console.log('[Client] WebRTC connection established!');
        } else if (peerConnection.connectionState === 'failed') {
          console.error('[Client] WebRTC connection failed');
          setConnectionState('failed');
        }
      };

      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        console.log('[Client] ICE connection state:', peerConnection.iceConnectionState);
      };

      setIsWebRTCReady(true);
      console.log("[Client] WebRTC setup complete");
    } catch (error) {
      console.error("[Client] Error starting WebRTC:", error);
      setConnectionState('failed');
      throw error;
    }
  }, [gameId, socket]);

  const createOffer = useCallback(async () => {
    console.log("[Client] createOffer called");
    
    if (!peerConnectionRef.current) {
      console.error("[Client] No peer connection available for offer");
      throw new Error("Peer connection not available");
    }
    
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("[Client] Socket not available for offer");
      throw new Error("Socket not available");
    }

    try {
      console.log("[Client] Creating offer...");
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      
      console.log("[Client] Local description set, sending offer to server");
      console.log("[Client] Offer SDP type:", offer.type);
      console.log("[Client] Offer SDP size:", offer.sdp?.length || 0);

      const message = {
        type: 'OFFER',
        payload: {
          sdp: offer,
          gameId: gameId
        }
      };

      console.log("[Client] Sending OFFER message:", JSON.stringify(message, null, 2));
      socket.send(JSON.stringify(message));
      
      console.log("[Client] Offer sent successfully");
    } catch (error) {
      console.error("[Client] Error creating offer:", error);
      throw error;
    }
  }, [gameId, socket]);

  const handleOffer = useCallback(async (payload: any) => {
    console.log("[Client] handleOffer called with payload:", payload);
    
    if (!peerConnectionRef.current) {
      console.error("[Client] No peer connection available for handling offer");
      throw new Error("Peer connection not available");
    }
    
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("[Client] Socket not available for handling offer");
      throw new Error("Socket not available");
    }

    try {
      console.log("[Client] Handling incoming offer...");
      
      if (!payload.sdp) {
        console.error("[Client] No SDP found in offer payload");
        throw new Error("No SDP found in offer payload");
      }
      
      await peerConnectionRef.current.setRemoteDescription(payload.sdp);
      console.log("[Client] Remote description set");
      
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      console.log("[Client] Answer created and local description set");
      
      const message = {
        type: 'ANSWER',
        payload: {
          sdp: answer,
          gameId: gameId
        }
      };
      
      console.log("[Client] Sending ANSWER message:", JSON.stringify(message, null, 2));
      socket.send(JSON.stringify(message));
      
      console.log("[Client] Answer sent successfully");
    } catch (error) {
      console.error("[Client] Error handling offer:", error);
      throw error;
    }
  }, [gameId, socket]);

  const handleAnswer = useCallback(async (payload: any) => {
    console.log("[Client] handleAnswer called with payload:", payload);
    
    if (!peerConnectionRef.current) {
      console.error("[Client] No peer connection available for handling answer");
      throw new Error("Peer connection not available");
    }

    try {
      console.log("[Client] Handling incoming answer...");
      
      if (!payload.sdp) {
        console.error("[Client] No SDP found in answer payload");
        throw new Error("No SDP found in answer payload");
      }
      
      await peerConnectionRef.current.setRemoteDescription(payload.sdp);
      console.log("[Client] Answer handled successfully");
    } catch (error) {
      console.error("[Client] Error handling answer:", error);
      throw error;
    }
  }, []);

  const handleIceCandidate = useCallback(async (payload: any) => {
    console.log("[Client] handleIceCandidate called:", payload.candidate ? "candidate" : "end-of-candidates");
    
    if (!peerConnectionRef.current) {
      console.error("[Client] No peer connection available for ICE candidate");
      throw new Error("Peer connection not available");
    }

    try {
      if (payload.candidate) {
        await peerConnectionRef.current.addIceCandidate(payload.candidate);
        console.log("[Client] ICE candidate added successfully");
      } else {
        console.log("[Client] Received end-of-candidates signal");
      }
    } catch (error) {
      console.error("[Client] Error handling ICE candidate:", error);
      throw error;
    }
  }, []);

  const cleanup = useCallback(() => {
    console.log("[Client] Cleaning up WebRTC...");
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
        console.log("[Client] Stopped track:", track.kind);
      });
      setLocalStream(null);
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
      console.log("[Client] RTCPeerConnection closed");
    }
    
    setRemoteStream(null);
    setIsWebRTCReady(false);
    setConnectionState('disconnected');
    // Clear message queue on cleanup
    messageQueueRef.current = [];
    console.log("[Client] WebRTC cleanup complete");
  }, [localStream]);

  // Process queued messages when WebRTC becomes ready
  useEffect(() => {
    if (!isWebRTCReady || messageQueueRef.current.length === 0) return;
    
    console.log(`[Client] WebRTC is ready, processing ${messageQueueRef.current.length} queued messages`);
    
    const processQueue = async () => {
      const queue = [...messageQueueRef.current]; // Create a copy to avoid modification during processing
      messageQueueRef.current = []; // Clear the original queue
      
      // Process messages in order
      for (const message of queue) {
        try {
          console.log(`[Client] Processing queued message: ${message.type}`);
          
          switch (message.type) {
            case 'OFFER':
              await handleOffer(message.payload);
              break;
            case 'ANSWER':
              await handleAnswer(message.payload);
              break;
            case 'ICE_CANDIDATE':
              await handleIceCandidate(message.payload);
              break;
          }
        } catch (error) {
          console.error(`[Client] Error processing queued message ${message.type}:`, error);
        }
      }
      
      console.log("[Client] Message queue processing complete");
    };
    
    processQueue();
  }, [isWebRTCReady, handleOffer, handleAnswer, handleIceCandidate]);

  return {
    localStream,
    remoteStream,
    isWebRTCReady,
    connectionState,
    startWebRTC,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    cleanup,
    queueMessage
  };
}

function Game() {
  const socket = useSocket();
  const socketRef = useRef<WebSocket | null>(null);

  const [chess, setChess] = useState(new Chess());
  const [gameStarted, setGameStarted] = useState(false);
  const [playerColor, setPlayerColor] = useState<"white" | "black">("white");
  const [gameId, setGameId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [gameStatus, setGameStatus] = useState<string>("");
  const [resignDialogOpen, setResignDialogOpen] = useState(false);
  const [drawOfferDialogOpen, setDrawOfferDialogOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 0
  );
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);

  // Clock state
  const [whiteClock, setWhiteClock] = useState(600); // 10 minutes in seconds
  const [blackClock, setBlackClock] = useState(600);
  const [currentTurn, setCurrentTurn] = useState<"white" | "black">("white");

  // Chat functionality
  const [messages, setMessages] = useState<
    Array<{ text: string; sender: string; timestamp: string }>
  >([]);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Video calling
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // WebRTC state
  const [webRTCGameId, setWebRTCGameId] = useState<string>("");
  const [shouldStartWebRTC, setShouldStartWebRTC] = useState(false);
  const [isOfferer, setIsOfferer] = useState(false);

  const { 
    localStream, 
    remoteStream, 
    isWebRTCReady, 
    startWebRTC,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    cleanup,
    queueMessage
  } = useWebRTC(webRTCGameId, socket);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Format time display
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // Handle local video stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      console.log("Local video stream set");
    }
  }, [localStream]);

  // Handle remote video stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      console.log("Remote video stream set");
    }
  }, [remoteStream]);

  // Initialize WebRTC when game starts - FIXED
  useEffect(() => {
    if (shouldStartWebRTC && webRTCGameId && !isWebRTCReady && socket) {
      console.log("Starting WebRTC for game:", webRTCGameId);
      console.log("Socket state:", socket.readyState);
      
      startWebRTC()
        .then(() => {
          console.log("WebRTC initialized successfully");
        })
        .catch((error) => {
          console.error("Failed to start WebRTC:", error);
          setError("Failed to initialize video call");
        });
    }
  }, [shouldStartWebRTC, webRTCGameId, isWebRTCReady, startWebRTC, socket]);

  // Handle offer creation when WebRTC is ready - FIXED with proper delay
  useEffect(() => {
    console.log("[WebRTC] Offer creation effect triggered:");
    console.log("[WebRTC] - isWebRTCReady:", isWebRTCReady);
    console.log("[WebRTC] - isOfferer:", isOfferer);
    console.log("[WebRTC] - webRTCGameId:", webRTCGameId);
    console.log("[WebRTC] - socket:", !!socket);
    console.log("[WebRTC] - socket.readyState:", socket?.readyState);
    
    if (isWebRTCReady && isOfferer && webRTCGameId && socket && socket.readyState === WebSocket.OPEN) {
      console.log("[WebRTC] Creating offer as offerer - all conditions met");
      
      // Add a small delay to ensure everything is properly initialized
      const timer = setTimeout(() => {
        console.log("[WebRTC] Executing delayed offer creation");
        createOffer()
          .then(() => {
            console.log("[WebRTC] Offer created and sent successfully");
          })
          .catch((error) => {
            console.error("[WebRTC] Failed to create offer:", error);
            setError("Failed to create video call offer");
          });
      }, 1000); // 1 second delay

      return () => {
        console.log("[WebRTC] Clearing offer creation timer");
        clearTimeout(timer);
      };
    } else {
      console.log("[WebRTC] Conditions not met for offer creation");
    }
  }, [isWebRTCReady, isOfferer, createOffer, webRTCGameId, socket]);

  // FIXED message handler with comprehensive error handling and logging
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log("=== Received message ===");
        console.log("Type:", data.type);
        console.log("Payload:", data.payload);
        console.log("Socket state:", socket?.readyState);
        console.log("WebRTC ready:", isWebRTCReady);
        console.log("========================");

        switch (data.type) {
          case "INIT_GAME":
            console.log("Game initialized:", data.payload);
            setPlayerColor(data.payload.color);
            setGameId(data.payload.gameId || "");
            setWebRTCGameId(data.payload.gameId || "");
            setWaitingForOpponent(false);
            setGameStarted(true);
            setGameStatus(`Game started! You are playing as ${data.payload.color}`);
            setError(null);
            setShouldStartWebRTC(true);
            // Don't override isOfferer here - it was set correctly by START_OFFER message
            console.log("[WebRTC] Game initialized, preserving isOfferer state:", isOfferer);
            break;

          case "START_OFFER":
            console.log("=== START_OFFER RECEIVED ===");
            console.log("Setting as offerer for game:", data.payload?.gameId);
            setIsOfferer(true);
            
            if (data.payload?.gameId) {
              setWebRTCGameId(data.payload.gameId);
            }
            setShouldStartWebRTC(true);
            console.log("START_OFFER processing complete");
            break;

          case "STATUS":
            console.log("Status update:", data.payload);
            if (data.payload.message) {
              setGameStatus(data.payload.message);
            }
            if (data.payload.gameId) {
              setGameId(data.payload.gameId);
              setWebRTCGameId(data.payload.gameId);
              setShouldStartWebRTC(true);
              setIsOfferer(false); // This player will receive the offer
            }
            break;

          case "WAITING_FOR_OPPONENT":
            setWaitingForOpponent(true);
            setGameStatus("Waiting for opponent...");
            break;

          case "OFFER":
            console.log("=== OFFER RECEIVED ===");
            console.log("WebRTC ready:", isWebRTCReady);
            console.log("Payload:", data.payload);
            
            if (isWebRTCReady) {
              try {
                await handleOffer(data.payload);
                console.log("Offer handled successfully");
              } catch (error) {
                console.error("Failed to handle offer:", error);
                setError("Failed to handle video call offer: " + (error as Error).message);
              }
            } else {
              console.log("WebRTC not ready, queuing OFFER message");
              queueMessage('OFFER', data.payload);
            }
            break;

          case "ANSWER":
            console.log("=== ANSWER RECEIVED ===");
            console.log("WebRTC ready:", isWebRTCReady);
            console.log("Payload:", data.payload);
            
            if (isWebRTCReady) {
              try {
                await handleAnswer(data.payload);
                console.log("Answer handled successfully");
              } catch (error) {
                console.error("Failed to handle answer:", error);
                setError("Failed to handle video call answer: " + (error as Error).message);
              }
            } else {
              console.log("WebRTC not ready, queuing ANSWER message");
              queueMessage('ANSWER', data.payload);
            }
            break;

          case "ICE_CANDIDATE":
            console.log("=== ICE_CANDIDATE RECEIVED ===");
            console.log("WebRTC ready:", isWebRTCReady);
            console.log("Candidate:", data.payload.candidate ? "present" : "null");
            
            if (isWebRTCReady) {
              try {
                await handleIceCandidate(data.payload);
                console.log("ICE candidate handled successfully");
              } catch (error) {
                console.error("Failed to handle ICE candidate:", error);
                // Don't show error to user for ICE candidate failures
              }
            } else {
              console.log("WebRTC not ready, queuing ICE_CANDIDATE message");
              queueMessage('ICE_CANDIDATE', data.payload);
            }
            break;

          case "MOVE":
            if (data.payload.fen) {
              setChess(new Chess(data.payload.fen));
            }
            if (data.payload.activePlayer) {
              setCurrentTurn(data.payload.activePlayer);
            }
            if (data.payload.isCheck) {
              setGameStatus("Check!");
            } else {
              setGameStatus("");
            }
            break;

          case "CLOCK_UPDATE":
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

          case "INVALID_MOVE":
            setError(data.payload.message || "Invalid move");
            setTimeout(() => setError(null), 3000);
            break;

          case "INVALID_TURN":
            setError(data.payload.message || "It's not your turn");
            setTimeout(() => setError(null), 3000);
            break;

          case "GAME_OVER":
            setGameStarted(false);
            handleGameOver(data.payload);
            cleanup();
            break;

          case "DRAW_OFFER":
            setDrawOfferDialogOpen(true);
            break;

          case "MESSAGE":
            handleIncomingMessage(data.payload);
            break;

          case "GAME_STATE":
            // Handle reconnection
            if (data.payload.isActive) {
              setGameStarted(true);
              setPlayerColor(data.payload.playerColor || (data.payload.currentTurn === "white" ? "white" : "black"));
              setChess(new Chess(data.payload.fen));
              if (data.payload.clocks) {
                setWhiteClock(data.payload.clocks.white);
                setBlackClock(data.payload.clocks.black);
              }
              setCurrentTurn(data.payload.currentTurn);
              if (data.payload.gameId) {
                setGameId(data.payload.gameId);
                setWebRTCGameId(data.payload.gameId);
                setShouldStartWebRTC(true);
              }
            }
            break;

          default:
            console.warn("Unhandled message type:", data.type);
            break;
        }
      } catch (err) {
        console.error("Error processing message:", err);
        setError("Failed to process server message");
      }
    },
    [isWebRTCReady, handleOffer, handleAnswer, handleIceCandidate, cleanup, socket, queueMessage]
  );

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
    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [socket, handleMessage]);

  const makeMove = useCallback(
    (move: { from: string; to: string }) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "MOVE",
            payload: {
              move,
              gameId,
            },
          })
        );
      } else {
        console.error("WebSocket not ready for sending move");
        setError("Connection issue: Cannot send move");
      }
    },
    [gameId]
  );

  const onDrop = useCallback(
    (source: string, target: string) => {
      // Check if it's the player's turn
      if (currentTurn !== playerColor) {
        setError("It's not your turn!");
        setTimeout(() => setError(null), 3000);
        return false;
      }

      // Create a temporary chess instance to validate the move
      const tempChess = new Chess(chess.fen());
      const move = tempChess.move({ from: source, to: target });

      if (!move) {
        setError("Invalid move!");
        setTimeout(() => setError(null), 3000);
        return false;
      }

      // If move is valid, send it to server
      makeMove({ from: source, to: target });
      return true;
    },
    [chess, makeMove, currentTurn, playerColor]
  );

  const handlePlay = useCallback(() => {
    if (!socket) {
      console.error("WebSocket not connected yet.");
      setError("Connection issue: WebSocket not connected");
      return;
    }

    socket.send(JSON.stringify({ type: "INIT_GAME" }));
    setWaitingForOpponent(true);
    setError(null);
    setGameStatus("Looking for an opponent...");
  }, [socket]);

  const handleResign = () => {
    setResignDialogOpen(true);
  };

  const confirmResign = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "FORFEIT",
          payload: { gameId },
        })
      );
    }
    setResignDialogOpen(false);
  };

  const handleOfferDraw = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "DRAW_OFFER",
          payload: { gameId },
        })
      );
    }
    setGameStatus("Draw offer sent to opponent");
    setTimeout(() => setGameStatus(""), 3000);
  };

  const acceptDraw = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "DRAW_ACCEPTED",
          payload: { gameId },
        })
      );
    }
    setDrawOfferDialogOpen(false);
  };

  const declineDraw = () => {
    setDrawOfferDialogOpen(false);
    // Send decline message to opponent
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "DRAW_DECLINED", 
          payload: { gameId },
        })
      );
    }
  };

  const handleGameOver = (payload: any) => {
    const { winner, reason } = payload;

    let message = "";
    if (winner === "draw") {
      message = `Game ended in a draw: ${reason}`;
    } else if (winner === playerColor) {
      message = `You won! ${reason}`;
    } else {
      message = `You lost! ${reason}`;
    }

    setGameStatus(message);
    setGameStarted(false);
    setCurrentTurn("white");

    // Reset the board after a delay to show final position
    setTimeout(() => {
      setChess(new Chess());
      setWhiteClock(600);
      setBlackClock(600);
      setGameStatus("");
      setGameId("");
      setWebRTCGameId("");
      setShouldStartWebRTC(false);
      setIsOfferer(false);
    }, 5000);
  };

  const handleSendMessage = (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (newMessage.trim() && socketRef.current?.readyState === WebSocket.OPEN) {
      const timestamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      setMessages((prev) => [
        ...prev,
        {
          text: newMessage,
          sender: "me",
          timestamp,
        },
      ]);

      socketRef.current.send(
        JSON.stringify({
          type: "MESSAGE",
          payload: {
            message: newMessage,
            gameId,
          },
        })
      );

      setNewMessage("");
    }
  };

  const handleIncomingMessage = (payload: any) => {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    setMessages((prev) => [
      ...prev,
      {
        text: payload.message || payload,
        sender: "opponent",
        timestamp,
      },
    ]);
  };

  const resetGame = () => {
    setChess(new Chess());
    setGameStarted(false);
    setWaitingForOpponent(false);
    setPlayerColor("white");
    setGameId("");
    setWebRTCGameId("");
    setError(null);
    setGameStatus("");
    setCurrentTurn("white");
    setWhiteClock(600);
    setBlackClock(600);
    setMessages([]);
    setShouldStartWebRTC(false);
    setIsOfferer(false);
    cleanup();
  };

  // Debug component for development
  const WebRTCDebugInfo = () => {
    if (process.env.NODE_ENV !== "development") return null;
    
    return (
      <div className="text-xs text-gray-400 space-y-1 p-2 bg-gray-800 rounded mt-4">
        <div>WebRTC Ready: {isWebRTCReady ? "✅" : "❌"}</div>
        <div>Local Stream: {localStream ? "✅" : "❌"}</div>
        <div>Remote Stream: {remoteStream ? "✅" : "❌"}</div>
        <div>Is Offerer: {isOfferer ? "✅" : "❌"}</div>
        <div>Game ID: {webRTCGameId || "None"}</div>
        <div>Socket State: {socket?.readyState || "N/A"}</div>
        <div>Should Start WebRTC: {shouldStartWebRTC ? "✅" : "❌"}</div>
      </div>
    );
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
        <div className="flex flex-col items-center gap-6 w-full max-w-6xl">
          {/* Video and Game Area */}
          <div className="flex flex-col md:flex-row gap-6 w-full">
            {/* Video Area */}
            {gameStarted && (
              <div className="flex flex-col md:w-1/3 gap-4">
                {/* Remote Video */}
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-sm px-2 py-1 rounded">
                    Opponent
                  </div>
                  {!remoteStream && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-gray-400 text-sm">
                        {isWebRTCReady
                          ? "Connecting to opponent..."
                          : "Setting up video..."}
                      </div>
                    </div>
                  )}
                </div>

                {/* Local Video */}
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-sm px-2 py-1 rounded">
                    You
                  </div>
                  {!localStream && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-gray-400 text-sm">
                        Camera starting...
                      </div>
                    </div>
                  )}
                </div>

                {/* WebRTC Debug Info */}
                <WebRTCDebugInfo />
              </div>
            )}

            {/* Game Area */}
            <div className="flex flex-col items-center gap-6 md:w-2/3">
              {/* Opponent's clock */}
              <div className="bg-[#272522] text-amber-500 text-4xl font-bold text-center p-4 rounded-lg shadow-lg min-w-[200px]">
                <div className="text-sm text-gray-400 mb-2">
                  {playerColor === "white" ? "Black" : "White"}
                  {currentTurn !== playerColor && gameStarted && (
                    <span className="ml-2 text-green-400">●</span>
                  )}
                </div>
                {formatTime(playerColor === "white" ? blackClock : whiteClock)}
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
                    {currentTurn === playerColor
                      ? "Your turn"
                      : "Opponent's turn"}
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
                {formatTime(playerColor === "white" ? whiteClock : blackClock)}
              </div>
            </div>
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

        {!gameStarted && !waitingForOpponent && gameId && (
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
                  className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-xs p-3 rounded-lg ${
                      msg.sender === "me"
                        ? "bg-[#538D4E] ml-auto"
                        : "bg-[#565452] mr-auto"
                    }`}
                  >
                    <p className="text-sm text-gray-200">{msg.text}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {msg.timestamp}
                    </p>
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
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage(e)}
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Resignation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to resign? Your opponent will be declared
              the winner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResignDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmResign}>
              Resign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Draw Offer Dialog */}
      <AlertDialog
        open={drawOfferDialogOpen}
        onOpenChange={setDrawOfferDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Draw Offer</AlertDialogTitle>
            <AlertDialogDescription>
              Your opponent has offered a draw. Do you accept?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={declineDraw}>Decline</AlertDialogCancel>
            <AlertDialogAction onClick={acceptDraw}>
              Accept Draw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default Game;  