import { Chess } from "chess.js";
import WebSocket from "ws";
import { redis } from "./lib/redis";

import {
  GAME_OVER,
  ICE_CANDIDATE,
  INIT_GAME,
  INVALID_MOVE,
  MOVE,
  WEBRTC_ANSWER,
  WEBRTC_OFFER,
  CLOCK_UPDATE,
  MESSAGE,
} from "./message";

import { move } from "./types";
import { User } from "./User";
import { GameRepository } from "./GameRepository";

export class Game {
  playerOne: User;
  playerTwo: User;
  gameId: string;
  board: Chess;
  clockInterval: NodeJS.Timeout | null = null;
  offerInterval: NodeJS.Timeout | null = null;
  moveCount = 0;
  isGameActive = true;
  private webrtcHandlers: { playerOne: any; playerTwo: any } = { playerOne: null, playerTwo: null };
  private isNewGame = true;

  // Optional: give disconnected players time to reconnect before ending
  private disconnectTimeout: NodeJS.Timeout | null = null;
  private DISCONNECT_GRACE_TIME = 15000; // 15 seconds

  constructor(gameId: string, playerOne: User, playerTwo: User, isNewGame = true) {
    this.gameId = gameId;
    this.playerOne = playerOne;
    this.playerTwo = playerTwo;
    this.board = new Chess();
    this.isNewGame = isNewGame;

    if (this.isNewGame) {
      this.setupErrorHandlers();
      this.initializeGame();
      this.setupWebRTCForwarding();
      this.startClock(); // Start once
      this.offerInterval = setInterval(() => {
        this.attemptSendStoredOffers();
      }, 2000);
    }
  }

  async initializeGame() {
    this.isGameActive = true;
    await redis.hset(`game:${this.gameId}`, { isGameActive: "true", playerOneClock: "600", playerTwoClock: "600", moveCount: "0" });
    await GameRepository.saveGame(this);

    this.sendToPlayer(this.playerOne.socket, {
      type: INIT_GAME,
      payload: { color: "white", gameId: this.gameId },
    });

    this.sendToPlayer(this.playerTwo.socket, {
      type: INIT_GAME,
      payload: { color: "black", gameId: this.gameId },
    });

    console.log(`Game initialized: ${this.gameId}`);
  }

  startClock() {
    if (this.clockInterval) clearInterval(this.clockInterval);

    this.clockInterval = setInterval(async () => {
      if (!this.isGameActive) return;

      const gameData = await redis.hgetall(`game:${this.gameId}`);
      if (gameData?.isGameActive !== "true") return;

      let white = parseInt((gameData.playerOneClock ?? "600").toString(), 10);
      let black = parseInt((gameData.playerTwoClock ?? "600").toString(), 10);
      let count = parseInt((gameData.moveCount ?? "0").toString(), 10);

      // Decrement correct player's clock
      if (count % 2 === 0) white--;
      else black--;

      await redis.hset(`game:${this.gameId}`, {
        playerOneClock: white.toString(),
        playerTwoClock: black.toString(),
      });

      const clockUpdate = { type: CLOCK_UPDATE, payload: { white, black } };
      this.sendToPlayer(this.playerOne.socket, clockUpdate);
      this.sendToPlayer(this.playerTwo.socket, clockUpdate);

      if (white <= 0 || black <= 0) {
        const winner = white <= 0 ? "black" : "white";
        this.endGame(winner);
      }
    }, 1000);
  }

  stopClock() {
    if (this.clockInterval) clearInterval(this.clockInterval);
    this.clockInterval = null;
  }

  private setupErrorHandlers() {
    const handleDisconnect = (label: string) => () => {
      console.log(`${label} disconnected`);

      if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);

      this.disconnectTimeout = setTimeout(() => {
        if (this.isGameActive) {
          console.log("Ending game due to disconnect timeout");
          const winner = label === "playerOne" ? "black" : "white";
          this.endGame(winner);
        }
      }, this.DISCONNECT_GRACE_TIME);
    };

