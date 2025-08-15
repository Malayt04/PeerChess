import WebSocket from "ws";
import { Game } from "./Game";
import { User } from "./User";
import { INIT_GAME, MOVE, MESSAGE, INVALID_MOVE } from "./message";
import { GameRepository } from "./GameRepository";
import { UserRepository } from "./UserRepository";
import { move } from "./types";

export class GameManager {
    private static instance: GameManager | null = null;
    private pendingUser: User | null = null;

    private constructor() {}

    public static getInstance(): GameManager {
        if (!GameManager.instance) {
            GameManager.instance = new GameManager();
        }
        return GameManager.instance;
    }

    public async addUser(socket: WebSocket) {
        const user = new User(socket);
        await user.saveToRedis();

        console.log(`User connected: ${user.id}`);
        this.setupMessageHandlers(user);

        socket.on("close", () => this.handleDisconnect(user));
        socket.on("error", (err) => console.error(`WS error for ${user.id}:`, err));
    }

    private setupMessageHandlers(user: User) {
        user.socket?.on("message", async (rawData: string) => {
            let msg;
            try {
                msg = JSON.parse(rawData);
            } catch (e) {
                console.error(`Invalid JSON from ${user.id}:`, rawData);
                return;
            }

            try {
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

                    default:
                        console.warn(`Unknown message type: ${msg.type}`);
                        break;
                }
            } catch (err) {
                console.error(`Handler error for ${user.id}:`, err);
            }
        });
    }

    private async handleMatchmaking(user: User) {
        if (this.pendingUser) {
            const gameId = `game_${Date.now()}`;
            const game = new Game(gameId, this.pendingUser, user, true);
            await GameRepository.saveGame(game);

            console.log(`Game started: ${gameId}`);

            const prevUser = this.pendingUser;
            this.pendingUser = null;

            await Promise.all([
                prevUser.linkToGame(gameId),
                user.linkToGame(gameId)
            ]);
        } else {
            this.pendingUser = user;
            console.log(`User queued: ${user.id}`);
        }
    }

    private async handlePlayerMove(user: User, movePayload: move) {
        const gameId = await UserRepository.getGameId(user.id);
        if (!gameId) return;

        const game = await GameRepository.getGame(gameId);
        if (!game) {
            console.warn(`Missing game ${gameId} for ${user.id}`);
            return;
        }

        try {
            await game.makeMove(user.socket!, movePayload);
        } catch (err) {
            console.error(`Move error in ${gameId} from ${user.id}:`, err, movePayload);
            user.socket?.send(JSON.stringify({
                type: INVALID_MOVE,
                payload: { message: "Invalid move" }
            }));
        }
    }

    private async handleChatMessage(sender: User, text: string) {
        const gameId = await UserRepository.getGameId(sender.id);
        if (!gameId) return;

        const game = await GameRepository.getGame(gameId);
        game?.sendMessage(text, sender.socket!);
    }

    private async handleDisconnect(user: User) {
        console.log(`User disconnected: ${user.id}`);

        const gameId = await UserRepository.getGameId(user.id);
        if (gameId) {
            const game = await GameRepository.getGame(gameId);
            // Let the Game handle its own disconnect timeout
            if (game) {
                game.handlePlayerDisconnect?.(user); 
            }
        }

        if (this.pendingUser?.id === user.id) {
            this.pendingUser = null;
        }

        await user.deleteFromRedis();
    }
}
