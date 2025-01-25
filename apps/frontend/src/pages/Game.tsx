//import {Chessboard} from '@/components/Chessboard'
import { Button } from '@/components/ui/button'
import { useSocket } from '@/hooks/useSocket'
import { Chess } from 'chess.js'
import { Chessboard } from "react-chessboard";
import  { useEffect, useState } from 'react'



function Game() {

    const socket = useSocket()
    const [chess, setChess] = useState(new Chess())
    const [started, setStarted] = useState(false)

    useEffect(() => {
        if (!socket) {
            return
        }
        socket.addEventListener('message', (event: MessageEvent) => {
            const message = event.data;
            const data = JSON.parse(message)

            console.log(data)

            switch (data.type) {
                case 'INIT_GAME':
                    console.log("Game started")
                    setChess(chess)
                    setStarted(true)
                    break

                case 'MOVE':
                    chess.move(data.move)
                    setChess(chess)
                    break
                    
                default:
                    break
            }
        })
            socket.removeEventListener('message', () => {})
        
    }, [socket])

    const makeMove = (move: { from: string; to: string }) => {
        socket?.send(JSON.stringify({ type: 'MOVE', payload: move}))
        chess.move(move)
        setChess(chess)
    }

    function onDrop(sourceSquare : string, targetSquare: string) {
        const move = makeMove({
          from: sourceSquare,
          to: targetSquare,
        });
        if (move === null) return false;
        return true;
    }

    const handlePlay = () => {
        socket?.send(JSON.stringify({ type: 'INIT_GAME' }))
    }

  return (
    <div className="flex justify-between items-start gap-8 py-4">
            <div className="flex-1" />
            {socket && <Chessboard 
                position={chess.fen()}
                onPieceDrop={onDrop}
                autoPromoteToQueen={true}
           />}
            <div className="space-y-3">
                <Button
                    className="w-full h-12 text-lg bg-green-600 hover:bg-green-500"
                    onClick={handlePlay}
                >
                    {socket ? "Play Online" : "Connecting..."}
                </Button>
            </div>
        </div>
  )
}

export default Game
