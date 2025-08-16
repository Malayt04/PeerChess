import WebSocket from "ws"


export class Player {
    name: string
    id: string
    socket: WebSocket

    constructor(name: string, id: string, socket: WebSocket) {
        this.name = name
        this.id = id
        this.socket = socket
    }
}
