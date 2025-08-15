import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { GameManager } from './GameManager';

dotenv.config();

const wss = new WebSocketServer({ port: 8080 });
const gameManager = GameManager.getInstance()

wss.on('connection', (ws) => {
  gameManager.addUser(ws);
});

console.log('WebSocket server started on port 8080');