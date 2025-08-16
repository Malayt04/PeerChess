import { GAME_OVER, INIT_GAME, MOVE, FORFEIT, DRAW_OFFER, RECONNECT } from "./constants"
import { Game } from "./Game"
import { Player } from "./Player"
import { move } from "./types"
import { generateGameId } from './utils';

export class GameManager {
    games: Map<string, Game>
    pendingUser: Player | null
    private static instance: GameManager
    private playerGameMap: Map<string, string> 

    private constructor() {
        this.games = new Map<string, Game>()
        this.pendingUser = null
        this.playerGameMap = new Map<string, string>()
    }

    public static getInstance(): GameManager {
        if (!this.instance) {
            this.instance = new GameManager()
        }
        return this.instance
    }

    addPlayer(player: Player) {
        if (this.pendingUser) {
            // Create a new game with the pending user and current player
            const gameId = generateGameId()
            const game = new Game(gameId, this.pendingUser, player)
            
            this.games.set(gameId, game)
            
            // Map both players to this game
            this.playerGameMap.set(this.pendingUser.id, gameId)
            this.playerGameMap.set(player.id, gameId)
            
            // Initialize the game
            game.initGame()
            
            console.log(`[GameManager] Game ${gameId} created between ${this.pendingUser.id} and ${player.id}`)
            
            this.pendingUser = null
        } else {
            // Set this player as pending
            this.pendingUser = player
            player.socket.send(JSON.stringify({ type: "WAITING_FOR_OPPONENT"}))
            console.log(`[GameManager] Player ${player.id} is waiting for an opponent`)
        }
    }

    handleMessage(player: Player) {
        player.socket.on("message", (message: string) => {
            let msg
            try {
                msg = JSON.parse(message)
            } catch (error) {
                console.log("[GameManager] Invalid JSON message:", error)
                return
            }

            console.log(`[GameManager] Received message from ${player.id}:`, msg.type)

            switch (msg.type) {
                case INIT_GAME:
                    this.addPlayer(player)
                    break
                case MOVE:
                    this.handleMove(player, msg.payload.move, msg.payload.gameId)
                    break
                case GAME_OVER:
                    this.handleGameOver(player, msg.payload.gameId)
                    break
                case FORFEIT:
                    this.handleForfeit(player, msg.payload.gameId)
                    break
                case DRAW_OFFER:
                    this.handleDrawOffer(player, msg.payload.gameId)
                    break
                case RECONNECT:
                    this.handleReconnect(player, msg.payload.gameId)
                    break
                default:
                    console.log(`[GameManager] Unknown message type: ${msg.type}`)
                    break
            }
        })

        // Handle player disconnect
        player.socket.on("disconnect", () => {
            this.handlePlayerDisconnect(player)
        })
    }

    handleMove(player: Player, move: move, gameId: string) {
        const game = this.games.get(gameId)
        if (!game) {
            console.log(`[GameManager] Game ${gameId} not found`)
            return
        }

        game.makeMove(player, move)
    }

    handleGameOver(player: Player, gameId: string) {
        const game = this.games.get(gameId)
        if (!game) {
            console.log(`[GameManager] Game ${gameId} not found`)
            return
        }

        // Clean up the game
        this.cleanupGame(gameId)
        console.log(`[GameManager] Game ${gameId} ended and cleaned up`)
    }

    handleForfeit(player: Player, gameId: string) {
        const game = this.games.get(gameId)
        if (!game) {
            console.log(`[GameManager] Game ${gameId} not found`)
            return
        }

        game.forfeit(player)
        this.cleanupGame(gameId)
        console.log(`[GameManager] Player ${player.id} forfeited game ${gameId}`)
    }

    handleDrawOffer(player: Player, gameId: string) {
        const game = this.games.get(gameId)
        if (!game) {
            console.log(`[GameManager] Game ${gameId} not found`)
            return
        }

        game.offerDraw(player)
        console.log(`[GameManager] Player ${player.id} offered draw in game ${gameId}`)
    }

    handleReconnect(player: Player, gameId: string) {
        const game = this.games.get(gameId)
        if (!game) {
            console.log(`[GameManager] Game ${gameId} not found for reconnection`)
            return
        }

        // Send current game state to reconnecting player
        const gameState = game.getGameState()
        player.socket.send(JSON.stringify({
            type: "GAME_STATE",
            payload: gameState
        }))

        console.log(`[GameManager] Player ${player.id} reconnected to game ${gameId}`)
    }

    handlePlayerDisconnect(player: Player) {
        // Remove from pending if they were waiting
        if (this.pendingUser && this.pendingUser.id === player.id) {
            this.pendingUser = null
            console.log(`[GameManager] Pending player ${player.id} disconnected`)
            return
        }

        // Find their active game
        const gameId = this.playerGameMap.get(player.id)
        if (gameId) {
            const game = this.games.get(gameId)
            if (game && game.isGameActive) {
                // For now, we'll just log the disconnect
                // You might want to pause the game or handle differently
                console.log(`[GameManager] Player ${player.id} disconnected from active game ${gameId}`)
                
                // Optional: Auto-forfeit after some time or pause the game
                // game.forfeit(player);
                // this.cleanupGame(gameId);
            }
        }
    }


    private cleanupGame(gameId: string) {
        const game = this.games.get(gameId)
        if (game) {
            // Clean up the game resources
            game.destroy()
            
            // Remove players from the map
            if (game.white && game.white.id) {
                this.playerGameMap.delete(game.white.id)
            }
            if (game.black && game.black.id) {
                this.playerGameMap.delete(game.black.id)
            }
            
            // Remove the game
            this.games.delete(gameId)
        }
    }

    // Utility methods
    getActiveGamesCount(): number {
        return this.games.size
    }

    getPlayerGame(playerId: string): Game | null {
        const gameId = this.playerGameMap.get(playerId)
        return gameId ? this.games.get(gameId) || null : null
    }

    isPlayerInGame(playerId: string): boolean {
        return this.playerGameMap.has(playerId)
    }

    // Method to get game statistics
    getGameStats() {
        return {
            activeGames: this.games.size,
            pendingPlayers: this.pendingUser ? 1 : 0,
            totalPlayersInGames: this.playerGameMap.size
        }
    }

    // Method to force end a game (admin function)
    forceEndGame(gameId: string, reason: string = "Force ended by admin") {
        const game = this.games.get(gameId)
        if (game) {
            // You might want to add a forceEnd method to the Game class
            console.log(`[GameManager] Force ending game ${gameId}: ${reason}`)
            this.cleanupGame(gameId)
        }
    }
}