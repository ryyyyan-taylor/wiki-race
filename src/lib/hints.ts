import type { RaceRow } from "@/lib/types";
import { getIntroSentences, getLinkedPages } from "@/lib/wiki";

export async function nextSentenceHint(page: string, previousText: string | null) {
  const sentences = await getIntroSentences(page);
  if (sentences.length === 0) return null;

  // Each call reveals one more sentence than the last hint already shown,
  // up to however many the intro actually has. Finding "how many" by
  // re-splitting the stored hint text is fragile — even a well-tuned
  // sentence splitter can disagree with itself once a fragment sits at a
  // different position in a shorter string, silently maxing out the count
  // and permanently disabling the hint button. Matching the stored text as
  // an exact prefix of the freshly split sentences sidesteps that entirely.
  let alreadyRevealed = 0;
  if (previousText) {
    for (let i = 1; i <= sentences.length; i++) {
      if (sentences.slice(0, i).join(" ") === previousText) {
        alreadyRevealed = i;
        break;
      }
    }
  }
  const nextCount = Math.min(alreadyRevealed + 1, sentences.length);
  return { hint: sentences.slice(0, nextCount).join(" "), hasMore: nextCount < sentences.length };
}

export async function nextLinkedPages(page: string, alreadyRevealed: string[], excluded: Set<string>) {
  const candidates = (await getLinkedPages(page)).filter((title) => title !== page && !excluded.has(title));
  if (candidates.length === 0) return null;

  const nextCount = Math.min(alreadyRevealed.length + 1, candidates.length);
  return { pages: candidates.slice(0, nextCount), hasMore: nextCount < candidates.length };
}

// Classic races hint at the single target; bingo races hint at whichever
// board square the host picked. Null means the request doesn't name a
// valid hint target for this race.
export function resolveHintPage(race: RaceRow, squareIndex: unknown) {
  if (race.game_mode === "race") return race.target_page;
  if (typeof squareIndex !== "number" || !Number.isInteger(squareIndex)) return null;
  return race.board_pages?.[squareIndex] ?? null;
}
