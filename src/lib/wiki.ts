import * as cheerio from "cheerio";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_HEADERS = { "User-Agent": "wiki-race (personal project, non-commercial; https://github.com/ryyyyan-taylor/wiki-race)" };

const BLOCKED_NAMESPACES = [
  "Category", "File", "Help", "Special", "Wikipedia", "Template", "Portal",
  "User", "Draft", "Module", "MediaWiki", "TimedText", "Media", "Book",
  "Talk", "User talk", "Wikipedia talk", "Template talk", "File talk",
  "Category talk", "Help talk", "Portal talk", "Module talk", "Draft talk",
  "MediaWiki talk",
];

// Seeded onto every new room — broad hub pages that are more "shortcut"
// than "route" in a wiki race, so they're banned until the host says
// otherwise rather than opted into.
export const DEFAULT_BANNED_PAGES = [
  "United_States",
  "Africa",
  "Antarctica",
  "Asia",
  "Australia",
  "Europe",
  "North_America",
  "South_America",
  "World_War_I",
  "World_War_II",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A race means several players clicking through pages at once — bursty,
// concurrent hits to Wikipedia's API that occasionally trip a momentary
// 429. That's a transient courtesy throttle, not a real failure, so retry
// it a couple of times with backoff before giving up; anything else (a
// missing page, a real outage) fails immediately as before.
async function wikiApi(params: Record<string, string>, revalidateSeconds?: number) {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: WIKI_HEADERS,
      ...(revalidateSeconds ? { next: { revalidate: revalidateSeconds } } : {}),
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      await sleep(300 * 2 ** attempt + Math.random() * 200);
      continue;
    }
    throw new Error(`Wikipedia API request failed: ${res.status}`);
  }
}

// Redirects rarely change, so this is safe to cache — but never pass a
// revalidate window to the `list=random`/disambiguation-check calls below,
// which must stay uncached or "random" would always return the same page.
export async function resolveCanonicalTitle(title: string): Promise<string | null> {
  const data = await wikiApi({ action: "query", titles: title, redirects: "1" }, 21600);
  const page = data.query?.pages?.[0];
  if (!page || page.missing) return null;
  return page.title.replace(/ /g, "_");
}

async function isDisambiguation(title: string): Promise<boolean> {
  const data = await wikiApi({ action: "query", titles: title, prop: "pageprops" });
  const page = data.query?.pages?.[0];
  return page?.pageprops?.disambiguation !== undefined;
}

async function pickRandomArticle(): Promise<string | null> {
  const data = await wikiApi({ action: "query", list: "random", rnnamespace: "0", rnlimit: "1" });
  const title: string | undefined = data.query?.random?.[0]?.title;
  if (!title) return null;
  const canonical = await resolveCanonicalTitle(title);
  if (!canonical) return null;
  return (await isDisambiguation(canonical)) ? null : canonical;
}

export async function pickRandomArticleTitle(): Promise<string> {
  for (let attempts = 0; attempts < 5; attempts++) {
    const title = await pickRandomArticle();
    if (title) return title;
  }
  throw new Error("Could not pick a random article");
}

export async function pickRandomArticlePair(): Promise<{ startPage: string; targetPage: string }> {
  const pages = new Set<string>();
  for (let attempts = 0; attempts < 10 && pages.size < 2; attempts++) {
    const title = await pickRandomArticle();
    if (title) pages.add(title);
  }
  const [startPage, targetPage] = Array.from(pages);
  if (!startPage || !targetPage) throw new Error("Could not pick two random articles");
  return { startPage, targetPage };
}

// Backs the lobby's search-as-you-type inputs (start/target/banned pages).
// Query text varies on every keystroke, so there's nothing worth caching —
// no revalidate window is passed, matching the other live-lookup calls above.
export async function searchArticleTitles(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  const data = await wikiApi({ action: "opensearch", search: query, limit: "8", namespace: "0" });
  const titles: string[] = data[1] ?? [];
  return titles.map((title) => title.replace(/ /g, "_"));
}