    this.playerOne.socket?.on("error", handleDisconnect("playerOne"));
    this.playerOne.socket?.on("close", handleDisconnect("playerOne"));
    this.playerTwo.socket?.on("error", handleDisconnect("playerTwo"));
    this.playerTwo.socket?.on("close", handleDisconnect("playerTwo"));
  }

  private sendToPlayer(player: WebSocket | null, message: any) {
    if (player && player.readyState === WebSocket.OPEN) {
      try {
        player.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error("Send failed:", err);
      }
    }
    return false;
  }

  private async attemptSendStoredOffers() {
    const offers = await redis.lrange(`offers:${this.gameId}`, 0, -1);
    if (offers.length > 0 && this.playerTwo.socket && this.playerTwo.socket.readyState === WebSocket.OPEN) {
      for (const offer of offers) {
        const parsed = JSON.parse(offer);
        const sent = this.sendToPlayer(this.playerTwo.socket, { type: WEBRTC_OFFER, payload: parsed });
        if (sent) await redis.lrem(`offers:${this.gameId}`, 0, offer);
      }
    }
  }

  setupWebRTCForwarding() {
    const forward = (sender: WebSocket | null, receiver: WebSocket | null) => {
      const handler = async (data: string) => {
        const msg = JSON.parse(data);
        if (!this.isGameActive) return;

        if (msg.type === WEBRTC_OFFER) {
          if (receiver && receiver.readyState === WebSocket.OPEN) {
            this.sendToPlayer(receiver, msg);
          } else {
            await redis.rpush(`offers:${this.gameId}`, JSON.stringify(msg.payload));
          }
        } else if ([WEBRTC_ANSWER, ICE_CANDIDATE].includes(msg.type)) {
          if (receiver && receiver.readyState === WebSocket.OPEN) {
            this.sendToPlayer(receiver, msg);
          }
        }
      };

      sender?.on("message", handler);
      return handler;
    };

    this.webrtcHandlers.playerOne = forward(this.playerOne.socket, this.playerTwo.socket);
    this.webrtcHandlers.playerTwo = forward(this.playerTwo.socket, this.playerOne.socket);
  }

  async makeMove(user: WebSocket, move: move) {
    const gameData = await redis.hgetall(`game:${this.gameId}`);
    const isGameActive = gameData?.isGameActive === "true";
    if (!isGameActive) return;

    const isWhite = user === this.playerOne.socket;
    if ((this.moveCount % 2 === 0 && !isWhite) || (this.moveCount % 2 === 1 && isWhite)) return;

    const result = this.board.move(move);
    if (!result) {
      const msg = { type: INVALID_MOVE, payload: { message: "Invalid move" } };
      this.sendToPlayer(this.playerOne.socket, msg);
      this.sendToPlayer(this.playerTwo.socket, msg);
      return;
    }

    this.moveCount++;
    await redis.hset(`game:${this.gameId}`, { moveCount: this.moveCount.toString() });
    await GameRepository.updateGame(this);
    await redis.rpush(`moves:${this.gameId}`, JSON.stringify(move));

    const moveMsg = { type: MOVE, payload: { move } };
    this.sendToPlayer(this.playerOne.socket, moveMsg);
    this.sendToPlayer(this.playerTwo.socket, moveMsg);

    if (this.board.isGameOver()) {
      const winner = this.moveCount % 2 === 1 ? "white" : "black";
      this.endGame(winner);
    }
  }

  sendMessage(message: string, sender: WebSocket) {
    const msg = { type: MESSAGE, payload: message };
    if (sender === this.playerOne.socket) {
      this.sendToPlayer(this.playerTwo.socket, msg);
    } else {
      this.sendToPlayer(this.playerOne.socket, msg);
    }
  }

  async endGame(winner?: string) {
    if (!this.isGameActive) return;
    this.isGameActive = false;

    if (winner) {
      const gameOverMsg = { type: GAME_OVER, payload: { winner } };
      this.sendToPlayer(this.playerOne.socket, gameOverMsg);
      this.sendToPlayer(this.playerTwo.socket, gameOverMsg);
    }

    await redis.hset(`game:${this.gameId}`, { isGameActive: "false" });
    await GameRepository.updateGame(this);
    await this.cleanupGame();
  }

  // In Game.ts

handlePlayerDisconnect(user: User) {
  const label = (user.id === this.playerOne.id) ? "playerOne" : "playerTwo";

  console.log(`${label} disconnected (via GameManager)`);

  if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);

  this.disconnectTimeout = setTimeout(() => {
    if (this.isGameActive) {
      console.log("Ending game due to disconnect timeout");
      const winner = label === "playerOne" ? "black" : "white";
      this.endGame(winner);
    }
  }, this.DISCONNECT_GRACE_TIME);
}


  async cleanupGame() {
    this.stopClock();

    if (this.offerInterval) {
      clearInterval(this.offerInterval);
      this.offerInterval = null;
    }

    if (this.webrtcHandlers.playerOne) {
      this.playerOne.socket?.removeListener("message", this.webrtcHandlers.playerOne);
    }
    if (this.webrtcHandlers.playerTwo) {
      this.playerTwo.socket?.removeListener("message", this.webrtcHandlers.playerTwo);
    }

    await GameRepository.deleteGame(this.gameId);
    await redis.del(`moves:${this.gameId}`, `offers:${this.gameId}`);
    console.log(`Cleaned up game ${this.gameId}`);
  }
}
