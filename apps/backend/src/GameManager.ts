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
  private webrtcStats: Map<string, { 
    offerSent?: number, 
    answerReceived?: number, 
    iceCandidatesCount: number,
    connectionState?: string 
  }>;

  // In a production environment, you would use a more robust
  // solution to manage multiple active connections, like a map of maps.
  // For this architecture, we will simply rely on the playerGameMap
  // to find the opponent.

  private constructor() {
    this.games = new Map<string, Game>();
    this.pendingUser = null;
    this.playerGameMap = new Map<string, string>();
    this.webrtcStats = new Map();
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

      // Initialize WebRTC stats tracking
      this.webrtcStats.set(gameId, { iceCandidatesCount: 0 });

      console.log(
        `[GameManager] Game ${gameId} created between ${partner.id} and ${player.id}`
      );
      
      // *** ENHANCED LOGS FOR WEBRTC ***
      console.log(`[WebRTC] Game ${gameId}: Initializing WebRTC connection setup`);
      console.log(`[WebRTC] Game ${gameId}: ${partner.id} (Player 1/White) will be the offer initiator`);
      console.log(`[WebRTC] Game ${gameId}: ${player.id} (Player 2/Black) will be the answer responder`);
      console.log(`[WebRTC] Game ${gameId}: Starting WebRTC handshake process...`);
      
      // Now, we tell the first player to start the offer process.
      const startOfferMessage = {
        type: START_OFFER,
        payload: { gameId: gameId },
      };
      
      partner.socket.send(JSON.stringify(startOfferMessage));
      
      console.log(`[WebRTC] Game ${gameId}: START_OFFER message sent to ${partner.id}`);
      console.log(`[WebRTC] Exact message sent:`, JSON.stringify(startOfferMessage, null, 2));
      console.log(`[WebRTC] Game ${gameId}: Waiting for ${partner.id} to create and send SDP offer...`);

      // The new player is now waiting for the offer from the partner.
      const statusMessage = {
        type: STATUS,
        payload: {
          message: "Partner found. Waiting for offer...",
          gameId: gameId,
        },
      };

      player.socket.send(JSON.stringify(statusMessage));

      console.log(`[WebRTC] Game ${gameId}: STATUS message sent to ${player.id} - waiting for offer`);
      console.log(`[WebRTC] Exact message sent:`, JSON.stringify(statusMessage, null, 2));

      // Clear the pending user as the match is made.
      this.pendingUser = null;

      // Initialize the chess game, not the WebRTC call.
      game.initGame();
      console.log(`[WebRTC] Game ${gameId}: Chess game initialized, WebRTC negotiation in progress`);
    } else {
      // No one is waiting, so this player enters the queue.
      this.pendingUser = player;
      player.socket.send(JSON.stringify({ type: WAITING_FOR_OPPONENT }));
      console.log(
        `[GameManager] Player ${player.id} is waiting for an opponent`
      );
      console.log(`[WebRTC] Player ${player.id}: Entered matchmaking queue, no WebRTC activity yet`);
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
      
      // Log the exact received message for WebRTC-related types
      if ([OFFER, ANSWER, ICE_CANDIDATE, START_OFFER].includes(msg.type)) {
        const logMessage = JSON.parse(JSON.stringify(msg));
        // Truncate very long SDP content for readability
        if (logMessage.payload?.sdp?.sdp && logMessage.payload.sdp.sdp.length > 200) {
          logMessage.payload.sdp.sdp = logMessage.payload.sdp.sdp.substring(0, 200) + '... [TRUNCATED]';
        }
        if (logMessage.payload?.candidate?.candidate && logMessage.payload.candidate.candidate.length > 100) {
          logMessage.payload.candidate.candidate = logMessage.payload.candidate.candidate.substring(0, 100) + '... [TRUNCATED]';
        }
        console.log(`[WebRTC] Exact message received:`, JSON.stringify(logMessage, null, 2));
      }

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
        console.error(`[WebRTC] getPartner failed: Player ${player.id} not found in playerGameMap.`);
        console.error(`[WebRTC] Debug: playerGameMap contains ${this.playerGameMap.size} entries`);
        return null;
    }

    const game = this.games.get(gameId);
    if (!game) {
        console.error(`[WebRTC] getPartner failed: Game ${gameId} not found for player ${player.id}.`);
        console.error(`[WebRTC] Debug: games map contains ${this.games.size} active games`);
        return null;
    }

    // Determine who the other player is
    if (game.white.id === player.id) {
      console.log(`[WebRTC] getPartner: Player ${player.id} is white, partner is ${game.black.id} (black)`);
      return game.black;
    } else if (game.black.id === player.id) {
      console.log(`[WebRTC] getPartner: Player ${player.id} is black, partner is ${game.white.id} (white)`);
      return game.white;
    }
    
    console.error(`[WebRTC] getPartner failed: Player ${player.id} is not part of game ${gameId}.`);
    console.error(`[WebRTC] Debug: Game ${gameId} has white=${game.white.id}, black=${game.black.id}`);
    return null;
  }

  /**
   * Handles an incoming WebRTC offer and forwards it to the partner.
   */
  handleOffer(player: Player, payload: any) {
    const gameId = this.playerGameMap.get(player.id);
    const timestamp = new Date().toISOString();
    
    console.log(`[WebRTC] ====== OFFER RECEIVED ======`);
    console.log(`[WebRTC] Timestamp: ${timestamp}`);
    console.log(`[WebRTC] From: ${player.id}`);
    console.log(`[WebRTC] Game: ${gameId}`);
    
    if (payload.sdp) {
        console.log(`[WebRTC] SDP Type: ${payload.sdp.type}`);
        console.log(`[WebRTC] SDP Size: ${payload.sdp.sdp?.length || 0} characters`);
        
        // Log first few lines of SDP for debugging (without sensitive data)
        if (payload.sdp.sdp) {
          const sdpLines = payload.sdp.sdp.split('\n').slice(0, 5);
          console.log(`[WebRTC] SDP Preview: ${sdpLines.join(' | ')}`);
        }
    } else {
        console.warn(`[WebRTC] WARNING: No SDP found in offer payload`);
    }

    const partner = this.getPartner(player);
    if (!partner) {
      console.error(`[WebRTC] CRITICAL ERROR: Could not find partner for ${player.id} to forward OFFER`);
      console.error(`[WebRTC] This will break the WebRTC handshake process`);
      return;
    }

    // Update stats
    if (gameId) {
      const stats = this.webrtcStats.get(gameId) || { iceCandidatesCount: 0 };
      stats.offerSent = Date.now();
      this.webrtcStats.set(gameId, stats);
      console.log(`[WebRTC] Stats updated: Offer sent timestamp recorded for game ${gameId}`);
    }

    const offerPayload = {
      ...payload,
      gameId: gameId,
    };

    const offerMessage = {
      type: OFFER,
      payload: offerPayload,
    };

    try {
      partner.socket.send(JSON.stringify(offerMessage));
      
      console.log(`[WebRTC] SUCCESS: OFFER forwarded from ${player.id} to ${partner.id}`);
      console.log(`[WebRTC] Exact message sent:`, JSON.stringify(offerMessage, null, 2));
      console.log(`[WebRTC] Next step: Waiting for ${partner.id} to create and send ANSWER`);
      console.log(`[WebRTC] ====== OFFER FORWARDING COMPLETE ======`);
      
    } catch (error) {
      console.error(`[WebRTC] ERROR: Failed to send OFFER to ${partner.id}:`, error);
      console.error(`[WebRTC] This will prevent WebRTC connection establishment`);
    }
  }

  /**
   * Handles an incoming WebRTC answer and forwards it to the partner.
   */
  handleAnswer(player: Player, payload: any) {
    const gameId = this.playerGameMap.get(player.id);
    const timestamp = new Date().toISOString();
    
    console.log(`[WebRTC] ====== ANSWER RECEIVED ======`);
    console.log(`[WebRTC] Timestamp: ${timestamp}`);
    console.log(`[WebRTC] From: ${player.id}`);
    console.log(`[WebRTC] Game: ${gameId}`);
    
    if (payload.sdp) {
        console.log(`[WebRTC] SDP Type: ${payload.sdp.type}`);
        console.log(`[WebRTC] SDP Size: ${payload.sdp.sdp?.length || 0} characters`);
        
        // Log first few lines of SDP for debugging
        if (payload.sdp.sdp) {
          const sdpLines = payload.sdp.sdp.split('\n').slice(0, 5);
          console.log(`[WebRTC] SDP Preview: ${sdpLines.join(' | ')}`);
        }
    } else {
        console.warn(`[WebRTC] WARNING: No SDP found in answer payload`);
    }

    const partner = this.getPartner(player);
    if (!partner) {
      console.error(`[WebRTC] CRITICAL ERROR: Could not find partner for ${player.id} to forward ANSWER`);
      console.error(`[WebRTC] This will break the WebRTC handshake process`);
      return;
    }

    // Update stats
    if (gameId) {
      const stats = this.webrtcStats.get(gameId) || { iceCandidatesCount: 0 };
      stats.answerReceived = Date.now();
      this.webrtcStats.set(gameId, stats);
      
      // Calculate handshake timing if we have both timestamps
      if (stats.offerSent && stats.answerReceived) {
        const handshakeDuration = stats.answerReceived - stats.offerSent;
        console.log(`[WebRTC] Stats: Offer-to-Answer duration: ${handshakeDuration}ms`);
      }
    }

    const answerPayload = {
      ...payload,
      gameId: gameId,
    };

    const answerMessage = {
      type: ANSWER,
      payload: answerPayload,
    };

    try {
      partner.socket.send(JSON.stringify(answerMessage));
      
      console.log(`[WebRTC] SUCCESS: ANSWER forwarded from ${player.id} to ${partner.id}`);
      console.log(`[WebRTC] Exact message sent:`, JSON.stringify(answerMessage, null, 2));
      console.log(`[WebRTC] Next step: ICE candidates exchange should begin`);
      console.log(`[WebRTC] ====== ANSWER FORWARDING COMPLETE ======`);
      
    } catch (error) {
      console.error(`[WebRTC] ERROR: Failed to send ANSWER to ${partner.id}:`, error);
      console.error(`[WebRTC] This will prevent WebRTC connection establishment`);
    }
  }

  /**
   * Handles an incoming ICE candidate and forwards it to the partner.
   */
  handleIceCandidate(player: Player, payload: any) {
    const gameId = this.playerGameMap.get(player.id);
    const timestamp = new Date().toISOString();
    
    console.log(`[WebRTC] ------ ICE CANDIDATE RECEIVED ------`);
    console.log(`[WebRTC] Timestamp: ${timestamp}`);
    console.log(`[WebRTC] From: ${player.id}`);
    console.log(`[WebRTC] Game: ${gameId}`);
    
    if (payload.candidate) {
      console.log(`[WebRTC] ICE Candidate Type: ${payload.candidate.candidate?.includes('host') ? 'host' : 
                                                   payload.candidate.candidate?.includes('srflx') ? 'server-reflexive' :
                                                   payload.candidate.candidate?.includes('relay') ? 'relay' : 'unknown'}`);
      console.log(`[WebRTC] ICE Foundation: ${payload.candidate.foundation || 'N/A'}`);
      console.log(`[WebRTC] ICE Priority: ${payload.candidate.priority || 'N/A'}`);
      console.log(`[WebRTC] ICE Protocol: ${payload.candidate.protocol || 'N/A'}`);
      
      // Extract IP address if available (be careful with privacy)
      if (payload.candidate.candidate) {
        const ipMatch = payload.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          console.log(`[WebRTC] ICE IP: ${ipMatch[1].substring(0, 7)}***`); // Partially mask IP
        }
      }
    } else {
      console.log(`[WebRTC] ICE End-of-candidates signal (null candidate)`);
      console.log(`[WebRTC] This indicates ${player.id} has finished gathering ICE candidates`);
    }

    const partner = this.getPartner(player);
    if (!partner) {
      console.error(`[WebRTC] CRITICAL ERROR: Could not find partner for ${player.id} to forward ICE_CANDIDATE`);
      console.error(`[WebRTC] This will prevent proper ICE candidate exchange`);
      return;
    }

    // Update stats
    if (gameId) {
      const stats = this.webrtcStats.get(gameId) || { iceCandidatesCount: 0 };
      if (payload.candidate) {
        stats.iceCandidatesCount++;
        console.log(`[WebRTC] Stats: Total ICE candidates exchanged in game ${gameId}: ${stats.iceCandidatesCount}`);
      }
      this.webrtcStats.set(gameId, stats);
    }

    const candidatePayload = {
      ...payload,
      gameId: gameId,
    };

    const candidateMessage = {
      type: ICE_CANDIDATE,
      payload: candidatePayload,
    };

    try {
      partner.socket.send(JSON.stringify(candidateMessage));
      
      console.log(`[WebRTC] SUCCESS: ICE_CANDIDATE forwarded from ${player.id} to ${partner.id}`);
      
      // Log exact message, but truncate SDP content for readability
      const logMessage = JSON.parse(JSON.stringify(candidateMessage));
      if (logMessage.payload?.candidate?.candidate && logMessage.payload.candidate.candidate.length > 100) {
        logMessage.payload.candidate.candidate = logMessage.payload.candidate.candidate.substring(0, 100) + '... [TRUNCATED]';
      }
      console.log(`[WebRTC] Exact message sent:`, JSON.stringify(logMessage, null, 2));
      
      if (!payload.candidate) {
        console.log(`[WebRTC] End-of-candidates forwarded - ICE gathering phase should be complete`);
      }
      console.log(`[WebRTC] ------ ICE CANDIDATE FORWARDING COMPLETE ------`);
      
    } catch (error) {
      console.error(`[WebRTC] ERROR: Failed to send ICE_CANDIDATE to ${partner.id}:`, error);
      console.error(`[WebRTC] This may cause connection establishment issues`);
    }
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
    
    // Log WebRTC status on reconnection
    const stats = this.webrtcStats.get(gameId);
    if (stats) {
      console.log(`[WebRTC] Game ${gameId} reconnection - WebRTC stats:`, stats);
      console.log(`[WebRTC] Note: Player ${player.id} may need to re-establish WebRTC connection`);
    }
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
      
      // Clean up WebRTC stats
      const stats = this.webrtcStats.get(gameId);
      if (stats) {
        console.log(`[WebRTC] Game ${gameId} cleanup - Final WebRTC stats:`, stats);
        this.webrtcStats.delete(gameId);
        console.log(`[WebRTC] WebRTC stats cleaned up for game ${gameId}`);
      }
    }
  }
  
  handlePlayerDisconnect(player: Player) {
    if (this.pendingUser && this.pendingUser.id === player.id) {
      this.pendingUser = null;
      console.log(`[GameManager] Pending player ${player.id} disconnected`);
      console.log(`[WebRTC] Player ${player.id} disconnected from matchmaking queue - no WebRTC cleanup needed`);
      return;
    }
    
    const gameId = this.playerGameMap.get(player.id);
    if (gameId) {
      const game = this.games.get(gameId);
      if (game && game.isGameActive) {
        console.log(
          `[GameManager] Player ${player.id} disconnected from active game ${gameId}, opponent wins by forfeit.`
        );
        
        // Enhanced WebRTC disconnect logging
        const stats = this.webrtcStats.get(gameId);
        console.log(`[WebRTC] ====== PLAYER DISCONNECT EVENT ======`);
        console.log(`[WebRTC] Disconnected Player: ${player.id}`);
        console.log(`[WebRTC] Game: ${gameId}`);
        console.log(`[WebRTC] Timestamp: ${new Date().toISOString()}`);
        
        if (stats) {
          console.log(`[WebRTC] Final WebRTC Stats for Game ${gameId}:`);
          console.log(`[WebRTC] - ICE Candidates Exchanged: ${stats.iceCandidatesCount}`);
          console.log(`[WebRTC] - Offer Sent: ${stats.offerSent ? new Date(stats.offerSent).toISOString() : 'N/A'}`);
          console.log(`[WebRTC] - Answer Received: ${stats.answerReceived ? new Date(stats.answerReceived).toISOString() : 'N/A'}`);
        }
        
        const partner = this.getPartner(player);
        if (partner) {
          console.log(`[WebRTC] Partner ${partner.id} will experience WebRTC connection failure`);
          console.log(`[WebRTC] Partner's WebRTC connection state should transition to 'disconnected' or 'failed'`);
        }
        
        console.log(`[WebRTC] Recommendation: Implement reconnection logic for WebRTC in client`);
        console.log(`[WebRTC] ====== DISCONNECT HANDLING COMPLETE ======`);
        
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
  
  getWebRTCStats() {
    const statsArray = Array.from(this.webrtcStats.entries()).map(([gameId, stats]) => ({
      gameId,
      ...stats,
      offerSentFormatted: stats.offerSent ? new Date(stats.offerSent).toISOString() : null,
      answerReceivedFormatted: stats.answerReceived ? new Date(stats.answerReceived).toISOString() : null,
      handshakeDuration: (stats.offerSent && stats.answerReceived) 
        ? `${stats.answerReceived - stats.offerSent}ms` 
        : null
    }));
    
    console.log(`[WebRTC] Current WebRTC Stats Summary:`, statsArray);
    return statsArray;
  }
  
  forceEndGame(gameId: string, reason: string = "Force ended by admin") {
    const game = this.games.get(gameId);
    if (game) {
      console.log(`[GameManager] Force ending game ${gameId}: ${reason}`);
      console.log(`[WebRTC] Force ending game ${gameId} will terminate any active WebRTC connections`);
      this.cleanupGame(gameId);
    }
  }
}