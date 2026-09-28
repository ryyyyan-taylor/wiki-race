// Wikipedia's own topic split for its vital-article lists. Split out from
// vital-pages.ts so client components (e.g. a topic picker in the lobby UI)
// can import just this fixed list without pulling in the ~800KB article pool.
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
