import { Player } from "./Player"
import WebSocket from "ws"

export const sendPlayer = (player: Player, message: any) => {
    if(player && player.socket.readyState === WebSocket.OPEN){
        player.socket.send(JSON.stringify(message))
    }    
}
export const  generateGameId = (): string => {
        return Date.now().toString() + Math.random().toString(36).substring(2, 9)
}

export const randomString = () => {
    const s = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "";
    for (let i = 0; i < 8; i++) {
        id += s.charAt(Math.floor(Math.random() * s.length));
    }
    return id;
};
