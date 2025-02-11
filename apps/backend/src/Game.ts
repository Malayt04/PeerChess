import { Chess } from "chess.js"
import WebSocket from "ws"
import { GAME_OVER, ICE_CANDIDATE, INIT_GAME, INVALID_MOVE, MOVE, WEBRTC_ANSWER, WEBRTC_OFFER } from "./message"
import { move } from './types';


export class Game{
    playerOne: WebSocket
    playerTwo: WebSocket
    board: Chess
    moves: string[]
    moveCount: number
    gameId: string

    constructor(playerOne: WebSocket, playerTwo: WebSocket){
        this.playerOne = playerOne
        this.playerTwo = playerTwo
        this.board = new Chess()
        this.moves = []
        this.moveCount = 0
        this.gameId = new Date().getTime().toString()
        this.playerOne.send(JSON.stringify({
            type:  INIT_GAME,
            payload: {
                color: "white",
                gameId: this.gameId
            }
        }))

        this.playerTwo.send(JSON.stringify({
            type:  INIT_GAME,
            payload: {
                color: "black",
                gameId: this.gameId
            }
        }))

        console.log("webrtc setup")

        this.setupWebRTCForwarding();
    }

     setupWebRTCForwarding() {
        // Forward WebRTC messages between players
        const forwardToPeer = (sender: WebSocket, receiver: WebSocket) => {
            sender.on('message', (data: string) => {
                const message = JSON.parse(data);
                console.log(data)
                if ([WEBRTC_OFFER, WEBRTC_ANSWER, ICE_CANDIDATE].includes(message.type)) {
                    console.log(message)
                    receiver.send(JSON.stringify({
                        type: message.type,
                        payload: message.payload
                    }));
                }else{
                    return
                }
            });
        };

        forwardToPeer(this.playerOne, this.playerTwo);
        forwardToPeer(this.playerTwo, this.playerOne);
    }

    makeMove(user: WebSocket, move: move) {
        if (this.moveCount % 2 === 0 && user !== this.playerOne) return;
        if (this.moveCount % 2 === 1 && user !== this.playerTwo) return;
    
        try {
            this.board.move(move);
        } catch (e) {
            console.log(e);
            this.playerOne.send(
                JSON.stringify({
                    type: INVALID_MOVE,
                    payload: {
                        message : "Invalid move"
                    },
                })
            )

            this.playerTwo.send(
                JSON.stringify({
                    type: INVALID_MOVE,
                    payload: {
                        message : "Invalid move"
                    },
                })
            )
            return;
        }
    
        console.log(move.to);
    
        this.moves.push(move.to);
    
        if (this.board.isGameOver()) {
            this.playerOne.emit(
                JSON.stringify({
                    type: GAME_OVER,
                    payload: {
                        winner: this.moveCount % 2 === 0 ? this.playerOne : this.playerTwo,
                    },
                })
            );
    
            this.playerTwo.emit(
                JSON.stringify({
                    type: GAME_OVER,
                    payload: {
                        winner: this.moveCount % 2 === 0 ? this.playerOne : this.playerTwo,
                    },
                })
            )
        }
    
        this.playerOne.send(
            JSON.stringify({
                type: MOVE,
                payload: {move},
            })
        );
    
        this.playerTwo.send(
            JSON.stringify({
                type: MOVE,
                payload: {move},
            })
        );
    
        this.moveCount++;
    }
    
}

