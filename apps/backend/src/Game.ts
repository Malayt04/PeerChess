import { Chess } from "chess.js"
import WebSocket from "ws"
import { GAME_OVER, INIT_GAME, INVALID_MOVE, MOVE } from "./message"
import { move } from './types';


export class Game{
    playerOne: WebSocket
    playerTwo: WebSocket
    board: Chess
    moves: string[]
    moveCount: number 

    constructor(playerOne: WebSocket, playerTwo: WebSocket){
        this.playerOne = playerOne
        this.playerTwo = playerTwo
        this.board = new Chess()
        this.moves = []
        this.moveCount = 0
        this.playerOne.send(JSON.stringify({
            type:  INIT_GAME,
            payload: {
                color: "white"
            }
        }))

        this.playerTwo.send(JSON.stringify({
            type:  INIT_GAME,
            payload: {
                color: "black"
            }
        }))
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
                payload: move,
            })
        );
    
        this.playerTwo.send(
            JSON.stringify({
                type: MOVE,
                payload: move,
            })
        );
    
        this.moveCount++;
    }
    
}

