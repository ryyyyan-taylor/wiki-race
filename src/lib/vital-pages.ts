import pool from "./vital-pages.json";
import { VITAL_TOPICS, type VitalTopic } from "./vital-topics";

export { VITAL_TOPICS, type VitalTopic };

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
// A caller-supplied `topic` skips the topic draw and pins it, for a
// category-scoped random pick; otherwise the topic is drawn uniformly as
// before. `rng` is injectable so the distribution itself can be asserted in
// tests without any randomness, matching how optimal-path.ts takes a
// LinkFetcher.
export function pickVitalTitle(rng: () => number = Math.random, topic?: VitalTopic): string {
  const chosenTopic = topic ?? VITAL_TOPICS[Math.floor(rng() * VITAL_TOPICS.length)];
  const titles = titlesByTopic[chosenTopic];
  return titles[Math.floor(rng() * titles.length)];
}
