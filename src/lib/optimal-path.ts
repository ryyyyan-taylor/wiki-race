import { getBackwardLinks, getForwardLinks } from "./wiki";

// Finding the *true* shortest path between two Wikipedia articles (what
// sites like Six Degrees of Wikipedia do) requires a precomputed link-graph
// database built from a full dump — not something a live request against
// Wikipedia's API can do for arbitrary pages, since a single hub article can
// have thousands of outgoing/incoming links. This instead runs a *bounded*
// bidirectional search: it expands the smaller of the two frontiers each
// round (meeting-in-the-middle keeps the search shallow for the 3-5 hop
// distances typical between two random articles) and gives up — returning
// null — once it exceeds a node, level, or wall-clock budget, rather than
// risking an unbounded crawl. The result is "a short path found within the
// budget", not a guaranteed global shortest — callers should present it that
// way rather than as a proven optimum.
//
// One title per request, not batched: `prop=links`/`prop=linkshere` apply
// their limit (`pllimit`/`lhlimit`) to the whole response, not per title —
// asking for 50 titles at once silently starves every title after the
// first one or two of their links instead of erroring, so batching titles
// into one call would quietly corrupt the search rather than fail loudly.
const MAX_CONCURRENT_REQUESTS = 8;
const MAX_FRONTIER_PER_LEVEL = 250;
const MAX_LEVELS = 6;
const DEFAULT_DEADLINE_MS = 8000;

export type LinkFetcher = (title: string) => Promise<string[]>;

interface Frontier {
  visited: Map<string, string | null>;
  frontier: string[];
}

// Fetches `fetcher(title)` for each title with up to `concurrency` requests
// in flight, but stops handing out new work once `deadlineAt` passes —
// checked before every individual request, not just between batches, so a
// slow level can't run long past the deadline.
async function fetchNeighborsWithDeadline(
  titles: string[],
  fetcher: LinkFetcher,
  concurrency: number,
  deadlineAt: number
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  let next = 0;
  async function worker() {
    while (next < titles.length) {
      if (Date.now() > deadlineAt) return;
      const title = titles[next++];
      result.set(title, await fetcher(title));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, titles.length) }, worker));
  return result;
}

// `node`'s chain back to the root of `visited` (its own start/target),
// oldest first.
function chainToRoot(node: string, visited: Map<string, string | null>): string[] {
  const chain: string[] = [];
  let current: string | null = node;
  while (current !== null) {
    chain.push(current);
    current = visited.get(current) ?? null;
  }
  return chain;
}

export interface FindShortestPathOptions {
  maxFrontierPerLevel?: number;
  maxLevels?: number;
  concurrency?: number;
  deadlineAt?: number;
}

export async function findShortestPath(
  startTitle: string,
  targetTitle: string,
  fetchers: { forward: LinkFetcher; backward: LinkFetcher },
  options: FindShortestPathOptions = {}
): Promise<string[] | null> {
  if (startTitle === targetTitle) return [startTitle];

  const maxFrontierPerLevel = options.maxFrontierPerLevel ?? MAX_FRONTIER_PER_LEVEL;
  const maxLevels = options.maxLevels ?? MAX_LEVELS;
  const concurrency = options.concurrency ?? MAX_CONCURRENT_REQUESTS;
  const deadlineAt = options.deadlineAt ?? Date.now() + DEFAULT_DEADLINE_MS;

  const forward: Frontier = { visited: new Map([[startTitle, null]]), frontier: [startTitle] };
  const backward: Frontier = { visited: new Map([[targetTitle, null]]), frontier: [targetTitle] };

  for (let level = 0; level < maxLevels; level++) {
    if (forward.frontier.length === 0 || backward.frontier.length === 0) return null;
    if (Date.now() > deadlineAt) return null;

    const expandForward = forward.frontier.length <= backward.frontier.length;
    const side = expandForward ? forward : backward;
    const other = expandForward ? backward : forward;
    const fetcher = expandForward ? fetchers.forward : fetchers.backward;

    const titlesToExpand = side.frontier.slice(0, maxFrontierPerLevel);
    const neighborsByTitle = await fetchNeighborsWithDeadline(titlesToExpand, fetcher, concurrency, deadlineAt);

    const nextFrontier: string[] = [];
    for (const title of titlesToExpand) {
      for (const neighbor of neighborsByTitle.get(title) ?? []) {
        if (side.visited.has(neighbor)) continue;
        side.visited.set(neighbor, title);

        if (other.visited.has(neighbor)) {
          const forwardChain = chainToRoot(neighbor, forward.visited).reverse();
          const backwardChain = chainToRoot(neighbor, backward.visited).slice(1);
          return [...forwardChain, ...backwardChain];
        }
        nextFrontier.push(neighbor);
      }
    }
    side.frontier = nextFrontier;
  }

  return null;
}

export async function computeOptimalPath(startPage: string, targetPage: string): Promise<string[] | null> {
  try {
    return await findShortestPath(startPage, targetPage, {
      forward: getForwardLinks,
      backward: getBackwardLinks,
    });
  } catch {
    return null;
  }
}
