import { describe, expect, it } from "vitest";
import { VITAL_TOPICS, pickVitalTitle, vitalTitles } from "./vital-pages";

// rng() is called twice per draw -- once for the topic, once for the title.
// This walks the topic call evenly across [0, 1) over `draws` draws and pins
// every title call to 0, so the topic histogram is exact rather than
// statistical and can't flake.
function evenTopicRng(draws: number): () => number {
  let call = 0;
  return () => {
    const isTopicCall = call % 2 === 0;
    const index = Math.floor(call / 2);
    call++;
    return isTopicCall ? index / draws : 0;
  };
}

describe("the pool", () => {
  it("has every topic populated", () => {
    for (const topic of VITAL_TOPICS) {
      expect(vitalTitles(topic).length, topic).toBeGreaterThanOrEqual(500);
    }
  });

  it("holds each title under exactly one topic", () => {
    const all = VITAL_TOPICS.flatMap(vitalTitles);
    expect(all.length - new Set(all).size).toBe(0);
  });

  it("stores canonical underscored titles, with the talk prefix stripped", () => {
    const bad = VITAL_TOPICS.flatMap(vitalTitles).filter((t) => t.startsWith("Talk:") || t.includes(" "));
    expect(bad).toEqual([]);
  });
});

describe("pickVitalTitle", () => {
  it("draws topics uniformly rather than weighting them by size", () => {
    const perTopic = 40;
    const draws = VITAL_TOPICS.length * perTopic;
    const topicOf = new Map(VITAL_TOPICS.flatMap((topic) => vitalTitles(topic).map((title) => [title, topic])));

    const rng = evenTopicRng(draws);
    const counts = new Map<string, number>();
    for (let i = 0; i < draws; i++) {
      const topic = topicOf.get(pickVitalTitle(rng))!;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }

    // A pool-uniform draw would put People -- 14081 of 48831 titles -- at
    // roughly 29% of this histogram instead of an even 1/11.
    expect([...counts.values()]).toEqual(VITAL_TOPICS.map(() => perTopic));
    expect(new Set(counts.keys())).toEqual(new Set(VITAL_TOPICS));
  });

  it("stays in range at both ends of the rng", () => {
    const first = VITAL_TOPICS[0];
    expect(pickVitalTitle(() => 0)).toBe(vitalTitles(first)[0]);

    const last = VITAL_TOPICS[VITAL_TOPICS.length - 1];
    const lastTitles = vitalTitles(last);
    expect(pickVitalTitle(() => 1 - Number.EPSILON)).toBe(lastTitles[lastTitles.length - 1]);
  });
});
