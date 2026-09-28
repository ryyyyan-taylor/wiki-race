import { describe, expect, it } from "vitest";
import { boardLines, countCompletedLines, hasWon, leadingClaimant, majorityThreshold } from "./bingo";

describe("boardLines", () => {
  it("has 2n+2 lines for an n x n board", () => {
    expect(boardLines(3)).toHaveLength(8);
    expect(boardLines(4)).toHaveLength(10);
    expect(boardLines(5)).toHaveLength(12);
  });

  it("matches the expected rows/cols/diagonals for 3x3", () => {
    expect(boardLines(3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ]);
  });
});

describe("countCompletedLines", () => {
  it("counts zero when nothing is claimed", () => {
    expect(countCompletedLines(new Set(), 3)).toBe(0);
  });

  it("counts a completed row", () => {
    expect(countCompletedLines(new Set([0, 1, 2]), 3)).toBe(1);
  });

  it("counts a row and a diagonal that share a square", () => {
    expect(countCompletedLines(new Set([0, 1, 2, 4, 8]), 3)).toBe(2);
  });
});

describe("majorityThreshold", () => {
  it("matches the worked examples", () => {
    expect(majorityThreshold(3)).toBe(5);
    expect(majorityThreshold(4)).toBe(9);
    expect(majorityThreshold(5)).toBe(13);
  });
});

describe("hasWon", () => {
  it("bingo wins on a single completed line", () => {
    expect(hasWon("bingo", new Set([0, 1, 2]), 3)).toBe(true);
    expect(hasWon("bingo", new Set([0, 1]), 3)).toBe(false);
  });

  it("double_bingo requires two completed lines", () => {
    expect(hasWon("double_bingo", new Set([0, 1, 2]), 3)).toBe(false);
    expect(hasWon("double_bingo", new Set([0, 1, 2, 4, 8]), 3)).toBe(true);
  });

  it("lockout wins on a strict majority regardless of lines", () => {
    expect(hasWon("lockout", new Set([0, 1, 2, 3]), 4)).toBe(false);
    expect(hasWon("lockout", new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]), 4)).toBe(true);
  });
});

describe("leadingClaimant", () => {
  it("picks whoever has the most claims", () => {
    expect(leadingClaimant(["a", "b", "a", "a", "b"])).toBe("a");
  });

  it("breaks ties by whoever reached that count first", () => {
    // a reaches 2 first (index 2); b only ties it at index 3 and never
    // exceeds it, so a stays the leader.
    expect(leadingClaimant(["a", "b", "a", "b"])).toBe("a");
  });

  it("hands the lead to whoever strictly overtakes", () => {
    expect(leadingClaimant(["a", "b", "b", "a", "b"])).toBe("b");
  });
});
