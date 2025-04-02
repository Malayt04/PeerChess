import { Chess } from "chess.js";
import WebSocket from "ws";
import { GAME_OVER, ICE_CANDIDATE, INIT_GAME, INVALID_MOVE, MOVE, WEBRTC_ANSWER, WEBRTC_OFFER, CLOCK_UPDATE, MESSAGE } from "./message";
import { move } from './types';

export class Game {
    playerOne: WebSocket;
    playerOneClock: number;
    playerTwo: WebSocket;
    playerTwoClock: number;
    clockInterval: NodeJS.Timeout | null;
    board: Chess;
    webRTCOffer: RTCSessionDescriptionInit[];
    moves: move[];
    moveCount: number;
    gameId: string;
    private webrtcHandlers: { playerOne: any, playerTwo: any };
    private isGameActive: boolean;
    private offerInterval: NodeJS.Timeout | null;

    constructor(playerOne: WebSocket, playerTwo: WebSocket) {
        this.playerOne = playerOne;
        this.playerOneClock = 600;
        this.playerTwo = playerTwo;
        this.playerTwoClock = 600;
        this.clockInterval = null;
        this.offerInterval = null;
        this.board = new Chess();
        this.moves = [];
        this.webRTCOffer = [];
        this.moveCount = 0;
        this.gameId = new Date().getTime().toString();
        this.webrtcHandlers = { playerOne: null, playerTwo: null };
        this.isGameActive = true;

        this.setupErrorHandlers();
        this.initializeGame();
        this.startClock();
        this.setupWebRTCForwarding();
        
        // Try to send offers every 2 seconds until successful
        this.offerInterval = setInterval(() => {
            if (!this.isGameActive || this.webRTCOffer.length === 0) {
                if (this.offerInterval) {
                    clearInterval(this.offerInterval);
                    this.offerInterval = null;
                }
                return;
            }
            this.attemptSendStoredOffers();
        }, 2000);
    }

    private setupErrorHandlers() {
        const errorHandler = (player: string) => (error: Error) => {
            console.error(`WebSocket error in ${player}:`, error.message);
            this.cleanupGame();
        };

        const closeHandler = (player: string) => () => {
            console.log(`${player} connection closed`);
            this.cleanupGame();
        };

        this.playerOne.on('error', errorHandler('playerOne'));
        this.playerOne.on('close', closeHandler('playerOne'));
        
        this.playerTwo.on('error', errorHandler('playerTwo'));
        this.playerTwo.on('close', closeHandler('playerTwo'));
    }

    private initializeGame() {
        try {
            if (this.playerOne.readyState === WebSocket.OPEN) {
                this.playerOne.send(JSON.stringify({
                    type: INIT_GAME,
                    payload: { color: "white", gameId: this.gameId },
                }));
            }

            if (this.playerTwo.readyState === WebSocket.OPEN) {
                this.playerTwo.send(JSON.stringify({
                    type: INIT_GAME,
                    payload: { color: "black", gameId: this.gameId },
                }));
                
                // Send any stored offers after initializing playerTwo
                this.attemptSendStoredOffers();
            }
        } catch (error) {
            console.error("Error initializing game:", error);
            this.cleanupGame();
        }
    }

    private sendToPlayer(player: WebSocket, message: any) {
        if (player.readyState === WebSocket.OPEN) {
            try {
                player.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error("Error sending message:", error);
                return false;
            }
        }
        return false;
    }

    private attemptSendStoredOffers() {
        if (this.playerTwo.readyState === WebSocket.OPEN && this.webRTCOffer.length > 0) {
            console.log("Attempting to send stored WebRTC offers to playerTwo");
            const offersToRemove: RTCSessionDescriptionInit[] = [];
            
            for (const offer of this.webRTCOffer) {
                const sent = this.sendToPlayer(this.playerTwo, {
                    type: WEBRTC_OFFER,
                    payload: offer
                });
                
                if (sent) {
                    offersToRemove.push(offer);
                }
            }
            
            // Remove successfully sent offers
            this.webRTCOffer = this.webRTCOffer.filter(offer => !offersToRemove.includes(offer));
            
            if (this.webRTCOffer.length === 0 && this.offerInterval) {
                clearInterval(this.offerInterval);
                this.offerInterval = null;
            }
        }
    }
    

