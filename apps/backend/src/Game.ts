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
    moves: move[];
    moveCount: number;
    gameId: string;

    constructor(playerOne: WebSocket, playerTwo: WebSocket) {
        this.playerOne = playerOne;
        this.playerOneClock = 600;
        this.playerTwo = playerTwo;
        this.playerTwoClock = 600;
        this.clockInterval = null;
        this.board = new Chess();
        this.moves = [];
        this.moveCount = 0;
        this.gameId = new Date().getTime().toString();

        this.playerOne.send(JSON.stringify({
            type: INIT_GAME,
            payload: { color: "white", gameId: this.gameId },
        }));

        this.playerTwo.send(JSON.stringify({
            type: INIT_GAME,
            payload: { color: "black", gameId: this.gameId },
        }));

        this.startClock();
        console.log("WebRTC setup");
        this.setupWebRTCForwarding();
    }

    startClock() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
        }

        this.clockInterval = setInterval(() => {
            if (this.moveCount % 2 === 0) {
                this.playerOneClock -= 1;
            } else {
                this.playerTwoClock -= 1;
            }

            // Send clock updates
            const clockUpdate = JSON.stringify({
                type: CLOCK_UPDATE,
                payload: {
                    white: this.playerOneClock,
                    black: this.playerTwoClock,
                },
            });

            this.playerOne.send(clockUpdate);
            this.playerTwo.send(clockUpdate);
            console.log(`White: ${this.playerOneClock}s, Black: ${this.playerTwoClock}s`);

            if (this.playerOneClock <= 0 || this.playerTwoClock <= 0) {
                clearInterval(this.clockInterval!);
                const winner = this.playerOneClock <= 0 ? "black" : "white";

                const gameOverMessage = JSON.stringify({
                    type: GAME_OVER,
                    payload: { winner },
                });

                this.playerOne.send(gameOverMessage);
                this.playerTwo.send(gameOverMessage);
            }
        }, 1000);
    }

    setupWebRTCForwarding() {
        const forwardToPeer = (sender: WebSocket, receiver: WebSocket) => {
            sender.on("message", (data: string) => {
                const message = JSON.parse(data);
                if ([WEBRTC_OFFER, WEBRTC_ANSWER, ICE_CANDIDATE].includes(message.type)) {
                    console.log(message);
                    receiver.send(JSON.stringify({
                        type: message.type,
                        payload: message.payload
                    }));
                }
            });
        };

        forwardToPeer(this.playerOne, this.playerTwo);
        forwardToPeer(this.playerTwo, this.playerOne);
    }

    sendMessage(message: string, sender: WebSocket) {
        
        if (sender === this.playerOne) {
            this.playerTwo.send(JSON.stringify({
                type: MESSAGE,
                payload: message
            }));
        } else {
            this.playerOne.send(JSON.stringify({
                type: MESSAGE,
                payload: message
            }));
        }

    }

    makeMove(user: WebSocket, move: move) {
        if ((this.moveCount % 2 === 0 && user !== this.playerOne) || 
            (this.moveCount % 2 === 1 && user !== this.playerTwo)) {
            return;
        }

        try {
            this.board.move(move);
        } catch (e) {
            console.log(e);
            const invalidMoveMessage = JSON.stringify({
                type: INVALID_MOVE,
                payload: { message: "Invalid move" },
            });

            this.playerOne.send(invalidMoveMessage);
            this.playerTwo.send(invalidMoveMessage);
            return;
        }

        console.log(move);
        this.moves.push(move);

        if (this.board.isGameOver()) {
            const winner = this.moveCount % 2 === 0 ? "white" : "black";

            const gameOverMessage = JSON.stringify({
                type: GAME_OVER,
                payload: { winner },
            });

            this.playerOne.send(gameOverMessage);
            this.playerTwo.send(gameOverMessage);
            return;
        }

        // Send move updates
        const moveUpdate = JSON.stringify({
            type: MOVE,
            payload: { move },
        });

        this.playerOne.send(moveUpdate);
        this.playerTwo.send(moveUpdate);

        this.moveCount++;
        this.startClock();
    }
}
