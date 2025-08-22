/**
 * Manages the state and logic of a single chess game.
 * This class handles moves, clock updates, and game-ending conditions.
 */
import { Chess } from "chess.js";
import { move } from "./types";
import { sendPlayer } from "./utils";
import {
    CLOCK_UPDATE,
    GAME_OVER,
    INIT_GAME,
    INVALID_MOVE,
    INVALID_TURN,
    MOVE,
    DRAW_OFFER,
    DRAW_ACCEPTED,
    STATUS
} from "./constants";
import { Player } from "./Player";

export class Game {
    id: string;
    white: Player;
    black: Player;
    whiteClock: number = 600; // Time in seconds
    blackClock: number = 600; // Time in seconds
    board: Chess;
    moveCount: number = 0;
    isGameActive: boolean = false;
    private gameStartTime: number = 0;
    private lastMoveTime: number = 0;
    private clockInterval: NodeJS.Timeout | null = null;
    private players: Player[];

    constructor(id: string, white: Player, black: Player) {
        this.id = id;
        this.white = white;
        this.black = black;
        this.board = new Chess();
        this.players = [this.white, this.black];
    }

    /**
     * Initializes the game by setting up the board and sending the initial state to players.
     * The clock does not start until the first move is made.
     */
    initGame() {
        this.isGameActive = true;
        this.moveCount = 0;

        // Send initial game state to both players
        sendPlayer(this.white, {
            type: INIT_GAME,
            payload: {
                color: "white",
                gameId: this.id,
                fen: this.board.fen(),
            },
        });

        sendPlayer(this.black, {
            type: INIT_GAME,
            payload: {
                color: "black",
                gameId: this.id,
                fen: this.board.fen(),
            },
        });

        console.log(`[Game ${this.id}] Game initialized and waiting for first move.`);
    }

    /**
     * Attempts to make a move on the board for the current player.
     * This method also handles time management for each player.
     */
    makeMove(player: Player, move: move) {
        if (!this.isGameActive) {
            this.sendInvalidMove(player, "Game is not active");
            return;
        }

        const isWhiteTurn = this.board.turn() === "w";
        const isCurrentPlayerWhite = player.id === this.white.id;

        if (isWhiteTurn !== isCurrentPlayerWhite) {
            sendPlayer(player, {
                type: INVALID_TURN,
                payload: {
                    message: "It's not your turn",
                },
            });
            return;
        }

        // Start the clock on the first move
        if (this.moveCount === 0) {
            this.gameStartTime = Date.now();
            this.lastMoveTime = this.gameStartTime;
            this.startClock();
            console.log(`[Game ${this.id}] Clock started on first move.`);
        }

        const result = this.board.move(move);

        if (!result) {
            this.sendInvalidMove(player, "Invalid move");
            return;
        }

        this.lastMoveTime = Date.now();
        this.moveCount++;

        const moveData = {
            move: result,
            fen: this.board.fen(),
            moveCount: this.moveCount,
            isCheck: this.board.isCheck(),
        };

        // Send move to both players
        this.sendToBothPlayers({
            type: MOVE,
            payload: { ...moveData, gameId: this.id },
        });

        console.log(
            `[Game ${this.id}] Move made by ${player.id}: ${move.from}-${move.to}`
        );

        this.checkGameEnd();
    }

    /**
     * Helper to send a message to both players.
     * @param message The message object to send.
     */
    private sendToBothPlayers(message: any) {
        sendPlayer(this.white, message);
        sendPlayer(this.black, message);
    }

    /**
     * Private helper to send an INVALID_MOVE message to a player.
     */
    private sendInvalidMove(player: Player, message: string) {
        sendPlayer(player, {
            type: INVALID_MOVE,
            payload: {
                message,
                fen: this.board.fen(),
            },
        });
    }

    /**
     * Starts a timer to check and update player clocks.
     */
    private startClock() {
        this.clockInterval = setInterval(() => {
            if (!this.isGameActive) {
                if (this.clockInterval) {
                    clearInterval(this.clockInterval);
                }
                return;
            }

            const isWhiteTurn = this.board.turn() === "w";
            const currentTime = Date.now();
            const timeElapsed = Math.floor((currentTime - this.lastMoveTime) / 1000);
            this.lastMoveTime = currentTime;

            if (isWhiteTurn) {
                this.whiteClock = Math.max(0, this.whiteClock - timeElapsed);
            } else {
                this.blackClock = Math.max(0, this.blackClock - timeElapsed);
            }

            this.sendClockUpdate();
            this.checkGameEnd();
        }, 1000);
    }

