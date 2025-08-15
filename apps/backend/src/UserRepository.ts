import { redis } from "./lib/redis";
import { User } from "./User";
import WebSocket from "ws";

export class UserRepository {
    static async getUser(userId: string): Promise<User | null> {
        const userData = await redis.hgetall(`user:${userId}`);
        if (!userData) {
            return null;
        }

        // Note: The WebSocket connection is not stored in Redis, so it will be null
        // when retrieving a user from the repository.
        const user = new User(null, userId);
        return user;
    }

    static async saveUser(user: User): Promise<void> {
        await redis.hset(`user:${user.id}`, {
            connected: user.socket ? user.socket.readyState === WebSocket.OPEN : 'false',
            gameId: user.gameId || ''
        });
    }

    static async updateUser(user: User): Promise<void> {
        await this.saveUser(user);
    }

    static async deleteUser(userId: string): Promise<void> {
        await redis.del(`user:${userId}`);
    }

    static async getGameId(userId: string): Promise<string | null> {
        const gameId = await redis.hget(`user:${userId}`, 'gameId');
        return gameId as string;
    }
}
