import { describe, expect, it } from "vitest";
import { collapseToShortestPath } from "./shortest-path";

describe("collapseToShortestPath", () => {
  it("returns the path unchanged when there are no loops", () => {
    expect(collapseToShortestPath(["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("drops a simple loop back to an earlier page", () => {
    // A -> B -> C -> B -> D: the C detour is wasted, shortest is A,B,D.
    expect(collapseToShortestPath(["A", "B", "C", "B", "D"])).toEqual([
      "A",
      "B",
      "D",
    ]);
  });

  it("keeps a later, independently-reached visit to an earlier title", () => {
    // A -> B -> C -> B (loop, drop C) -> D -> C (new route) -> E
    expect(
      collapseToShortestPath(["A", "B", "C", "B", "D", "C", "E"])
    ).toEqual(["A", "B", "D", "C", "E"]);
  });

  it("collapses a loop back to the very first page", () => {
    expect(collapseToShortestPath(["A", "B", "C", "A", "D"])).toEqual([
      "A",
      "D",
    ]);
  });

  it("handles a single-page path", () => {
    expect(collapseToShortestPath(["A"])).toEqual(["A"]);
  });
});
