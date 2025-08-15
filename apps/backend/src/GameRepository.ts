import { redis } from "./lib/redis";
import { Game } from "./Game";
import { User } from "./User";
import { UserRepository } from "./UserRepository";

export class GameRepository {
  static async getGame(gameId: string): Promise<Game | null> {
    const gameData = await redis.hgetall(`game:${gameId}`);
    if (!gameData || !gameData.playerOneId || !gameData.playerTwoId) {
      return null;
    }

    const playerOne = await UserRepository.getUser(
      gameData.playerOneId as string
    );
    const playerTwo = await UserRepository.getUser(
      gameData.playerTwoId as string
    );

    if (!playerOne || !playerTwo) {
      return null;
    }

    const game = new Game(gameId, playerOne, playerTwo, false); 
    game.board.load(gameData.board as string);
    game.moveCount = parseInt(gameData.moveCount as string);
    game.isGameActive = gameData.isGameActive === "true";

    return game;
  }

  static async saveGame(game: Game): Promise<void> {
    console.log(
      `Saving game ${game.gameId}` +
        `, playerOne: ${game.playerOne.id}, playerTwo: ${game.playerTwo.id}` +
        `, board: ${game.board.fen()}, moveCount: ${game.moveCount}, isGameActive: ${game.isGameActive}` +
        `, playerOneClock: ${game.playerOneClock}, playerTwoClock: ${game.playerTwoClock}` +
        `, playerOneOffer: ${game.playerOneOffer}, playerTwoOffer: ${game.playerTwoOffer}`
    );
    await redis.hset(`game:${game.gameId}`, {
      playerOneId: game.playerOne.id,
      playerTwoId: game.playerTwo.id,
      board: game.board.fen(),
      moveCount: game.moveCount,
      isGameActive: game.isGameActive,
    });
  }

  static async updateGame(game: Game): Promise<void> {
    await this.saveGame(game);
  }

  static async deleteGame(gameId: string): Promise<void> {
    await redis.del(`game:${gameId}`);
  }
}
