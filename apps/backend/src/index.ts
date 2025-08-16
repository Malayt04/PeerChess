import { WebSocketServer } from "ws";
import { GameManager } from "./GameManager";
import { Player } from "./Player";
import { randomString } from "./utils";
import { startMediasoup } from "./MediaSoup";

const wss = new WebSocketServer({ port: 8080 });
const gameManager = GameManager.getInstance();

startMediasoup();

wss.on("connection", (ws) => {
    const username = randomString();
    const id = randomString();
    const player = new Player(username, id, ws);

    console.log(`User Connected: ${username} (${id})`);
    
    gameManager.addUser(player);
});

console.log("Server started on port 8080");
