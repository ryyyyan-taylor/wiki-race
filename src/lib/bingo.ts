// Distinct, colorblind-reasonable hex colors assigned to players in a
// bingo-family race, indexed by player join order. Repeats past 10 players
// (an accepted edge case, not worth a bigger palette for this player count).
export const BINGO_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
  "#469990",
  "#9a6324",
];

export type BingoGameMode = "bingo" | "double_bingo" | "lockout";

// Every row, every column, and both diagonals — the only lines a square
// board has, regardless of size.
export function boardLines(boardSize: number): number[][] {
  const lines: number[][] = [];
  for (let row = 0; row < boardSize; row++) {
    lines.push(Array.from({ length: boardSize }, (_, col) => row * boardSize + col));
  }
  for (let col = 0; col < boardSize; col++) {
    lines.push(Array.from({ length: boardSize }, (_, row) => row * boardSize + col));
  }
  lines.push(Array.from({ length: boardSize }, (_, i) => i * boardSize + i));
  lines.push(Array.from({ length: boardSize }, (_, i) => i * boardSize + (boardSize - 1 - i)));
  return lines;
}

export function countCompletedLines(claimed: Set<number>, boardSize: number): number {
  return boardLines(boardSize).filter((line) => line.every((index) => claimed.has(index))).length;
}

// A strict majority of the board — the first count that can't be tied or
// beaten by everyone else's squares combined. 3x3 -> 5, 4x4 -> 9, 5x5 -> 13.
export function majorityThreshold(boardSize: number): number {
  return Math.floor((boardSize * boardSize) / 2) + 1;
}

export function hasWon(gameMode: BingoGameMode, claimed: Set<number>, boardSize: number): boolean {
  if (gameMode === "lockout") return claimed.size >= majorityThreshold(boardSize);
  const lines = countCompletedLines(claimed, boardSize);
  return gameMode === "double_bingo" ? lines >= 2 : lines >= 1;
}

// Lockout's tie-break for a fully-claimed board with no majority: whoever
// holds the most squares, and among ties, whoever reached that count first.
// `claimsInOrder` is every claim's player id in chronological order — a
// single pass works because a later player merely *tying* the leader's
// count doesn't unseat them (only strictly exceeding it does), which is
// exactly "first to reach N squares" without any extra bookkeeping.
export function leadingClaimant(claimsInOrder: string[]): string {
  const counts = new Map<string, number>();
  let bestPlayer = claimsInOrder[0];
  let bestCount = 0;
  for (const playerId of claimsInOrder) {
    const next = (counts.get(playerId) ?? 0) + 1;
    counts.set(playerId, next);
    if (next > bestCount) {
      bestCount = next;
      bestPlayer = playerId;
    }
  }
  return bestPlayer;
}