    startClock() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
        }

        this.clockInterval = setInterval(() => {
            if (!this.isGameActive) {
                this.stopClock();
                return;
            }

            if (this.moveCount % 2 === 0) {
                this.playerOneClock -= 1;
            } else {
                this.playerTwoClock -= 1;
            }

            const clockUpdate = {
                type: CLOCK_UPDATE,
                payload: {
                    white: this.playerOneClock,
                    black: this.playerTwoClock,
                },
            };

            this.sendToPlayer(this.playerOne, clockUpdate);
            this.sendToPlayer(this.playerTwo, clockUpdate);

            if (this.playerOneClock <= 0 || this.playerTwoClock <= 0) {
                this.stopClock();
                const winner = this.playerOneClock <= 0 ? "black" : "white";

                const gameOverMessage = {
                    type: GAME_OVER,
                    payload: { winner },
                };

                this.sendToPlayer(this.playerOne, gameOverMessage);
                this.sendToPlayer(this.playerTwo, gameOverMessage);
                this.endGame();
            }
        }, 1000);
    }

    stopClock() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
    }

    setupWebRTCForwarding() {
        const forwardToPeer = (sender: WebSocket, receiver: WebSocket, senderName: string) => {
            const messageHandler = (data: string) => {
                if (!this.isGameActive) return;
    
                try {
                    const message = JSON.parse(data);
                    
                    if (message.type === WEBRTC_OFFER) {
                        console.log(`Received WebRTC offer from ${senderName}`);
    
                        if (receiver.readyState === WebSocket.OPEN) {
                            console.log(`Forwarding WebRTC offer to ${senderName === 'playerOne' ? 'playerTwo' : 'playerOne'}`);
                            this.sendToPlayer(receiver, {
                                type: message.type,
                                payload: message.payload
                            });
                        } else {
                            // Store offer in queue if receiver is not ready
                            console.log(`Storing WebRTC offer as ${senderName === 'playerOne' ? 'playerTwo' : 'playerOne'} is not ready`);
                            this.webRTCOffer.push(message.payload);
                        }
                    } 
                    else if ([WEBRTC_ANSWER, ICE_CANDIDATE].includes(message.type)) {
                        console.log(`Forwarding ${message.type} from ${senderName}`);
                        
                        if (receiver.readyState === WebSocket.OPEN) {
                            this.sendToPlayer(receiver, {
                                type: message.type,
                                payload: message.payload
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Error parsing WebRTC message from ${senderName}:`, error);
                }
            };
    
            sender.on("message", messageHandler);
    
            return messageHandler;
        };
    
        this.webrtcHandlers.playerOne = forwardToPeer(this.playerOne, this.playerTwo, 'playerOne');
        this.webrtcHandlers.playerTwo = forwardToPeer(this.playerTwo, this.playerOne, 'playerTwo');
        
        // Send any stored WebRTC offers immediately if playerTwo is ready
        this.attemptSendStoredOffers();
    }
    
    sendMessage(message: string, sender: WebSocket) {
        if (!this.isGameActive) return;
        
        try {
            const messagePayload = {
                type: MESSAGE,
                payload: message
            };
            
            if (sender === this.playerOne) {
                this.sendToPlayer(this.playerTwo, messagePayload);
            } else {
                this.sendToPlayer(this.playerOne, messagePayload);
            }
        } catch (error) {
            console.error("Error sending chat message:", error);
        }
    }

    makeMove(user: WebSocket, move: move) {
        if (!this.isGameActive) return;
        
        if ((this.moveCount % 2 === 0 && user !== this.playerOne) || 
            (this.moveCount % 2 === 1 && user !== this.playerTwo)) {
            return;
        }

        try {
            this.board.move(move);
        } catch (e) {
            console.log("Invalid move:", e);
            const invalidMoveMessage = {
                type: INVALID_MOVE,
                payload: { message: "Invalid move" },
            };

            this.sendToPlayer(this.playerOne, invalidMoveMessage);
            this.sendToPlayer(this.playerTwo, invalidMoveMessage);
            return;
        }

        this.moves.push(move);

        if (this.board.isGameOver()) {
            const winner = this.moveCount % 2 === 0 ? "white" : "black";
        
            const gameOverMessage = {
                type: GAME_OVER,
                payload: { winner },
            };
        
            this.sendToPlayer(this.playerOne, gameOverMessage);
            this.sendToPlayer(this.playerTwo, gameOverMessage);
            this.endGame();
            return;
        }

        // Send move updates
        const moveUpdate = {
            type: MOVE,
            payload: { move },
        };

        this.sendToPlayer(this.playerOne, moveUpdate);
        this.sendToPlayer(this.playerTwo, moveUpdate);

        this.moveCount++;
        this.startClock();
    }

    endGame() {
        this.isGameActive = false;
        this.stopClock();
        this.cleanupGame();
    }

    cleanupGame() {
        // Only clean up once
        if (!this.isGameActive) return;
        
        this.isGameActive = false;
        this.stopClock();
        
        // Clear offer interval if it exists
        if (this.offerInterval) {
            clearInterval(this.offerInterval);
            this.offerInterval = null;
        }
        
        // Remove WebRTC message handlers to prevent memory leaks
        if (this.webrtcHandlers.playerOne) {
            this.playerOne.removeListener('message', this.webrtcHandlers.playerOne);
        }
        
        if (this.webrtcHandlers.playerTwo) {
            this.playerTwo.removeListener('message', this.webrtcHandlers.playerTwo);
        }
    }
}
