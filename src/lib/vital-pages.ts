import pool from "./vital-pages.json";

// Wikipedia's own topic split for its vital-article lists. Listed
// explicitly rather than read off the JSON's keys so the uniform draw below
// is over a fixed set -- a topic vanishing from a regenerated pool should
// break loudly here, not silently reweight every other topic.
export const VITAL_TOPICS = [
  "Arts",
  "Biology and health sciences",
  "Everyday life",
  "Geography",
  "History",
  "Mathematics",
  "People",
  "Philosophy and religion",
  "Physical sciences",
  "Society and social sciences",
  "Technology",
] as const;

export type VitalTopic = (typeof VITAL_TOPICS)[number];

const titlesByTopic: Record<VitalTopic, string[]> = pool;

export function vitalTitles(topic: VitalTopic): string[] {
  return titlesByTopic[topic];
}

// Two steps, and the order is the whole point: a *topic* is drawn uniformly
// first, then a title within it. Drawing uniformly across the pool instead
// would leave People at 14081/48831 -- 29% -- because that's how many vital
// articles are biographies. Topic-first gives each of the 11 topics ~9%,
// which is what makes a math concept or a religion as likely as a person.
//
// `rng` is injectable so the distribution itself can be asserted in tests
// without any randomness, matching how optimal-path.ts takes a LinkFetcher.
export function pickVitalTitle(rng: () => number = Math.random): string {
  const topic = VITAL_TOPICS[Math.floor(rng() * VITAL_TOPICS.length)];
  const titles = titlesByTopic[topic];
  return titles[Math.floor(rng() * titles.length)];
}
