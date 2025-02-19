import { Game } from "./Game";
import { ICE_CANDIDATE, INIT_GAME, MESSAGE, MOVE, WEBRTC_ANSWER, WEBRTC_OFFER } from "./message";
import WebSocket from "ws";

export class GameManager{
    games:Game[]
    users: WebSocket[]
    pendingUser: WebSocket | null

    constructor(){
        this.games = []
        this.users = []
        this.pendingUser = null
    }

    addUser(user: WebSocket){
        this.users.push(user)
        console.log("User added")
        this.addHandler(user)
    }

    removeUser(user: WebSocket){
        this.users = this.users.filter(u => u !== user)
        console.log("User removed")
    }

    handleWebRTCMessage(sender: WebSocket, message: any) {
        const game = this.games.find(game => 
            game.playerOne === sender || game.playerTwo === sender
        );

        if (!game) return;

        const receiver = game.playerOne === sender ? game.playerTwo : game.playerOne;
        
        receiver.send(JSON.stringify({
            type: message.type,
            payload: message.payload
        }));
    }

    addHandler(user: WebSocket){
        user.on('message', (message: string) => {

            const data = JSON.parse(message)

            if (data.type === INIT_GAME) {
                if (this.pendingUser) {
                    const game = new Game(this.pendingUser, user);
                    this.games.push(game);
                    this.pendingUser = null;
                } else {
                    this.pendingUser = user;
                }
            }

            if (data.type === MOVE) {
                console.log("inside move")
                const game = this.games.find(game => game.playerOne === user || game.playerTwo === user);
                if (game) {
                    console.log("inside if")
                    console.log(data.payload.move)
                    game.makeMove(user, data.payload.move);
                }
            }

            if ([WEBRTC_OFFER, WEBRTC_ANSWER, ICE_CANDIDATE].includes(data.type)) {
                this.handleWebRTCMessage(user, data);
            }

            if(data.type === MESSAGE){
                const game = this.games.find(game => game.playerOne === user || game.playerTwo === user);
                
                if(game){
                game.sendMessage(data.payload, user);
                }
            }
        })
    }
}