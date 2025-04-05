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
import { move } from './types';
import { User } from "./User";

export class Game {
  playerOne: User;
  playerTwo: User;
  gameId: string;
  board: Chess;
  clockInterval: NodeJS.Timeout | null = null;
  offerInterval: NodeJS.Timeout | null = null;
  moveCount: number = 0;
  isGameActive: boolean = true;
  private webrtcHandlers: { playerOne: any, playerTwo: any } = { playerOne: null, playerTwo: null };

  constructor(gameId: string, playerOne: User, playerTwo: User) {
    this.gameId = gameId;
    this.playerOne = playerOne;
    this.playerTwo = playerTwo;
    this.board = new Chess();

    this.setupErrorHandlers();
    this.initializeGame();
    this.setupWebRTCForwarding();
    this.startClock();

    // Retry sending WebRTC offers every 2s if needed
    this.offerInterval = setInterval(() => {
      this.attemptSendStoredOffers();
    }, 2000);
  }

  async initializeGame() {
    await redis.hset(`game:${this.gameId}`, {
      playerOneClock: 600,
      playerTwoClock: 600,
      board: this.board.fen(),
      isGameActive: 'true',
      moveCount: '0',
    });

    this.sendToPlayer(this.playerOne.socket, {
      type: INIT_GAME,
      payload: { color: "white", gameId: this.gameId },
    });

    this.sendToPlayer(this.playerTwo.socket, {
      type: INIT_GAME,
      payload: { color: "black", gameId: this.gameId },
    });

    await this.attemptSendStoredOffers();
  }

  async startClock() {
    if (this.clockInterval) clearInterval(this.clockInterval);

    this.clockInterval = setInterval(async () => {
      const gameData = await redis.hgetall(`game:${this.gameId}`);
      if (!this.isGameActive || !gameData?.isGameActive) return;

      let white = parseInt((gameData.playerOneClock ?? '600').toString());
      let black = parseInt((gameData.playerTwoClock ?? '600').toString());
      let count = parseInt((gameData.moveCount ?? '0').toString());
      

      if (count % 2 === 0) white--
      else black--

      await redis.hset(`game:${this.gameId}`, {
        playerOneClock: white,
        playerTwoClock: black,
      });

      const clockUpdate = {
        type: CLOCK_UPDATE,
        payload: { white, black },
      };

      this.sendToPlayer(this.playerOne.socket, clockUpdate);
      this.sendToPlayer(this.playerTwo.socket, clockUpdate);

      if (white <= 0 || black <= 0) {
        const winner = white <= 0 ? "black" : "white";
        const gameOverMessage = {
          type: GAME_OVER,
          payload: { winner },
        };

        this.sendToPlayer(this.playerOne.socket, gameOverMessage);
        this.sendToPlayer(this.playerTwo.socket, gameOverMessage);
        this.endGame();
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
      this.cleanupGame();
    };

    this.playerOne.socket.on("error", handleDisconnect("playerOne"));
    this.playerOne.socket.on("close", handleDisconnect("playerOne"));

    this.playerTwo.socket.on("error", handleDisconnect("playerTwo"));
    this.playerTwo.socket.on("close", handleDisconnect("playerTwo"));
  }

  private sendToPlayer(player: WebSocket, message: any) {
    if (player.readyState === WebSocket.OPEN) {
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
    if (offers.length > 0 && this.playerTwo.socket.readyState === WebSocket.OPEN) {
      for (const offer of offers) {
        const parsed = JSON.parse(offer);
        const sent = this.sendToPlayer(this.playerTwo.socket, {
          type: WEBRTC_OFFER,
          payload: parsed,
        });
        if (sent) await redis.lrem(`offers:${this.gameId}`, 0, offer);
      }
    }
  }

  setupWebRTCForwarding() {
    const forward = (sender: WebSocket, receiver: WebSocket, senderName: string) => {
      const handler = async (data: string) => {
        const msg = JSON.parse(data);
        if (!this.isGameActive) return;

        if (msg.type === WEBRTC_OFFER) {
          if (receiver.readyState === WebSocket.OPEN) {
            this.sendToPlayer(receiver, msg);
          } else {
            await redis.rpush(`offers:${this.gameId}`, JSON.stringify(msg.payload));
          }
        } else if ([WEBRTC_ANSWER, ICE_CANDIDATE].includes(msg.type)) {
          if (receiver.readyState === WebSocket.OPEN) {
            this.sendToPlayer(receiver, msg);
          }
        }
      };

      sender.on("message", handler);
      return handler;
    };

    this.webrtcHandlers.playerOne = forward(this.playerOne.socket, this.playerTwo.socket, 'playerOne');
    this.webrtcHandlers.playerTwo = forward(this.playerTwo.socket, this.playerOne.socket, 'playerTwo');
  }

  async makeMove(user: WebSocket, move: move) {
    if (!this.isGameActive) return;

    const count = parseInt(await redis.hget(`game:${this.gameId}`, "moveCount") || '0');
    const isWhite = user === this.playerOne.socket;

    if ((count % 2 === 0 && !isWhite) || (count % 2 === 1 && isWhite)) return;

    try {
      this.board.move(move);
    } catch {
      const msg = { type: INVALID_MOVE, payload: { message: "Invalid move" } };
      this.sendToPlayer(this.playerOne.socket, msg);
      this.sendToPlayer(this.playerTwo.socket, msg);
      return;
    }

    await redis.hset(`game:${this.gameId}`, {
      board: this.board.fen(),
      moveCount: (count + 1).toString(),
    });
    await redis.rpush(`moves:${this.gameId}`, JSON.stringify(move));

    const moveMsg = { type: MOVE, payload: { move } };
    this.sendToPlayer(this.playerOne.socket, moveMsg);
    this.sendToPlayer(this.playerTwo.socket, moveMsg);

    if (this.board.isGameOver()) {
      const winner = count % 2 === 0 ? "white" : "black";
      const gameOverMsg = { type: GAME_OVER, payload: { winner } };
      this.sendToPlayer(this.playerOne.socket, gameOverMsg);
      this.sendToPlayer(this.playerTwo.socket, gameOverMsg);
      this.endGame();
    } else {
      this.startClock();
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

  async endGame() {
    this.isGameActive = false;
    await redis.hset(`game:${this.gameId}`, { isGameActive: 'false' });
    this.cleanupGame();
  }

  async cleanupGame() {
    if (!this.isGameActive) return;
    this.isGameActive = false;

    this.stopClock();

    if (this.offerInterval) {
      clearInterval(this.offerInterval);
      this.offerInterval = null;
    }

    // Clear WebSocket listeners
    if (this.webrtcHandlers.playerOne) this.playerOne.socket.removeListener("message", this.webrtcHandlers.playerOne);
    if (this.webrtcHandlers.playerTwo) this.playerTwo.socket.removeListener("message", this.webrtcHandlers.playerTwo);

    // Clear Redis data
    await redis.del(`game:${this.gameId}`, `moves:${this.gameId}`, `offers:${this.gameId}`);
  }


}
