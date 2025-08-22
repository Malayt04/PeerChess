import WebSocket from "ws"


export class Player {
    name: string
    id: string
    socket: WebSocket
    offer?: RTCSessionDescriptionInit
    answer ?: RTCSessionDescriptionInit

    constructor(name: string, id: string, socket: WebSocket) {
        this.name = name
        this.id = id
        this.socket = socket
    }
}