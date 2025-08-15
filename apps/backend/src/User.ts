import WebSocket from "ws";
import { UserRepository } from "./UserRepository";

export class User {
    public readonly id: string;
    public readonly socket: WebSocket | null;
    private _gameId: string | null = null;

    constructor(socket: WebSocket | null, userId?: string) {
        this.id = userId || `usr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        this.socket = socket;
    }

    static async fromRedis(userId: string): Promise<User | null> {
        return await UserRepository.getUser(userId);
    }

    get gameId(): string | null {
        return this._gameId;
    }

    async linkToGame(gameId: string) {
        this._gameId = gameId;
        await UserRepository.saveUser(this);
    }
    
    async clearGame(): Promise<void> {
        this._gameId = null;
        await UserRepository.saveUser(this);
    }

    async saveToRedis(): Promise<void> {
        await UserRepository.saveUser(this);
    }

    async deleteFromRedis(): Promise<void> {
        await UserRepository.deleteUser(this.id);
    }

    // For debugging purposes
    async getRedisState() {
        return UserRepository.getUser(this.id);
    }
}

