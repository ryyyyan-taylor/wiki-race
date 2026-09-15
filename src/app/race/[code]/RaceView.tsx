"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getIdentity } from "@/lib/identity";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { subscribePlayersTable, subscribeRace, upsertPlayer } from "@/lib/realtime/tables";
import { useHostFailover } from "@/lib/realtime/presence";
import { getServerThemeSnapshot, getThemeSnapshot, subscribeTheme } from "@/lib/theme";
import { displayTitle } from "@/lib/format";
import type { Player, RaceRow, RacePlayerRow } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Props {
  roomCode: string;
  stylesheetHrefs: string[];
}

interface OpponentProgress {
  status: string;
  pagesVisitedCount: number;
}

// Layered on top of Wikipedia's own stylesheet (loaded via the <link> tags
// above it) rather than a full reskin — same approach as common Wikipedia
// dark-mode userscripts.
const DARK_OVERRIDE_CSS = `
  html, body { background: #14181c !important; color: #d6d6d6 !important; }
  h1, h2, h3, h4, h5, h6 { color: #e8e8e8 !important; border-color: #3a3f47 !important; }
  a { color: #8ab4f8 !important; }
  a.new { color: #e0918f !important; }
  table, .infobox, .navbox, .vertical-navbox, .sidebar { background: #1f242b !important; color: #d6d6d6 !important; border-color: #3a3f47 !important; }
  .infobox th, .infobox td, table th, table td, th { background: #262c33 !important; color: #d6d6d6 !important; border-color: #3a3f47 !important; }
  img { filter: brightness(0.9) contrast(1.05); }
`;

// Vector's real TOC and collapsible sidebars are driven by JS we don't load
// (we only pull Wikipedia's stylesheets) — this replicates just the parts
// that matter: a plain sticky TOC on the left, infoboxes/sidebars pulled
// into their own column on the right instead of depending on Wikipedia's
// own float CSS (unreliable once those elements are inside our narrower
// content column), and a default-collapsed state with click-to-expand for
// `mw-collapsible` sections.
const MIN_SIDE_WIDTH = 150;
const MAX_SIDE_WIDTH = 600;
const DEFAULT_TOC_WIDTH = 220;
const DEFAULT_DETAILS_WIDTH = 300;

