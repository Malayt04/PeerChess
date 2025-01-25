/* eslint-disable @typescript-eslint/no-explicit-any */
import { Chess, Square, PieceSymbol, Color } from "chess.js";
import { useState } from "react";

export const Chessboard = ({ chess, board, socket, setBoard }: {
  chess: Chess;
  setBoard: React.Dispatch<React.SetStateAction<({
      square: Square;
      type: PieceSymbol;
      color: Color;
  } | null)[][]>>;
  board: ({
      square: Square;
      type: PieceSymbol;
      color: Color;
  } | null)[][];
  socket: WebSocket;
}) => {

  const [from, setFrom] = useState<Square | null>(null);

  const getSquareClass = (i: number, j: number): string => {
    return (i + j) % 2 !== 0 ? "bg-zinc-800" : "bg-zinc-700";
  };

  return (
    <div className="text-white">
      {board.map((row, i) => (
        <div key={i} className="flex">
          {row.map((square, j) => {
            const squareRepresentation = String.fromCharCode(97 + (j % 8)) + "" + (8 - i) as Square;

            return (
              <div
                onClick={() => {
                  if (!from) {
                      setFrom(squareRepresentation);
                  } else {
                      socket.send(JSON.stringify({
                          type: 'MOVE',
                              move: {
                                  from,
                                  to: squareRepresentation
                              }
                      }))
                      
                      setFrom(null)
                      chess.move({
                          from,
                          to: squareRepresentation
                      });
                      console.log(chess.board())
                      setBoard(chess.board());
                  }
              }}
                key={`${j}}`}
                className={`w-12 h-12 border ${getSquareClass(
                  i,
                  j
                )} flex items-center justify-center`}
              >
                {square ? `${square.type} ${square.color}` : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
