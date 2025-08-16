import { MediaKind, RtpParameters, RtpCapabilities } from "mediasoup/node/lib/rtpParametersTypes";
import { DtlsParameters } from "mediasoup/node/lib/WebRtcTransportTypes";
import {
  GAME_OVER,
  INIT_GAME,
  MOVE,
  FORFEIT,
  DRAW_OFFER,
  RECONNECT,
  CONNECT_WEBRTC_TRANSPORT,
  CONSUME,
  CREATE_WEBRTC_TRANSPORT,
  GET_ROUTER_RTP_CAPABILITIES,
  PRODUCE,
  RESUME,
} from "./constants";
import { Game } from "./Game";
import { Player } from "./Player";
import { move } from "./types";
import { generateGameId, sendPlayer } from "./utils";

import { Worker } from "mediasoup/node/lib/WorkerTypes";

export class GameManager {
  games: Map<string, Game>;
  pendingUser: Player | null;
  private static instance: GameManager;
  private playerGameMap: Map<string, string>;

  private constructor() {
    this.games = new Map<string, Game>();
    this.pendingUser = null;
    this.playerGameMap = new Map<string, string>();
  }

  public static getInstance(): GameManager {
    if (!this.instance) {
      this.instance = new GameManager();
    }
    return this.instance;
  }

  addPlayer(player: Player, worker: Worker) {
    if (this.pendingUser) {
      // Create a new game with the pending user and current player
      const gameId = generateGameId();
      const game = new Game(gameId, this.pendingUser, player, worker);

      this.games.set(gameId, game);

      // Map both players to this game
      this.playerGameMap.set(this.pendingUser.id, gameId);
      this.playerGameMap.set(player.id, gameId);

      // Initialize the game
      game.initGame();

      console.log(
        `[GameManager] Game ${gameId} created between ${this.pendingUser.id} and ${player.id}`
      );

      this.pendingUser = null;
    } else {
      // Set this player as pending
      this.pendingUser = player;
      player.socket.send(JSON.stringify({ type: "WAITING_FOR_OPPONENT" }));
      console.log(
        `[GameManager] Player ${player.id} is waiting for an opponent`
      );
    }
  }

  handleMessage(player: Player, worker: Worker) {
    player.socket.on("message", (message: string) => {
      let msg;
      try {
        msg = JSON.parse(message);
      } catch (error) {
        console.log("[GameManager] Invalid JSON message:", error);
        return;
      }

      console.log(
        `[GameManager] Received message from ${player.id}:`,
        msg.type
      );

      switch (msg.type) {
        case INIT_GAME:
          this.addPlayer(player, worker);
          break;
        case MOVE:
          this.handleMove(player, msg.payload.move, msg.payload.gameId);
          break;
        case GAME_OVER:
          this.handleGameOver(player, msg.payload.gameId);
          break;
        case FORFEIT:
          this.handleForfeit(player, msg.payload.gameId);
          break;
        case DRAW_OFFER:
          this.handleDrawOffer(player, msg.payload.gameId);
          break;
        case RECONNECT:
          this.handleReconnect(player, msg.payload.gameId);
          break;
        case GET_ROUTER_RTP_CAPABILITIES:
          this.handleGetRouterRtpCapabilities(player, msg.payload.gameId);
          break;
        case CREATE_WEBRTC_TRANSPORT:
          this.handleCreateWebRtcTransport(player, msg.payload.gameId);
          break;
        case CONNECT_WEBRTC_TRANSPORT:
          this.handleConnectWebRtcTransport(player, msg.payload);
          break;
        case PRODUCE:
          this.handleProduce(player, msg.payload);
          break;
        case CONSUME:
          this.handleConsume(player, msg.payload);
          break;
        case RESUME:
          this.handleResume(player, msg.payload);
          break;
        default:
          console.log(`[GameManager] Unknown message type: ${msg.type}`);
          break;
      }
    });

    // Handle player disconnect
    player.socket.on("disconnect", () => {
      this.handlePlayerDisconnect(player);
    });
  }

  handleGetRouterRtpCapabilities(player: Player, gameId: string) {
        const game = this.games.get(gameId);
        if (game) {
            sendPlayer(player, {
                type: "GET_ROUTER_RTP_CAPABILITIES",
                payload: game.router.rtpCapabilities,
            });
        } else {
            console.log(`[GameManager] Game ${gameId} not found for RTP capabilities request`);
        }
    }

    async handleCreateWebRtcTransport(player: Player, gameId: string) {
        const game = this.games.get(gameId);
        if (game) {
            try {
                const transport = await game.createWebRtcTransport();
                sendPlayer(player, {
                    type: "CREATE_WEBRTC_TRANSPORT",
                    payload: {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    },
                });
            } catch (error) {
                console.error(`[GameManager] Error creating WebRTC transport for game ${gameId}:`, error);
            }
        } else {
            console.log(`[GameManager] Game ${gameId} not found for WebRTC transport creation`);
        }
    }

    async handleConnectWebRtcTransport(player: Player, payload: { gameId: string, transportId: string, dtlsParameters: DtlsParameters }) {
        const game = this.games.get(payload.gameId);
        if (game) {
            try {
                await game.connectWebRtcTransport(payload.transportId, payload.dtlsParameters);
                sendPlayer(player, { type: "CONNECT_WEBRTC_TRANSPORT", payload: { success: true } });
            } catch (error) {
                console.error(`[GameManager] Error connecting WebRTC transport for game ${payload.gameId}:`, error);
            }
        } else {
            console.log(`[GameManager] Game ${payload.gameId} not found for WebRTC transport connection`);
        }
    }