    /**
     * Checks if the game has ended and triggers the endGame method if so.
     */
    private checkGameEnd() {
        let gameEndReason = "";
        let winner: "white" | "black" | "draw" | null = null;

        if (this.board.isCheckmate()) {
            const currentTurn = this.board.turn();
            winner = currentTurn === "w" ? "black" : "white";
            gameEndReason = "Checkmate";
        } else if (this.board.isStalemate()) {
            winner = "draw";
            gameEndReason = "Stalemate";
        } else if (this.board.isThreefoldRepetition()) {
            winner = "draw";
            gameEndReason = "Threefold repetition";
        } else if (this.board.isInsufficientMaterial()) {
            winner = "draw";
            gameEndReason = "Insufficient material";
        } else if (this.board.isDraw()) {
            winner = "draw";
            gameEndReason = "Draw by 50-move rule";
        } else if (this.whiteClock <= 0) {
            winner = "black";
            gameEndReason = "White ran out of time";
        } else if (this.blackClock <= 0) {
            winner = "white";
            gameEndReason = "Black ran out of time";
        }

        if (winner !== null) {
            this.endGame(gameEndReason, winner);
        }
    }

    /**
     * Ends the game and sends the final state to both players.
     */
    endGame(reason: string, winner: "white" | "black" | "draw" | null) {
        if (!this.isGameActive) return;

        this.isGameActive = false;
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }

        const gameOverPayload = {
            message: "Game Over",
            reason,
            winner,
            finalFen: this.board.fen(),
            gameStats: {
                moveCount: this.moveCount,
                gameDuration: Date.now() - this.gameStartTime,
                finalClocks: {
                    white: this.whiteClock,
                    black: this.blackClock,
                },
            },
        };

        this.sendToBothPlayers({ type: GAME_OVER, payload: gameOverPayload });

        console.log(`[Game ${this.id}] Game ended: ${reason}, Winner: ${winner}`);
    }

    private sendClockUpdate() {
        const clockData = {
            whiteClock: this.whiteClock,
            blackClock: this.blackClock,
            activePlayer: this.board.turn() === "w" ? "white" : "black",
        };
        this.sendToBothPlayers({ type: CLOCK_UPDATE, payload: clockData });
    }

    /**
     * Handles a player forfeiting the game.
     */
    forfeit(player: Player) {
        if (!this.isGameActive) return;
        const winner = player.id === this.white.id ? "black" : "white";
        this.endGame("Forfeit", winner);
    }

    /**
     * A player offers a draw. The offer is forwarded to the opponent.
     */
    offerDraw(player: Player) {
        if (!this.isGameActive) return;
        
        // Notify the player who offered the draw
        sendPlayer(player, {
            type: STATUS,
            payload: { message: "Draw offer sent." }
        });

        // Forward the draw offer to the opponent
        const opponent = this.getOpponent(player);
        sendPlayer(opponent, {
            type: DRAW_OFFER,
            payload: {
                from: player.id
            }
        });
        console.log(`[Game ${this.id}] Player ${player.id} offered a draw.`);
    }

    /**
     * Handles the opponent accepting the draw offer.
     */
    acceptDraw(player: Player) {
        this.endGame("Draw by agreement", "draw");
        console.log(`[Game ${this.id}] Draw accepted by player ${player.id}. Game ended.`);
    }

    /**
     * Gets the opponent of a given player.
     */
    getOpponent(player: Player): Player {
        return player.id === this.white.id ? this.black : this.white;
    }

    /**
     * Handles game cleanup and ensures the clock timer is stopped.
     */
    destroy() {
        this.isGameActive = false;
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
    }

    getCurrentTurn(): "white" | "black" {
        return this.board.turn() === "w" ? "white" : "black";
    }

    getGameState() {
        return {
            id: this.id,
            fen: this.board.fen(),
            moveCount: this.moveCount,
            isActive: this.isGameActive,
            currentTurn: this.getCurrentTurn(),
            clocks: {
                white: this.whiteClock,
                black: this.blackClock,
            },
            isCheck: this.board.isCheck(),
            isCheckmate: this.board.isCheckmate(),
            isStalemate: this.board.isStalemate(),
        };
    }
}
