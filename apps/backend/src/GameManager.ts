import {
  INIT_GAME,
  MOVE,
  FORFEIT,
  DRAW_OFFER,
  DRAW_ACCEPTED,
  RECONNECT,
  ANSWER,
  OFFER,
  ICE_CANDIDATE,
  START_OFFER,
  STATUS,
  WAITING_FOR_OPPONENT,
} from "./constants";
import { Game } from "./Game";
import { Player } from "./Player";
import { move } from "./types";
import { generateGameId } from "./utils";

export class GameManager {
  games: Map<string, Game>;
  pendingUser: Player | null;
  private static instance: GameManager;
  private playerGameMap: Map<string, string>;

  // In a production environment, you would use a more robust
  // solution to manage multiple active connections, like a map of maps.
  // For this architecture, we will simply rely on the playerGameMap
  // to find the opponent.

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

  /**
   * Adds a new player to the matchmaking queue or starts a new game.
   * This method is the entry point for the "join" message.
   */
  addPlayer(player: Player) {
    if (this.pendingUser) {
      // A player is already waiting, so let's match them.
      const partner = this.pendingUser;

      // Create a new game with the pending user and current player
      const gameId = generateGameId();
      const game = new Game(gameId, partner, player);

      this.games.set(gameId, game);

      // Map both players to this game
      this.playerGameMap.set(partner.id, gameId);
      this.playerGameMap.set(player.id, gameId);

      console.log(
        `[GameManager] Game ${gameId} created between ${partner.id} and ${player.id}`
      );
      
      // *** NEW LOGS FOR WEBRTC ***
      console.log(`[WebRTC] Game ${gameId}: Notifying ${partner.id} (Player 1) to create and send the offer.`);
      
      // Now, we tell the first player to start the offer process.
      partner.socket.send(
        JSON.stringify({
          type: START_OFFER,
          payload: { gameId: gameId },
        })
      );
      
      // *** NEW LOGS FOR WEBRTC ***
      console.log(`[WebRTC] Game ${gameId}: Notifying ${player.id} (Player 2) to wait for the offer.`);

      // The new player is now waiting for the offer from the partner.
      player.socket.send(
        JSON.stringify({
          type: STATUS,
          payload: {
            message: "Partner found. Waiting for offer...",
            gameId: gameId,
          },
        })
      );

      // Clear the pending user as the match is made.
      this.pendingUser = null;

      // Initialize the chess game, not the WebRTC call.
      game.initGame();
    } else {
      // No one is waiting, so this player enters the queue.
      this.pendingUser = player;
      player.socket.send(JSON.stringify({ type: WAITING_FOR_OPPONENT }));
      console.log(
        `[GameManager] Player ${player.id} is waiting for an opponent`
      );
    }
  }

  /**
   * Handles incoming messages from a player's WebSocket connection.
   */
  handleMessage(player: Player) {
    player.socket.on("message", async (message: string) => {
      let msg;
      try {
        msg = JSON.parse(message);
      } catch (error) {
        console.error("[GameManager] Invalid JSON message:", error);
        return;
      }

      console.log(
        `[GameManager] Received message of type '${msg.type}' from ${player.id}`
      );

      switch (msg.type) {
        case INIT_GAME:
          this.addPlayer(player);
          break;

        case OFFER:
          this.handleOffer(player, msg.payload);
          break;

        case ANSWER:
          this.handleAnswer(player, msg.payload);
          break;

        case ICE_CANDIDATE:
          this.handleIceCandidate(player, msg.payload);
          break;

        case MOVE:
          this.handleMove(player, msg.payload.move, msg.payload.gameId);
          break;

        case FORFEIT:
          this.handleForfeit(player, msg.payload.gameId);
          break;

        case DRAW_OFFER:
          this.handleDrawOffer(player, msg.payload.gameId);
          break;

        case DRAW_ACCEPTED:
          this.handleDrawAccepted(player, msg.payload.gameId);
          break;

        case RECONNECT:
          this.handleReconnect(player, msg.payload.gameId);
          break;

        case "MESSAGE":
          this.handleChatMessage(
            player,
            msg.payload.message,
            msg.payload.gameId
          );
          break;

        default:
          console.warn(`[GameManager] Unknown message type: ${msg.type}`);
          break;
      }
    });

    // Handle player disconnect
    player.socket.on("close", () => {
      this.handlePlayerDisconnect(player);
    });
  }

  /**
   * A helper to find the opposing player in an active game.
   */
  private getPartner(player: Player): Player | null {
    const gameId = this.playerGameMap.get(player.id);
    if (!gameId) {
        // *** NEW LOGS FOR WEBRTC ***
        console.error(`[WebRTC] getPartner failed: Player ${player.id} not found in playerGameMap.`);
        return null;
    }

    const game = this.games.get(gameId);
    if (!game) {
        // *** NEW LOGS FOR WEBRTC ***
        console.error(`[WebRTC] getPartner failed: Game ${gameId} not found for player ${player.id}.`);
        return null;
    }

    // Determine who the other player is
    if (game.white.id === player.id) {
      return game.black;
    } else if (game.black.id === player.id) {
      return game.white;
    }
    
    // *** NEW LOGS FOR WEBRTC ***
    console.error(`[WebRTC] getPartner failed: Player ${player.id} is not part of game ${gameId}.`);
    return null;
  }

