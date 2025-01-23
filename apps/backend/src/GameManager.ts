import { Game } from "./Game";
import { INIT_GAME, MOVE } from "./message";
import WebSocket from "ws";

export class GameManager{
    games: Game[]
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
                    console.log(data.move)
                    game.makeMove(user, data.move);
                }
            }
        })
    }
}