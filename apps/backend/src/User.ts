import WebSocket from "ws";
import { redis } from "./lib/redis";

export class User {
    public readonly id: string;
    public readonly socket: WebSocket;
    private _gameId: string | null = null;

    constructor(socket: WebSocket) {
        // Generate ID without 'user:' prefix for flexible key management
        this.id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        this.socket = socket;
    }

    get gameId(): string | null {
        return this._gameId;
    }

    async setGame(gameId: string): Promise<void> {
        this._gameId = gameId;
        await redis.hset(`user:${this.id}`, {
            gameId,
            connected: this.socket.readyState === WebSocket.OPEN
        });
    }

    async linkToGame(gameId: string) {
        await redis.hset(`user:${this.id}`, {
            currentGame: gameId
        });
    }
    
    async clearGame(): Promise<void> {
        await redis.hdel(`user:${this.id}`, 'gameId');
        this._gameId = null;
    }

    async saveToRedis(): Promise<void> {
        await redis.hset(`user:${this.id}`, {
            connected: this.socket.readyState === WebSocket.OPEN,
            gameId: this._gameId || ''
        });
    }

    async deleteFromRedis(): Promise<void> {
        await redis.del(`user:${this.id}`);
    }

    // For debugging purposes
    async getRedisState() {
        return redis.hgetall(`user:${this.id}`);
    }
}
