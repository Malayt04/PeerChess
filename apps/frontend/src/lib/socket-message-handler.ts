export const socketMessageHandler =   async (event: MessageEvent, socketMessageHooks) => {
    try {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);

        switch (data.type) {
            case 'INIT_GAME':
                colorRef.current = data.payload.color;
                setWaiting(false);
                setStarted(true);
                break;

            case 'MOVE':
                setChess(prev => {
                    const newChess = new Chess(prev.fen());
                    newChess.move(data.payload.move);
                    return newChess;
                });
                break;

            case 'CLOCK_UPDATE':
                handleClock(data.payload);
                break;
            
            case 'MESSAGE':
                handleChat(data.payload);
                break;

            case 'GAME_OVER':
                setStarted(false);
                handleGameOver(data.payload.winner);
                socket?.close();
                break;

            case 'WEBRTC_OFFER':
                console.log('Received offer:', data.payload);
                await handleOffer(data.payload);
                break;

            case 'WEBRTC_ANSWER':
                console.log('Received answer:', data.payload);
                await handleAnswer(data.payload);
                break;

            case 'ICE_CANDIDATE':
                console.log('Received ICE candidate:', data.payload);
                await handleIceCandidate(data.payload);
                break;

            default:
                console.warn('Unhandled message type:', data.type);
                break;
        }
    } catch (err) {
        console.error("Error processing message:", err);
    }
}