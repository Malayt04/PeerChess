import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { User } from './User';
import { Chess } from 'chess.js';
import { redis, redisSub } from './lib/redis';

dotenv.config();


const wss = new WebSocketServer({ port: 8080 });

// Track local connections only
const activeConnections = new Map<string, WebSocket>();

wss.on('connection', (ws) => {
  const user = new User(ws);
  
  // Add to Redis matchmaking pool with 30s TTL
  redis.sadd('matchmaking_pool', user.id).then(() => {
    redis.expire('matchmaking_pool', 30);
  });

  // Handle matchmaking
  redis.spop('matchmaking_pool').then(async (opponentId) => {
    if (opponentId && opponentId !== user.id) {
      const gameId = `game:${user.id}:${opponentId}`;
      const game = new Chess();
      
      // Store game state in Redis with 1h TTL
      await redis.setex(gameId, 3600, game.fen());
      
      // Create Redis Pub/Sub channel
      redisSub.subscribe(gameId);
      
      // Notify both users
      const players = JSON.stringify({ type: 'match', gameId });
      ws.send(players);
      activeConnections.get(opponentId)?.send(players);
    }
  });

  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'move') {
      // Validate move client-side, then publish to Redis
      const game = new Chess(await redis.get(message.gameId));
      try {
        game.move(message.move);
        await redis.setex(message.gameId, 3600, game.fen());
        redis.publish(message.gameId, JSON.stringify(message));
      } catch (e) {
        ws.send(JSON.stringify({ error: 'Invalid move' }));
      }
    }
  });

  // Handle Redis messages
  redisSub.on('message', (channel, message) => {
    if (channel === user.id) {
      ws.send(message);
    }
  });

  ws.on('close', () => {
    activeConnections.delete(user.id);
    redis.srem('matchmaking_pool', user.id);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  redis.disconnect();
  redisSub.disconnect();
  wss.close();
});
