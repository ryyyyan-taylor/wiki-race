import { describe, expect, it } from "vitest";
import { findShortestPath, type LinkFetcher } from "./optimal-path";

// A tiny directed graph to exercise the search without hitting Wikipedia.
// A -> B -> D -> F (target)
// A -> C -> D
// A -> E (dead end, doesn't reach F)
const FORWARD: Record<string, string[]> = {
  A: ["B", "C", "E"],
  B: ["D"],
  C: ["D"],
  D: ["F"],
  E: [],
  F: [],
};

function invert(forward: Record<string, string[]>): Record<string, string[]> {
  const backward: Record<string, string[]> = {};
  for (const [from, tos] of Object.entries(forward)) {
    for (const to of tos) {
      (backward[to] ??= []).push(from);
    }
  }
  return backward;
}

const BACKWARD = invert(FORWARD);

function fetcherFor(graph: Record<string, string[]>): LinkFetcher {
  return async (title) => graph[title] ?? [];
}

const fetchers = { forward: fetcherFor(FORWARD), backward: fetcherFor(BACKWARD) };

describe("findShortestPath", () => {
  it("returns a single-page path when start equals target", async () => {
    expect(await findShortestPath("A", "A", fetchers)).toEqual(["A"]);
  });

  it("finds a direct edge", async () => {
    expect(await findShortestPath("A", "B", fetchers)).toEqual(["A", "B"]);
  });

  it("finds the shortest multi-hop path, preferring neither branch arbitrarily", async () => {
    const path = await findShortestPath("A", "F", fetchers);
    expect(path).not.toBeNull();
    expect(path![0]).toBe("A");
    expect(path![path!.length - 1]).toBe("F");
    expect(path!.length).toBe(4); // A -> (B|C) -> D -> F
  });

  it("returns null when no path exists", async () => {
    expect(await findShortestPath("E", "F", fetchers)).toBeNull();
  });

  it("gives up once the level budget is exhausted", async () => {
    const path = await findShortestPath("A", "F", fetchers, { maxLevels: 0 });
    expect(path).toBeNull();
  });

  it("gives up once the deadline has passed", async () => {
    const path = await findShortestPath("A", "F", fetchers, { deadlineAt: Date.now() - 1 });
    expect(path).toBeNull();
  });
});
