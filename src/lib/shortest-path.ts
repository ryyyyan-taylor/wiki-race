// Collapses a click-by-click visit log down to the shortest path actually
// needed to get from the first page to the last: whenever a title reappears,
// the detour between the two occurrences is dropped.
export function collapseToShortestPath(visitedTitles: string[]): string[] {
  const path: string[] = [];
  const indexOf = new Map<string, number>();

  for (const title of visitedTitles) {
    const seenAt = indexOf.get(title);
    if (seenAt !== undefined) {
      path.length = seenAt + 1;
      for (const [visitedTitle, index] of indexOf) {
        if (index > seenAt) indexOf.delete(visitedTitle);
      }
    } else {
      indexOf.set(title, path.length);
      path.push(title);
    }
  }

  return path;
}