    async handleProduce(player: Player, payload: { gameId: string, transportId: string, kind: MediaKind, rtpParameters: RtpParameters }) {
        const game = this.games.get(payload.gameId);
        if (game) {
            try {
                const producer = await game.produce(player, payload.transportId, payload.rtpParameters, payload.kind);
                sendPlayer(player, { type: "PRODUCE", payload: { id: producer.id } });
            } catch (error) {
                console.error(`[GameManager] Error producing media for game ${payload.gameId}:`, error);
            }
        } else {
            console.log(`[GameManager] Game ${payload.gameId} not found for media production`);
        }
    }

    async handleConsume(player: Player, payload: { gameId: string, transportId: string, producerId: string, rtpCapabilities: RtpCapabilities }) {
        const game = this.games.get(payload.gameId);
        if (game) {
            try {
                const consumer = await game.consume(player, payload.transportId, payload.producerId, payload.rtpCapabilities);
                if (consumer) {
                    sendPlayer(player, {
                        type: "CONSUME",
                        payload: {
                            id: consumer.id,
                            producerId: consumer.producerId,
                            kind: consumer.kind,
                            rtpParameters: consumer.rtpParameters,
                        },
                    });
                }
            } catch (error) {
                console.error(`[GameManager] Error consuming media for game ${payload.gameId}:`, error);
            }
        } else {
            console.log(`[GameManager] Game ${payload.gameId} not found for media consumption`);
        }
    }

    async handleResume(player: Player, payload: { gameId: string, consumerId: string }) {
        const game = this.games.get(payload.gameId);
        if (game) {
            try {
                await game.resume(payload.consumerId);
                sendPlayer(player, { type: "RESUME", payload: { success: true } });
            } catch (error) {
                console.error(`[GameManager] Error resuming consumer for game ${payload.gameId}:`, error);
            }
        } else {
            console.log(`[GameManager] Game ${payload.gameId} not found for consumer resume`);
        }
    }

  handleMove(player: Player, move: move, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found`);
      return;
    }

    game.makeMove(player, move);
  }

  handleGameOver(player: Player, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found`);
      return;
    }

    // Clean up the game
    this.cleanupGame(gameId);
    console.log(`[GameManager] Game ${gameId} ended and cleaned up`);
  }

  handleForfeit(player: Player, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found`);
      return;
    }

    game.forfeit(player);
    this.cleanupGame(gameId);
    console.log(`[GameManager] Player ${player.id} forfeited game ${gameId}`);
  }

  handleDrawOffer(player: Player, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found`);
      return;
    }

    game.offerDraw(player);
    console.log(
      `[GameManager] Player ${player.id} offered draw in game ${gameId}`
    );
  }

  handleReconnect(player: Player, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found for reconnection`);
      return;
    }

    // Send current game state to reconnecting player
    const gameState = game.getGameState();
    player.socket.send(
      JSON.stringify({
        type: "GAME_STATE",
        payload: gameState,
      })
    );

    console.log(
      `[GameManager] Player ${player.id} reconnected to game ${gameId}`
    );
  }

  handlePlayerDisconnect(player: Player) {
    // Remove from pending if they were waiting
    if (this.pendingUser && this.pendingUser.id === player.id) {
      this.pendingUser = null;
      console.log(`[GameManager] Pending player ${player.id} disconnected`);
      return;
    }

    // Find their active game
    const gameId = this.playerGameMap.get(player.id);
    if (gameId) {
      const game = this.games.get(gameId);
      if (game && game.isGameActive) {
        // For now, we'll just log the disconnect
        // You might want to pause the game or handle differently
        console.log(
          `[GameManager] Player ${player.id} disconnected from active game ${gameId}`
        );

        // Optional: Auto-forfeit after some time or pause the game
        // game.forfeit(player);
        // this.cleanupGame(gameId);
      }
    }
  }

  private cleanupGame(gameId: string) {
    const game = this.games.get(gameId);
    if (game) {
      // Clean up the game resources
      game.destroy();

      // Remove players from the map
      if (game.white && game.white.id) {
        this.playerGameMap.delete(game.white.id);
      }
      if (game.black && game.black.id) {
        this.playerGameMap.delete(game.black.id);
      }

      // Remove the game
      this.games.delete(gameId);
    }
  }

  // Utility methods
  getActiveGamesCount(): number {
    return this.games.size;
  }

  getPlayerGame(playerId: string): Game | null {
    const gameId = this.playerGameMap.get(playerId);
    return gameId ? this.games.get(gameId) || null : null;
  }

  isPlayerInGame(playerId: string): boolean {
    return this.playerGameMap.has(playerId);
  }

  // Method to get game statistics
  getGameStats() {
    return {
      activeGames: this.games.size,
      pendingPlayers: this.pendingUser ? 1 : 0,
      totalPlayersInGames: this.playerGameMap.size,
    };
  }

  // Method to force end a game (admin function)
  forceEndGame(gameId: string, reason: string = "Force ended by admin") {
    const game = this.games.get(gameId);
    if (game) {
      // You might want to add a forceEnd method to the Game class
      console.log(`[GameManager] Force ending game ${gameId}: ${reason}`);
      this.cleanupGame(gameId);
    }
  }
}