export function splitSentences(text: string): string[] {
  // A bare period/exclamation/question-mark split treats "U.S." or "Dwight
  // D. Eisenhower" as multiple sentences, breaking mid-abbreviation --
  // temporarily mask single-capital-letter-plus-period abbreviations (with
  // a character that can't appear in real article text) so they can't be
  // mistaken for a sentence boundary, then restore them afterward.
  const DOT_MASK = "\u0000";
  const protectedText = text.replace(/\b([A-Z])\./g, `$1${DOT_MASK}`);
  const sentences = protectedText.match(/[^.!?]*[.!?]+(?=\s|$)/g);
  const restore = (s: string) => s.split(DOT_MASK).join(".").trim();
  return sentences ? sentences.map(restore).filter(Boolean) : [restore(protectedText)];
}

// One hint call reveals one more sentence than the last — the route counts
// how many are already in `race.hint_text` (via splitSentences) and asks
// for that many + 1.
export async function getIntroSentences(title: string): Promise<string[]> {
  const data = await wikiApi({
    action: "query",
    titles: title,
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
  });
  const extract: string | undefined = data.query?.pages?.[0]?.extract;
  if (!extract) return [];
  return splitSentences(extract);
}

// Backs the "Linked Page" hint — pages that link to the target (Wikipedia's
// "what links here"), one revealed per call. `blnamespace=0` already keeps
// this to article namespace, and excluding redirects keeps a hint from just
// being the target itself under another name. Order comes back alphabetical
// and stable across calls, so no shuffling/caching is needed for a
// consistent one-per-call reveal.
export async function getLinkedPages(title: string): Promise<string[]> {
  const data = await wikiApi({
    action: "query",
    list: "backlinks",
    bltitle: title,
    blnamespace: "0",
    bllimit: "500",
    blfilterredir: "nonredirects",
  });
  const backlinks: { title: string }[] = data.query?.backlinks ?? [];
  return backlinks.map((b) => b.title.replace(/ /g, "_"));
}

function articleTitleFromHref(href: string): string | null {
  if (!href.startsWith("/wiki/")) return null;
  const decoded = decodeURIComponent(href.slice("/wiki/".length));
  if (decoded.includes(":")) {
    const namespace = decoded.split(":")[0].replace(/_/g, " ");
    if (BLOCKED_NAMESPACES.includes(namespace)) return null;
  }
  return decoded;
}

interface Section {
  toclevel: number;
  anchor: string;
  line: string;
  number: string;
}

// Vector's real table of contents is a stateful UI component (pin/collapse
// JS we don't load, since we only pull Wikipedia's stylesheets). This
// builds the same nested-list shape from the plain `sections` data the API
// already returns, keyed to the `id` attributes MediaWiki puts directly on
// each heading — `href="#Anchor"` is then just a normal in-page jump link,
// no extra script needed.
// There's nothing to race for in these — citations and a bibliography, not
// article content — so they're kept out of the TOC and moved into one
// collapsed block at the end of the article instead of being removed
// outright, in case a stuck player wants to dig through sources for a link.
const EXTRA_SECTION_TITLES = ["Notes", "Bibliography", "References", "Further reading", "External links"];

function excludeExtraSections(sections: Section[]): Section[] {
  const result: Section[] = [];
  let skipUntilLevel: number | null = null;
  for (const section of sections) {
    if (skipUntilLevel !== null) {
      if (section.toclevel > skipUntilLevel) continue;
      skipUntilLevel = null;
    }
    if (EXTRA_SECTION_TITLES.includes(section.line)) {
      skipUntilLevel = section.toclevel;
      continue;
    }
    result.push(section);
  }
  return result;
}

function buildTocHtml(sections: Section[]): string {
  if (sections.length === 0) return "";
  let i = 0;
  function buildList(level: number): string {
    let html = "<ul>";
    while (i < sections.length && sections[i].toclevel >= level) {
      const section = sections[i];
      i++;
      // Not a real `href="#…"` — srcdoc iframes inherit their base URL from
      // the parent page, so a plain fragment link resolves against *our*
      // URL rather than scrolling within this document. Intercepted the
      // same way wiki-links are, via this data attribute.
      html += `<li><a href="#" data-wiki-toc-anchor="${section.anchor}"><span class="wiki-race-toc-numb">${section.number}</span> <span>${section.line}</span></a>`;
      if (i < sections.length && sections[i].toclevel > level) html += buildList(level + 1);
      html += "</li>";
    }
    return html + "</ul>";
  }
  return buildList(1);
}

