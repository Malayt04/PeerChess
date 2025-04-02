import { Game } from "./Game";
import {GAME_OVER, INIT_GAME, MESSAGE, MOVE} from "./message";
import WebSocket from "ws";

export class GameManager {
    private games: Game[];
    private users: WebSocket[];
    private pendingUser: WebSocket | null;

    constructor() {
        this.games = [];
        this.users = [];
        this.pendingUser = null;
    }

    addUser(user: WebSocket) {
        this.users.push(user);
        console.log("User added");
        this.addHandler(user);

        user.on('close', () => {
            this.removeUser(user);
        });

        user.on('error', (err) => {
            console.error("WebSocket error:", err);
            this.removeUser(user);
        });
    }

    removeUser(user: WebSocket) {
        // Find and cleanup any game this user is part of
        const game = this.findGameForUser(user);
        if (game) {
            // If this is the implementation of the new Game class with endGame method
            if (typeof game.endGame === 'function') {
                game.endGame();
            }
            this.games = this.games.filter(g => g !== game);
        }

        // Clear pending user if needed
        if (this.pendingUser === user) {
            this.pendingUser = null;
        }

        // Remove user from users list
        this.users = this.users.filter(u => u !== user);
        console.log("User removed");
    }

    private findGameForUser(user: WebSocket): Game | undefined {
        return this.games.find(game => 
            game.playerOne === user || game.playerTwo === user
        );
    }

    private addHandler(user: WebSocket) {
        user.on('message', (message: string) => {
            try {
                const data = JSON.parse(message);
                
                // Handle game initialization
                if (data.type === INIT_GAME) {
                    this.handleGameInitialization(user);
                }
                
                // Handle moves
                else if (data.type === MOVE) {
                    this.handleMove(user, data);
                }
                
                // Handle chat messages
                else if (data.type === MESSAGE) {
                    this.handleChatMessage(user, data);
                }

                else if(data.type === GAME_OVER){
                    this.handleGameOver(user)
                }
                
            } catch (error) {
                console.error("Error processing message:", error);
            }
        });
    }

    private handleGameInitialization(user: WebSocket) {
        if (this.pendingUser) {

            try {
                const game = new Game(this.pendingUser, user);
                this.games.push(game);
                this.pendingUser = null;
                console.log("Game created between two users");
            } catch (error) {
                console.error("Error creating game:", error);
                this.pendingUser = null;
            }
        } else {
            this.pendingUser = user;
            console.log("User added to pending queue");
        }
    }

    private handleMove(user: WebSocket, data: any) {
        console.log("Processing move");
        const game = this.findGameForUser(user);
        
        if (game) {
            try {
                console.log("Executing move:", data.payload.move);
                game.makeMove(user, data.payload.move);
            } catch (error) {
                console.error("Error processing move:", error);
            }
        } else {
            console.warn("Move received from user not in a game");
        }
    }

    private handleGameOver(user: WebSocket) {
        const game = this.findGameForUser(user);
    
        if (game) {
            try {
                
                const playerOne = game.playerOne;
                const playerTwo = game.playerTwo;
                
                // End and remove the game
                game.endGame();
                this.games = this.games.filter(g => g !== game);
                
                // Re-initialize players if they're still connected
                if (this.users.includes(playerOne)) {
                    this.handleGameInitialization(playerOne);
                }
                
                if (this.users.includes(playerTwo)) {
                    this.handleGameInitialization(playerTwo);
                }
                
                console.log("Game is over");
            } catch (error) {
                console.log("Error ending game:", error);
            }
        }
    }
    

    private handleChatMessage(user: WebSocket, data: any) {
        const game = this.findGameForUser(user);
        
        if (game) {
            try {
                game.sendMessage(data.payload, user);
            } catch (error) {
                console.error("Error sending chat message:", error);
            }
        } else {
            console.warn("Chat message received from user not in a game");
        }
    }
}