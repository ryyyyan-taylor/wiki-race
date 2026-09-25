import { writeFile } from "node:fs/promises";

// Regenerates src/lib/vital-pages.json, the topic-balanced pool that
// pickVitalTitle draws from. Run with `npm run gen:vital-pages` and commit
// the result; Wikipedia's vital-article lists drift slowly, so this is a
// manual refresh rather than anything the app does at request time (~120
// requests would be absurd per draw).
//
// Levels 4 and 5 only. The level categories are disjoint rather than nested
// -- Talk:Calculus sits in the level-3 category and in no other -- so
// skipping levels 1-3 excludes the ~1000 broad hub pages by construction,
// the same class of page DEFAULT_BANNED_PAGES bans by hand.

const API = "https://en.wikipedia.org/w/api.php";
const HEADERS = { "User-Agent": "wiki-race (personal project, non-commercial; https://github.com/ryyyyan-taylor/wiki-race)" };
const OUT = new URL("../src/lib/vital-pages.json", import.meta.url);

const LEVELS = [4, 5];
const TOPICS = [
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
];

// Wikipedia throttles an unpaced crawl of this size within a few seconds,
// so every request waits its turn and a 429 backs off rather than failing.
const REQUEST_SPACING_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wikiApi(params) {
  const url = new URL(API);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 0; ; attempt++) {
    await sleep(REQUEST_SPACING_MS);
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 5) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Wikipedia API request failed: ${res.status} ${url}`);
  }
}

async function categoryPageCount(category) {
  const data = await wikiApi({ action: "query", titles: category, prop: "categoryinfo" });
  return data.query.pages[0]?.categoryinfo?.pages ?? 0;
}

// Vital-article categories are tagged on the *talk* page, so members come
// back as ns-1 "Talk:Abelian group" and need the prefix stripped before the
// title matches what the rest of the codebase uses.
async function categoryArticles(category) {
  const titles = [];
  let cmcontinue;
  do {
    const data = await wikiApi({
      action: "query",
      list: "categorymembers",
      cmtitle: category,
      cmnamespace: "1",
      cmtype: "page",
      cmlimit: "500",
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const member of data.query.categorymembers) {
      titles.push(member.title.replace(/^Talk:/, "").replace(/ /g, "_"));
    }
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);
  return titles;
}

const pool = {};
let total = 0;

for (const topic of TOPICS) {
  const titles = new Set();
  for (const level of LEVELS) {
    const category = `Category:Wikipedia level-${level} vital articles in ${topic}`;
    const expected = await categoryPageCount(category);
    const found = await categoryArticles(category);
    // A continuation loop that quietly stops early yields a smaller pool
    // that still looks structurally valid, so compare against the count
    // Wikipedia reports for the category rather than trusting the walk.
    if (found.length !== expected) {
      throw new Error(`${category}: collected ${found.length} titles, category reports ${expected}`);
    }
    for (const title of found) titles.add(title);
  }
  pool[topic] = [...titles].sort();
  total += pool[topic].length;
  console.log(`${String(pool[topic].length).padStart(6)}  ${topic}`);
}

await writeFile(OUT, `${JSON.stringify(pool, null, 0)}\n`);
console.log(`\n${total} titles across ${TOPICS.length} topics -> ${OUT.pathname}`);
