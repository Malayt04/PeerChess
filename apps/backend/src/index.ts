import { WebSocketServer } from "ws";
import { GameManager } from "./GameManager";
import { Player } from "./Player";
import { randomString } from "./utils";

import * as mediasoup from "mediasoup";
import {Worker} from "mediasoup/node/lib/types"

let mediasoupWorker: Worker;


async function startMediasoup() {
  mediasoupWorker = await mediasoup.createWorker({
    logLevel: "warn",
  });
  console.log("Mediasoup worker started");
}

startMediasoup()


const wss = new WebSocketServer({ port: 8080 });
const gameManager = GameManager.getInstance();

wss.on("connection", (ws) => {
    const username = randomString();
    const id = randomString();
    const player = new Player(username, id, ws);

    console.log(`User Connected: ${username} (${id})`);
    
    gameManager.handleMessage(player, mediasoupWorker);
});

console.log("Server started on port 8080");
