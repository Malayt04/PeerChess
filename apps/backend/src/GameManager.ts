import WebSocket from "ws";
import Redis from "ioredis";
import { Game } from "./Game";
import { User } from "./User";
import { INIT_GAME, MOVE, MESSAGE } from "./message";

const redis = new Redis();

export class GameManager {
    private games: Map<string, Game> = new Map();
    private pendingUser: User | null = null;

    async addUser(socket: WebSocket) {
        const user = new User(socket);
        await user.saveToRedis();

        console.log(`User connected: ${user.id}`);
        this.setupMessageHandlers(user);

        socket.on("close", () => this.handleDisconnect(user));
        socket.on("error", (err) => 
            console.error(`WS error for ${user.id}:`, err));
    }

    private setupMessageHandlers(user: User) {
        user.socket.on("message", async (data: string) => {
            try {
                const msg = JSON.parse(data);
                
                switch (msg.type) {
                    case INIT_GAME:
                        await this.handleMatchmaking(user);
                        break;
                        
                    case MOVE:
                        await this.handlePlayerMove(user, msg.payload);
                        break;
                        
                    case MESSAGE:
                        await this.handleChatMessage(user, msg.payload);
                        break;
                }
            } catch (err) {
                console.error(`Message handling error for ${user.id}:`, err);
            }
        });
    }

    private async handleMatchmaking(user: User) {
        if (this.pendingUser) {
            const gameId = `game_${Date.now()}`;
            const game = new Game(
                gameId, 
                this.pendingUser,
                user
            );
            
            this.games.set(gameId, game);
            console.log(`Game started: ${gameId}`);
            
            // Clear pending user atomically
            const prevUser = this.pendingUser;
            this.pendingUser = null;
            
            // Link users to game
            await Promise.all([
                prevUser.linkToGame(gameId),
                user.linkToGame(gameId)
            ]);
        } else {
            this.pendingUser = user;
            console.log(`User queued: ${user.id}`);
        }
    }

    private async handlePlayerMove(user: User, movePayload: any) {
        const gameId = await redis.hget(`user:${user.id}`, "currentGame");
        if (!gameId) return;

        const game = this.games.get(gameId);
        if (!game) {
            console.warn(`Missing game ${gameId} for ${user.id}`);
            return;
        }

        try {
            await game.makeMove(user.socket, movePayload);
        } catch (err) {
            console.error(`Move error in ${gameId}:`, err);
            user.socket.send(JSON.stringify({
                type: "ERROR",
                payload: "Invalid move"
            }));
        }
    }

    private async handleChatMessage(sender: User, text: string) {
        const gameId = await redis.hget(`user:${sender.id}`, "currentGame");
        if (!gameId) return;

        const game = this.games.get(gameId);
        game?.sendMessage(text, sender.socket);
    }

    private async handleDisconnect(user: User) {
        console.log(`User disconnected: ${user.id}`);
        
        const gameId = await redis.hget(`user:${user.id}`, "currentGame");
        if (gameId) {
            const game = this.games.get(gameId);
            if (game) {
                await game.endGame();
                this.games.delete(gameId);
            }
        }

        if (this.pendingUser?.id === user.id) {
            this.pendingUser = null;
        }

        await user.deleteFromRedis();
    }
}
