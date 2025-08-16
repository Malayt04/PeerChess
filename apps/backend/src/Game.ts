import { Chess } from "chess.js";
import { move } from "./types";
import { sendPlayer } from "./utils";
import {
  CLOCK_UPDATE,
  GAME_OVER,
  INIT_GAME,
  INVALID_MOVE,
  MOVE,
  INVALID_TURN,
} from "./constants";
import { Player } from "./Player";

import { Worker } from "mediasoup/node/lib/types";

export class Game {
  id: string;
  white: Player;
  black: Player;
  whiteClock: number = 600;
  blackClock: number = 600;
  board: Chess;
  moveCount: number = 0;
  isGameActive: boolean = false;
  private clockInterval: NodeJS.Timeout | null = null;
  private gameStartTime: number = 0;
  private lastMoveTime: number = 0;

  constructor(id: string, white: Player, black: Player) {
    this.id = id;
    this.white = white;
    this.black = black;
    this.board = new Chess();
  }

  initGame() {
    this.isGameActive = true;
    this.gameStartTime = Date.now();
    this.lastMoveTime = this.gameStartTime;

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

    this.startClock();
  }

  makeMove(player: Player, move: move) {
    if (!this.isGameActive) {
      this.sendInvalidMove(player, "Game is not active");
      return;
    }

    const isWhiteTurn = this.moveCount % 2 === 0;
    const isValidTurn =
      (isWhiteTurn && player.id === this.white.id) ||
      (!isWhiteTurn && player.id === this.black.id);

    if (!isValidTurn) {
      sendPlayer(player, {
        type: INVALID_TURN,
        payload: {
          message: "It's not your turn",
        },
      });
      return;
    }

    const result = this.board.move(move);

    if (!result) {
      this.sendInvalidMove(player, "Invalid move");
      return;
    }

    const currentTime = Date.now();
    const timeElapsed = Math.floor((currentTime - this.lastMoveTime) / 1000);

    if (isWhiteTurn) {
      this.whiteClock = Math.max(0, this.whiteClock - timeElapsed);
    } else {
      this.blackClock = Math.max(0, this.blackClock - timeElapsed);
    }

    this.lastMoveTime = currentTime;
    this.moveCount++;

    const moveData = {
      move: result,
      fen: this.board.fen(),
      moveCount: this.moveCount,
      isCheck: this.board.isCheck(),
    };

    sendPlayer(this.white, {
      type: MOVE,
      payload: { ...moveData, color: "white", gameId: this.id },
    });

    sendPlayer(this.black, {
      type: MOVE,
      payload: { ...moveData, color: "black", gameId: this.id },
    });

    console.log(
      `[Debug Make move]: Move made on the board: ${this.board.ascii()}`
    );

    this.checkGameEnd();
  }

  private sendInvalidMove(player: Player, message: string) {
    sendPlayer(player, {
      type: INVALID_MOVE,
      payload: {
        message,
        fen: this.board.fen(),
      },
    });
  }

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

  private endGame(reason: string, winner: "white" | "black" | "draw") {
    this.isGameActive = false;
    this.stopClock();

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

    sendPlayer(this.white, { type: GAME_OVER, payload: gameOverPayload });
    sendPlayer(this.black, { type: GAME_OVER, payload: gameOverPayload });

    console.log(`[Game ${this.id}] Game ended: ${reason}, Winner: ${winner}`);
  }

  private startClock() {
    this.stopClock();

    this.clockInterval = setInterval(() => {
      if (!this.isGameActive) {
        this.stopClock();
        return;
      }

      const isWhiteTurn = this.moveCount % 2 === 0;

      if (isWhiteTurn) {
        this.whiteClock = Math.max(0, this.whiteClock - 1);
        if (this.whiteClock === 0) {
          this.checkGameEnd();
          return;
        }
      } else {
        this.blackClock = Math.max(0, this.blackClock - 1);
        if (this.blackClock === 0) {
          this.checkGameEnd();
          return;
        }
      }

      this.sendClockUpdate();
    }, 1000);
  }

  private stopClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  private sendClockUpdate() {
    const clockData = {
      whiteClock: this.whiteClock,
      blackClock: this.blackClock,
      activePlayer: this.moveCount % 2 === 0 ? "white" : "black",
    };

    sendPlayer(this.white, { type: CLOCK_UPDATE, payload: clockData });
    sendPlayer(this.black, { type: CLOCK_UPDATE, payload: clockData });
  }

  forfeit(player: Player) {
    if (!this.isGameActive) return;
    const winner = player.id === this.white.id ? "black" : "white";
    this.endGame("Forfeit", winner);
  }

  offerDraw(player: Player) {
    if (!this.isGameActive) return;
    this.endGame("Draw by agreement", "draw");
  }

  destroy() {
    this.isGameActive = false;
    this.stopClock();
  }

  getCurrentTurn(): "white" | "black" {
    return this.moveCount % 2 === 0 ? "white" : "black";
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