  /**
   * Handles an incoming WebRTC offer and forwards it to the partner.
   */
  handleOffer(player: Player, payload: any) {
    const gameId = this.playerGameMap.get(player.id);
    // *** NEW LOGS FOR WEBRTC ***
    console.log(`[WebRTC] Received OFFER from ${player.id} for game ${gameId}`);
    if (payload.sdp) {
        console.log(`[WebRTC] Offer SDP type: ${payload.sdp.type}`);
    }

    const partner = this.getPartner(player);
    if (!partner) {
      console.error(
        `[WebRTC] CRITICAL: Could not find partner for player ${player.id} to forward OFFER.`
      );
      return;
    }

    const offerPayload = {
      ...payload,
      gameId: gameId,
    };

    partner.socket.send(
      JSON.stringify({
        type: OFFER,
        payload: offerPayload,
      })
    );
    // *** NEW LOGS FOR WEBRTC ***
    console.log(`[WebRTC] Forwarding OFFER from ${player.id} to ${partner.id}`);
  }

  /**
   * Handles an incoming WebRTC answer and forwards it to the partner.
   */
  handleAnswer(player: Player, payload: any) {
    const gameId = this.playerGameMap.get(player.id);
    // *** NEW LOGS FOR WEBRTC ***
    console.log(`[WebRTC] Received ANSWER from ${player.id} for game ${gameId}`);
    if (payload.sdp) {
        console.log(`[WebRTC] Answer SDP type: ${payload.sdp.type}`);
    }

    const partner = this.getPartner(player);
    if (!partner) {
      console.error(
        `[WebRTC] CRITICAL: Could not find partner for player ${player.id} to forward ANSWER.`
      );
      return;
    }

    const answerPayload = {
      ...payload,
      gameId: gameId,
    };

    partner.socket.send(
      JSON.stringify({
        type: ANSWER,
        payload: answerPayload,
      })
    );
    // *** NEW LOGS FOR WEBRTC ***
    console.log(`[WebRTC] Forwarding ANSWER from ${player.id} to ${partner.id}`);
  }

  /**
   * Handles an incoming ICE candidate and forwards it to the partner.
   */
  handleIceCandidate(player: Player, payload: any) {
    const gameId = this.playerGameMap.get(player.id);
    // *** NEW LOGS FOR WEBRTC ***
    console.log(`[WebRTC] Received ICE_CANDIDATE from ${player.id} for game ${gameId}`);
    if (!payload.candidate) {
        console.log(`[WebRTC] Received null ICE candidate, signaling end of candidates from ${player.id}.`);
    }

    const partner = this.getPartner(player);
    if (!partner) {
      console.error(
        `[WebRTC] CRITICAL: Could not find partner for player ${player.id} to forward ICE_CANDIDATE.`
      );
      return;
    }

    const candidatePayload = {
      ...payload,
      gameId: gameId,
    };

    partner.socket.send(
      JSON.stringify({
        type: ICE_CANDIDATE,
        payload: candidatePayload,
      })
    );
    // *** NEW LOGS FOR WEBRTC ***
    console.log(`[WebRTC] Forwarding ICE_CANDIDATE from ${player.id} to ${partner.id}`);
  }

  // Existing game logic methods
  // ... (Your existing handleMove, handleGameOver, etc.) ...
  handleMove(player: Player, move: move, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found`);
      return;
    }
    game.makeMove(player, move);
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

  handleDrawAccepted(player: Player, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found`);
      return;
    }
    game.acceptDraw(player);
    this.cleanupGame(gameId);
    console.log(
      `[GameManager] Player ${player.id} accepted draw in game ${gameId}`
    );
  }

  handleReconnect(player: Player, gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[GameManager] Game ${gameId} not found for reconnection`);
      return;
    }
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

  handleChatMessage(player: Player, message: string, gameId: string) {
    const partner = this.getPartner(player);
    if (!partner) {
        console.log(`[GameManager] Could not find partner for player ${player.id} to forward message.`);
        return;
    }

    // Forward the message to the partner
    partner.socket.send(JSON.stringify({
        type: 'MESSAGE',
        payload: { 
            message: message,
            gameId: gameId
        }
    }));
    
    console.log(`[GameManager] Message from ${player.id} forwarded to ${partner.id}`);
}

  private cleanupGame(gameId: string) {
    const game = this.games.get(gameId);
    if (game) {
      game.destroy();

      if (game.white && game.white.id) {
        this.playerGameMap.delete(game.white.id);
      }
      if (game.black && game.black.id) {
        this.playerGameMap.delete(game.black.id);
      }
      this.games.delete(gameId);
    }
  }
  
  handlePlayerDisconnect(player: Player) {
    if (this.pendingUser && this.pendingUser.id === player.id) {
      this.pendingUser = null;
      console.log(`[GameManager] Pending player ${player.id} disconnected`);
      return;
    }
    const gameId = this.playerGameMap.get(player.id);
    if (gameId) {
      const game = this.games.get(gameId);
      if (game && game.isGameActive) {
        console.log(
          `[GameManager] Player ${player.id} disconnected from active game ${gameId}, opponent wins by forfeit.`
        );
        // *** NEW LOGS FOR WEBRTC ***
        console.log(`[WebRTC] Disconnect from ${player.id} will require the other player in game ${gameId} to handle a broken peer connection.`);
        game.forfeit(player);
        this.cleanupGame(gameId);
      }
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
  
  getGameStats() {
    return {
      activeGames: this.games.size,
      pendingPlayers: this.pendingUser ? 1 : 0,
      totalPlayersInGames: this.playerGameMap.size,
    };
  }
  
  forceEndGame(gameId: string, reason: string = "Force ended by admin") {
    const game = this.games.get(gameId);
    if (game) {
      console.log(`[GameManager] Force ending game ${gameId}: ${reason}`);
      this.cleanupGame(gameId);
    }
  }
}