const LAYOUT_CSS = `
  .wiki-race-layout { display: flex; align-items: flex-start; }
  .wiki-race-toc { position: sticky; top: 16px; border: 1px solid #a2a9b1; padding: 10px 14px; font-size: 0.875em; max-height: calc(100vh - 32px); overflow-y: auto; min-width: 0; }
  .wiki-race-toc-heading { font-weight: bold; font-size: 1.1em; margin-bottom: 4px; }
  .wiki-race-toc ul { list-style: none; margin: 0; padding-left: 1.2em; }
  .wiki-race-toc > ul { padding-left: 0; }
  .wiki-race-toc li { margin: 3px 0; }
  .wiki-race-toc a { text-decoration: none; }
  .wiki-race-toc-numb { color: #666; margin-right: 0.3em; }
  .wiki-race-content { flex: 1 1 auto; min-width: 0; display: block !important; }
  .wiki-race-details { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden; min-width: 0; }
  .wiki-race-details .infobox, .wiki-race-details .sidebar { float: none !important; width: 100% !important; margin: 0 0 16px 0 !important; }
  /* Wikipedia's "nowraplinks" navbox styling keeps link text on one line,
     which is fine at full article width but forces horizontal scrolling
     once that content is squeezed into this narrower column — override it
     so the box only ever grows by dragging, never by overflow. */
  .wiki-race-details a { white-space: normal !important; }
  .wiki-race-details, .wiki-race-details * { overflow-wrap: break-word; }
  .mw-collapsible.mw-collapsed > .mw-collapsible-content { display: none; }
  .mw-collapsible.mw-collapsed > .sidebar-list-title, .mw-collapsible.mw-collapsed > .wiki-race-extra-title { cursor: pointer; }
  .mw-collapsible.mw-collapsed > .sidebar-list-title::after, .mw-collapsible.mw-collapsed > .wiki-race-extra-title::after { content: " [show]"; color: #0645ad; font-weight: normal; }
  .mw-collapsible.wiki-race-expanded > .sidebar-list-title::after, .mw-collapsible.wiki-race-expanded > .wiki-race-extra-title::after { content: " [hide]"; }
  .mw-collapsible.wiki-race-expanded > .mw-collapsible-content { display: block; }
  .wiki-race-extra { margin-top: 32px; border-top: 1px solid #a2a9b1; padding-top: 10px; }
  .wiki-race-extra-title { font-weight: bold; font-size: 1.2em; }
  .wiki-race-resize-handle { flex: 0 0 16px; align-self: stretch; cursor: col-resize; position: relative; }
  .wiki-race-resize-handle::after { content: ""; position: absolute; top: 0; bottom: 0; left: 7px; width: 2px; background: #a2a9b1; }
  .wiki-race-resize-handle:hover::after, .wiki-race-resize-handle.wiki-race-active::after { background: #0645ad; width: 3px; left: 6.5px; }
  body.wiki-race-noselect { user-select: none; }
`;

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSrcDoc(
  stylesheetHrefs: string[],
  pageTitle: string,
  html: string,
  tocHtml: string,
  detailsHtml: string,
  isDark: boolean,
  tocWidth: number,
  detailsWidth: number
) {
  const links = stylesheetHrefs
    .map((href) => `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}">`)
    .join("");
  const darkStyle = isDark
    ? `<style>${DARK_OVERRIDE_CSS}\n.wiki-race-toc { background: #1f242b !important; border-color: #3a3f47 !important; }\n.wiki-race-toc-numb { color: #9aa0a6 !important; }\n.mw-collapsible.mw-collapsed > .sidebar-list-title::after, .mw-collapsible.mw-collapsed > .wiki-race-extra-title::after { color: #8ab4f8 !important; }\n.wiki-race-extra { border-color: #3a3f47 !important; }\n.wiki-race-resize-handle::after { background: #3a3f47; }</style>`
    : "";
  const widthStyle = `<style>.wiki-race-toc { flex: 0 0 ${tocWidth}px; } .wiki-race-details { flex: 0 0 ${detailsWidth}px; }</style>`;
  const toc = tocHtml
    ? `<nav class="wiki-race-toc" id="wiki-race-toc"><div class="wiki-race-toc-heading">Contents</div>${tocHtml}</nav><div class="wiki-race-resize-handle" data-resize="toc"></div>`
    : "";
  const details = detailsHtml
    ? `<div class="wiki-race-resize-handle" data-resize="details"></div><aside class="wiki-race-details" id="wiki-race-details">${detailsHtml}</aside>`
    : "";
  // Real Wikipedia's own classes — the loaded stylesheet formats this large
  // serif heading with its bottom border for free, same as the infobox/TOC.
  const heading = pageTitle
    ? `<h1 id="firstHeading" class="firstHeading mw-first-heading"><span class="mw-page-title-main">${escapeHtml(pageTitle)}</span></h1>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">${links}<style>body{margin:0;padding:16px;}${LAYOUT_CSS}</style>${widthStyle}${darkStyle}</head><body>${heading}<div class="wiki-race-layout">${toc}<div id="content" class="mw-body wiki-race-content"><div id="bodyContent" class="mw-body-content"><div id="mw-content-text" class="mw-parser-output">${html}</div></div></div>${details}</div></body></html>`;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RaceView({ roomCode, stylesheetHrefs }: Props) {
  const router = useRouter();
  const isDark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [identity] = useState(() => getIdentity(roomCode));
  const [html, setHtml] = useState("");
  const [tocHtml, setTocHtml] = useState("");
  const [detailsHtml, setDetailsHtml] = useState("");
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [pagesVisited, setPagesVisited] = useState(0);
  // Column widths are a plain mutable object, not `useState` — a drag needs
  // to repaint at full frame rate via direct style writes on the current
  // iframe, not by rebuilding and reloading a brand new `srcDoc` on every
  // mousemove. This just carries the last dragged width forward into the
  // *next* srcDoc build (the next page navigation), so a resize persists
  // without ever itself triggering one. (A `useRef` would do the same job,
  // but reading `.current` during render trips the refs-in-render lint
  // rule; a plain object read the same way doesn't.)
  const [columnWidths] = useState(() => ({ toc: DEFAULT_TOC_WIDTH, details: DEFAULT_DETAILS_WIDTH }));
  const [targetPage, setTargetPage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [raceId, setRaceId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [opponentProgress, setOpponentProgress] = useState<Record<string, OpponentProgress>>({});
  const [hintText, setHintText] = useState<string | null>(null);
  // Optimistic assumption until the server says otherwise (it knows how
  // many sentences the intro actually has) — worst case, one extra click
  // after the last one available just confirms there's nothing more.
  const [hintHasMore, setHintHasMore] = useState(true);
  const [linkedPageHints, setLinkedPageHints] = useState<string[]>([]);
  // Same optimistic assumption as hintHasMore, until the server reports the
  // actual number of pages that link to the target.
  const [linkedPageHasMore, setLinkedPageHasMore] = useState(true);
  const [hintMenuOpen, setHintMenuOpen] = useState(false);
  const hintMenuRef = useRef<HTMLDivElement>(null);
  const [hasForfeited, setHasForfeited] = useState(false);
  const [busy, setBusy] = useState(false);

  const playerNames = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.name])), [players]);
  const isHost = useMemo(
    () => players.find((p) => p.id === identity?.playerId)?.isHost ?? false,
    [players, identity]
  );

  useHostFailover(roomCode, players, identity);

  const navigate = useCallback(
    async (pageTitle: string) => {
      const id = identity;
      if (!id || hasForfeited) return;
      setMessage(null);
      const res = await fetch(`/api/wiki/${roomCode}/page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: id.playerId, token: id.token, title: pageTitle }),
      });
      const data = await res.json();

      if (!res.ok) {
        // 409 means the route rejected it because the race legitimately
        // ended between this click and the response — the `races`
        // subscription will redirect to /finish momentarily, so just avoid
        // the click looking like it did nothing. Anything else (502 from an
        // unexpected crash, 403 auth failure, …) is a real error and must
        // not be mistaken for the race being over.
        setMessage(res.status === 409 ? "Race over — loading results…" : data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data.status === "blocked") {
        setMessage(`${displayTitle(data.title)} is banned in this room.`);
        return;
      }
      if (data.status === "not_found") {
        setMessage("That page doesn't exist.");
        return;
      }
      setHtml(data.html);
      setTocHtml(data.tocHtml ?? "");
      setDetailsHtml(data.detailsHtml ?? "");
      setCurrentTitle(data.title ?? null);
      setPagesVisited(data.pagesVisitedCount);
    },
    [roomCode, hasForfeited, identity]
  );

  useEffect(() => {
    const id = identity;
    if (!id) {
      router.replace("/");
      return;
    }
    fetch(`/api/rooms/${roomCode}?playerId=${id.playerId}&token=${id.token}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.room || data.room.status !== "racing" || !data.race) {
          router.replace(`/lobby/${roomCode}`);
          return;
        }
        if (data.race.status !== "active") {
          router.replace(`/finish/${roomCode}`);
          return;
        }

        setTargetPage(data.room.targetPage);
        setPlayers(data.players);
        setRaceId(data.race.id);
        setStartedAt(data.race.startedAt);
        setHintText(data.race.hintText);
        setLinkedPageHints(data.race.linkedPageHints ?? []);
        setOpponentProgress(
          Object.fromEntries(
            (data.race.players as { playerId: string; status: string; pagesVisitedCount: number }[])
              .filter((rp) => rp.playerId !== id.playerId)
              .map((rp) => [rp.playerId, { status: rp.status, pagesVisitedCount: rp.pagesVisitedCount }])
          )
        );
        const ownRacePlayer = (data.race.players as { playerId: string; status: string }[]).find(
          (rp) => rp.playerId === id.playerId
        );
        if (ownRacePlayer?.status === "forfeited") {
          setHasForfeited(true);
        } else {
          navigate(data.race.currentPage ?? data.room.startPage);
        }
      });
    // Only ever runs once at mount — navigate is intentionally excluded so
    // a later hasForfeited-driven identity change doesn't re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, router]);

  useEffect(() => {
    const channel = subscribePlayersTable(roomCode, (player) => {
      setPlayers((prev) => upsertPlayer(prev, player));
    });
    return () => {
      channel.unsubscribe();
    };
  }, [roomCode]);

  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsedMs(Date.now() - start);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    if (!raceId) return;
    const ownId = identity?.playerId;

    const handleRaceChange = (row: RaceRow) => {
      if (row.hint_text) setHintText(row.hint_text);
      if (row.linked_page_hints?.length) setLinkedPageHints(row.linked_page_hints);
      if (row.status === "finished" || row.status === "all_forfeited") {
        router.push(`/finish/${roomCode}`);
      }
    };

    const handleRacePlayerChange = (row: RacePlayerRow) => {
      if (row.player_id === ownId) return; // own count is authoritative from navigate()'s response
      setOpponentProgress((prev) => ({
        ...prev,
        [row.player_id]: { status: row.status, pagesVisitedCount: row.pages_visited_count },
      }));
    };

    const channel = subscribeRace(raceId, handleRaceChange, handleRacePlayerChange);
    // Closes the gap between raceId becoming known and the channel actually
    // being subscribed: if the race finished in that window, this catches
    // it instead of the client waiting for an update that already happened.
    supabaseBrowser()
      .from("races")
      .select("*")
      .eq("id", raceId)
      .single()
      .then(({ data }) => {
        if (data) handleRaceChange(data as RaceRow);
      });
    return () => {
      channel.unsubscribe();
    };
  }, [raceId, roomCode, router, identity?.playerId]);

  const handleForfeit = useCallback(async () => {
    const id = identity;
    if (!id) return;
    setBusy(true);
    const res = await fetch(`/api/rooms/${roomCode}/forfeit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: id.playerId, token: id.token }),
    });
    setBusy(false);
    if (res.ok) setHasForfeited(true);
  }, [roomCode, identity]);

  const handleHint = useCallback(async () => {
    const id = identity;
    if (!id) return;
    setBusy(true);
    const res = await fetch(`/api/rooms/${roomCode}/hint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: id.playerId, token: id.token }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setHintText(data.hint);
      setHintHasMore(Boolean(data.hasMore));
    }
  }, [roomCode, identity]);

  const handleLinkedPageHint = useCallback(async () => {
    const id = identity;
    if (!id) return;
    setBusy(true);
    const res = await fetch(`/api/rooms/${roomCode}/hint/linked-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: id.playerId, token: id.token }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setLinkedPageHints(data.pages);
      setLinkedPageHasMore(Boolean(data.hasMore));
    }
  }, [roomCode, identity]);

  useEffect(() => {
    if (!hintMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!hintMenuRef.current?.contains(e.target as Node)) setHintMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [hintMenuOpen]);

  // Wired via the onLoad prop (rather than an effect + addEventListener) so
  // it's attached before the iframe element exists, with no window in which
  // the first srcDoc's load event could fire unobserved. Each srcDoc change
  // is a brand-new document, so this never accumulates stale listeners.
  const handleIframeLoad = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      const doc = e.currentTarget.contentDocument;
      doc?.body.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;

        const tocAnchor = target.closest("a[data-wiki-toc-anchor]") as HTMLAnchorElement | null;
        if (tocAnchor) {
          event.preventDefault();
          const anchorId = tocAnchor.getAttribute("data-wiki-toc-anchor");
          if (anchorId) doc.getElementById(anchorId)?.scrollIntoView({ block: "start" });
          return;
        }

        const anchor = target.closest("a[data-wiki-title]") as HTMLAnchorElement | null;
        if (anchor) {
          event.preventDefault();
          const wikiTitle = anchor.getAttribute("data-wiki-title");
          if (wikiTitle) navigate(wikiTitle);
          return;
        }

        const collapsibleTitle = target.closest(
          ".mw-collapsible.mw-collapsed > .sidebar-list-title, .mw-collapsible.mw-collapsed > .wiki-race-extra-title"
        ) as HTMLElement | null;
        if (collapsibleTitle) collapsibleTitle.parentElement?.classList.toggle("wiki-race-expanded");
      });

      // Drag-resize for the TOC/details columns. Widths live in refs, not
      // React state (see their declaration) — every mousemove writes
      // straight to the column's own flex-basis so the drag tracks the
      // cursor at full frame rate, with no React render (and no srcDoc
      // rebuild/iframe reload) in the loop. `columnWidths` only feeds the
      // *next* page's srcDoc build, which is how the chosen width survives
      // navigating to a new article.
      function attachResizeHandle(side: "toc" | "details") {
        const handle = doc?.querySelector(`[data-resize="${side}"]`) as HTMLElement | null;
        const column = doc?.getElementById(side === "toc" ? "wiki-race-toc" : "wiki-race-details");
        if (!doc || !handle || !column) return;

        handle.addEventListener("mousedown", (downEvent) => {
          downEvent.preventDefault();
          const startX = downEvent.clientX;
          const startWidth = columnWidths[side];
          handle.classList.add("wiki-race-active");
          doc.body.classList.add("wiki-race-noselect");

          const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            const raw = side === "toc" ? startWidth + delta : startWidth - delta;
            const clamped = Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, raw));
            column.style.flexBasis = `${clamped}px`;
            columnWidths[side] = clamped;
          };
          const onMouseUp = () => {
            handle.classList.remove("wiki-race-active");
            doc.body.classList.remove("wiki-race-noselect");
            doc.removeEventListener("mousemove", onMouseMove);
            doc.removeEventListener("mouseup", onMouseUp);
          };
          doc.addEventListener("mousemove", onMouseMove);
          doc.addEventListener("mouseup", onMouseUp);
        });
      }
      attachResizeHandle("toc");
      attachResizeHandle("details");
    },
    [navigate, columnWidths]
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 bg-zinc-100 dark:bg-zinc-900 dark:border-zinc-800">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-mono">{formatElapsed(elapsedMs)}</span>
          <span>
            Target: <strong>{targetPage ? displayTitle(targetPage) : "…"}</strong>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">Pages visited: {pagesVisited}</span>
          {isHost && (
            <div className="relative" ref={hintMenuRef}>
              <button
                onClick={() => setHintMenuOpen((open) => !open)}
                disabled={busy || (!hintHasMore && !linkedPageHasMore)}
                className="rounded-full border px-3 py-1 text-sm disabled:opacity-50 dark:border-zinc-600"
              >
                💡 Hint ▾
              </button>
              {hintMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 rounded border bg-white text-sm shadow-lg z-10 dark:bg-zinc-900 dark:border-zinc-600">
                  <button
                    onClick={() => {
                      setHintMenuOpen(false);
                      handleHint();
                    }}
                    disabled={busy || !hintHasMore}
                    title={hintText ? "Reveal another sentence" : "Reveal a hint"}
                    className="block w-full px-3 py-2 text-left disabled:opacity-50 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Next Sentence
                  </button>
                  <button
                    onClick={() => {
                      setHintMenuOpen(false);
                      handleLinkedPageHint();
                    }}
                    disabled={busy || !linkedPageHasMore}
                    title={linkedPageHints.length ? "Reveal another linked page" : "Reveal a page that links to the target"}
                    className="block w-full px-3 py-2 text-left disabled:opacity-50 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Linked Page
                  </button>
                </div>
              )}
            </div>
          )}
          {!hasForfeited && (
            <button
              onClick={handleForfeit}
              disabled={busy}
              className="rounded-full border px-3 py-1 text-sm disabled:opacity-50 dark:border-zinc-600"
            >
              Forfeit
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>

      {Object.keys(opponentProgress).length > 0 && (
        <div className="flex gap-3 px-4 py-1.5 text-xs text-zinc-500 border-b dark:border-zinc-800">
          {Object.entries(opponentProgress).map(([playerId, p]) => (
            <span key={playerId}>
              {playerNames[playerId] ?? "Player"}: {p.pagesVisitedCount} {p.status !== "racing" && `(${p.status})`}
            </span>
          ))}
        </div>
      )}

      {hintText && (
        <div className="bg-sky-100 text-sky-900 px-4 py-2 text-sm">
          <strong>Hint:</strong> {hintText}
        </div>
      )}

      {linkedPageHints.length > 0 && (
        <div className="bg-sky-100 text-sky-900 px-4 py-2 text-sm">
          <strong>Links to target:</strong> {linkedPageHints.map(displayTitle).join(", ")}
        </div>
      )}

      {message && <div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm">{message}</div>}

      {hasForfeited && (
        <div className="bg-zinc-200 text-zinc-700 px-4 py-2 text-sm dark:bg-zinc-800 dark:text-zinc-300">
          You forfeited — spectating until the race ends.
        </div>
      )}

      <iframe
        onLoad={handleIframeLoad}
        srcDoc={buildSrcDoc(
          stylesheetHrefs,
          currentTitle ? displayTitle(currentTitle) : "",
          html,
          tocHtml,
          detailsHtml,
          isDark,
          columnWidths.toc,
          columnWidths.details
        )}
        title="Wikipedia article"
        className={`flex-1 w-full border-0 bg-white ${hasForfeited ? "pointer-events-none opacity-60" : ""}`}
      />
    </div>
  );
}