// A section's heading and its content are flat siblings in the parsed
// output, so "this section's content" means "this heading plus everything
// after it up to the next top-level heading" — collect and detach that
// whole run in one pass. Modern MediaWiki output wraps each `<h2 id=…>` in
// its own `.mw-heading2` div (with the edit-section link as its only other
// child, already stripped above) — operate on that wrapper, not the bare
// `<h2>`, or `.next()` finds no sibling and the section extracts as an
// empty heading.
function extractSectionHtml($: ReturnType<typeof cheerio.load>, anchor: string): string {
  const target = $(`#${anchor}`);
  if (target.length === 0) return "";
  const wrapper = target.closest(".mw-heading");
  const heading = wrapper.length > 0 ? wrapper : target;
  const nodes = [heading];
  let sibling = heading.next();
  while (sibling.length > 0 && !sibling.hasClass("mw-heading2")) {
    nodes.push(sibling);
    sibling = sibling.next();
  }
  const html = nodes.map((node) => $.html(node)).join("");
  nodes.forEach((node) => node.remove());
  return html;
}

export interface ParsedArticle {
  title: string;
  html: string;
  tocHtml: string;
  detailsHtml: string;
}

// `title` doesn't need to be pre-resolved — `redirects: "1"` resolves it in
// the same request, so a click no longer costs a separate resolve call
// before the (much heavier) parse call. Returns null for a title that
// doesn't exist, rather than throwing, so callers can tell "not found" from
// a real failure.
export async function fetchArticle(title: string): Promise<ParsedArticle | null> {
  const data = await wikiApi(
    { action: "parse", page: title, redirects: "1", prop: "text|displaytitle|sections" },
    21600
  );
  if (data.error?.code === "missingtitle") return null;
  if (data.error || !data.parse) throw new Error("Wikipedia parse failed");
  const sections: Section[] = data.parse.sections ?? [];
  const tocHtml = buildTocHtml(excludeExtraSections(sections));

  const $ = cheerio.load(data.parse.text);

  $(".mw-editsection, script, style, .navbox, .vertical-navbox, sup.reference").each((_, el) => {
    $(el).remove();
  });

  // Wikipedia's raw markup already carries the `mw-collapsed` class on
  // sections that should start collapsed — MediaWiki's own JS (which we
  // don't load) is only what hides them and wires up the show/hide toggle.
  // Both are replicated purely in CSS/click-handling in RaceView, no server
  // transform needed here.

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const linkedTitle = articleTitleFromHref(href);
    if (linkedTitle) {
      $(el).attr("data-wiki-title", linkedTitle);
      $(el).attr("href", "#");
    } else {
      $(el).removeAttr("href").addClass("wiki-race-disabled-link");
    }
  });

  // Infoboxes and "part of a series on" sidebars are reference material,
  // not running text — pull them out of the main flow so the caller can
  // lay them out as their own column, rather than relying on Wikipedia's
  // own float CSS (which doesn't reliably keep a wide sidebar template
  // beside the text once it's inside our narrower content column).
  const detailsParts: string[] = [];
  $(".infobox, .sidebar").each((_, el) => {
    detailsParts.push($.html(el));
    $(el).remove();
  });

  const extraParts = EXTRA_SECTION_TITLES.map((title) => sections.find((s) => s.line === title))
    .filter((section): section is Section => section !== undefined)
    .map((section) => extractSectionHtml($, section.anchor))
    .filter(Boolean);
  if (extraParts.length > 0) {
    $.root().append(
      `<div class="mw-collapsible mw-collapsed wiki-race-extra"><div class="wiki-race-extra-title">Notes, references &amp; further reading</div><div class="mw-collapsible-content">${extraParts.join("")}</div></div>`
    );
  }

  return {
    title: data.parse.title.replace(/ /g, "_"),
    html: $.root().html() ?? "",
    tocHtml,
    detailsHtml: detailsParts.join(""),
  };
}

export async function getWikipediaStylesheetHrefs(): Promise<string[]> {
  const res = await fetch("https://en.wikipedia.org/wiki/Main_Page", {
    headers: WIKI_HEADERS,
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  return $('head link[rel="stylesheet"]')
    .map((_, el) => $(el).attr("href") ?? "")
    .get()
    .filter(Boolean)
    // Wikipedia's hrefs are root-relative ("/w/load.php?..."), which would
    // resolve against our own origin inside the iframe's srcDoc and 404 —
    // resolve everything against Wikipedia's origin explicitly.
    .map((href) => new URL(href, "https://en.wikipedia.org").toString());
}
