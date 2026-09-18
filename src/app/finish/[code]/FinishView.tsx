"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getIdentity } from "@/lib/identity";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { subscribeRoomRow, subscribePlayersTable, subscribeRace, upsertPlayer } from "@/lib/realtime/tables";
import { useHostFailover } from "@/lib/realtime/presence";
import { getServerThemeSnapshot, getThemeSnapshot, subscribeTheme } from "@/lib/theme";
import { displayTitle } from "@/lib/format";
import { buildArticleSrcDoc, DEFAULT_DETAILS_WIDTH, DEFAULT_TOC_WIDTH } from "@/lib/wiki-render";
import type { Player, RacePlayerRow, RaceSnapshot, RoomRow } from "@/lib/types";

interface Props {
  roomCode: string;
  stylesheetHrefs: string[];
}

interface TargetArticle {
  title: string;
  html: string;
  tocHtml: string;
  detailsHtml: string;
}

function statusLabel(status: string, isWinner: boolean) {
  if (isWinner) return "Winner";
  if (status === "forfeited") return "Forfeited";
  return "Did not finish";
}

function remainingPathLabel(remainingPath: string[] | null, timedOut: boolean) {
  if (remainingPath === null) return timedOut ? "distance unknown" : "calculating…";
  if (remainingPath.length === 0) return "no path to the finish found";
  const hops = remainingPath.length - 1;
  return `${hops} page${hops === 1 ? "" : "s"} from the finish`;
}

export function FinishView({ roomCode, stylesheetHrefs }: Props) {
  const router = useRouter();
  const isDark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [identity] = useState(() => getIdentity(roomCode));
  const [players, setPlayers] = useState<Player[]>([]);
  const [race, setRace] = useState<RaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetArticle, setTargetArticle] = useState<TargetArticle | null>(null);
  const [targetLinkedPages, setTargetLinkedPages] = useState<string[] | null>(null);

  const isHost = useMemo(
    () => players.find((p) => p.id === identity?.playerId)?.isHost ?? false,
    [players, identity]
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
        if (!data.room) {
          setError("Room not found");
          return;
        }
        if (data.room.status === "lobby") {
          router.replace(`/lobby/${roomCode}`);
          return;
        }
        if (!data.race || data.race.status === "active") {
          router.replace(`/race/${roomCode}`);
          return;
        }
        setPlayers(data.players);
        setRace(data.race);
      });
  }, [roomCode, router, identity]);

  useEffect(() => {
    const channel = subscribeRoomRow(roomCode, (row: RoomRow) => {
      if (row.status === "lobby") router.push(`/lobby/${roomCode}`);
    });
    return () => {
      channel.unsubscribe();
    };
  }, [roomCode, router]);

  useEffect(() => {
    const channel = subscribePlayersTable(roomCode, (player) => {
      setPlayers((prev) => upsertPlayer(prev, player));
    });
    return () => {
      channel.unsubscribe();
    };
  }, [roomCode]);

  useHostFailover(roomCode, players, identity);

  const raceId = race?.id;
  useEffect(() => {
    if (!raceId) return;
    const applyRacePlayerChange = (row: RacePlayerRow) => {
      if (row.race_id !== raceId) return;
      setRace((prev) =>
        prev
          ? {
              ...prev,
              players: prev.players.map((p) =>
                p.playerId === row.player_id ? { ...p, remainingPath: row.remaining_path } : p
              ),
            }
          : prev
      );
    };
    const channel = subscribeRace(raceId, () => {}, applyRacePlayerChange);
    // Closes the gap between the initial fetch and the subscription actually
    // attaching: if a background distance search finished in that window,
    // this catches it instead of waiting on an update that already happened.
    supabaseBrowser()
      .from("race_players")
      .select("*")
      .eq("race_id", raceId)
      .then(({ data }) => {
        for (const row of (data ?? []) as RacePlayerRow[]) applyRacePlayerChange(row);
      });
    return () => {
      channel.unsubscribe();
    };
  }, [raceId]);

  // The searches themselves give up well before this, but a killed/crashed
  // background job (e.g. a serverless function's own time limit cutting off
  // the `after()` callback before it writes back) would otherwise leave a
  // player's distance saying "calculating…" forever — degrade to "unknown"
  // instead once it's been too long.
  const stillCalculatingRemainingPaths =
    race?.players.some((p) => p.playerId !== race.winnerPlayerId && p.remainingPath === null) ?? false;
  const [remainingPathsTimedOut, setRemainingPathsTimedOut] = useState(false);
  useEffect(() => {
    if (!stillCalculatingRemainingPaths) return;
    const timeout = setTimeout(() => setRemainingPathsTimedOut(true), 20000);
    return () => clearTimeout(timeout);
  }, [stillCalculatingRemainingPaths]);

  // The target article and its backlinks don't change once the race is
  // over — fetch them once, separately from the race/player data above.
  useEffect(() => {
    if (!raceId) return;
    fetch(`/api/wiki/${roomCode}/target`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.html) return;
        setTargetArticle({ title: data.title, html: data.html, tocHtml: data.tocHtml, detailsHtml: data.detailsHtml });
        setTargetLinkedPages(data.linkedPages ?? []);
      });
  }, [roomCode, raceId]);

  // Same click handling as the race page's article iframe (TOC jump links,
  // collapsible sections) minus navigation — this is a static reference
  // copy of the target page, not another leg of the race, so in-article
  // wiki-links are inert. Also grows the iframe to fit its content instead
  // of scrolling internally, so it reads as part of the normal page flow.
  const handleTargetIframeLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = e.currentTarget;
    const doc = iframe.contentDocument;
    if (!doc) return;
    const resize = () => {
      iframe.style.height = `${doc.documentElement.scrollHeight}px`;
    };
    resize();
    doc.body.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;

      const tocAnchor = target.closest("a[data-wiki-toc-anchor]") as HTMLAnchorElement | null;
      if (tocAnchor) {
        event.preventDefault();
        const anchorId = tocAnchor.getAttribute("data-wiki-toc-anchor");
        if (anchorId) doc.getElementById(anchorId)?.scrollIntoView({ block: "start" });
        return;
      }

      const wikiLink = target.closest("a[data-wiki-title]") as HTMLAnchorElement | null;
      if (wikiLink) {
        event.preventDefault();
        return;
      }

      const collapsibleTitle = target.closest(
        ".mw-collapsible.mw-collapsed > .sidebar-list-title, .mw-collapsible.mw-collapsed > .wiki-race-extra-title"
      ) as HTMLElement | null;
      if (collapsibleTitle) {
        collapsibleTitle.parentElement?.classList.toggle("wiki-race-expanded");
        resize();
      }
    });
  }, []);

  const handleBackToLobby = useCallback(async () => {
    const id = identity;
    if (!id) return;
    setBusy(true);
    const res = await fetch(`/api/rooms/${roomCode}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: id.playerId, token: id.token }),
    });
    setBusy(false);
    if (res.ok) router.push(`/lobby/${roomCode}`);
  }, [roomCode, router, identity]);

  if (error) {
    return <div className="flex flex-1 items-center justify-center">{error}</div>;
  }
  if (!race) {
    return <div className="flex flex-1 items-center justify-center">Loading…</div>;
  }

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? "Player";

  return (
    <div className="flex flex-1 flex-col items-center p-6 gap-8">
      <div className="text-center">
        {race.winnerPlayerId ? (
          <>
            <h1 className="text-3xl font-bold">{playerName(race.winnerPlayerId)} won!</h1>
            <p className="text-zinc-500 mt-2 text-sm">Shortest path ({(race.winnerPath ?? []).length})</p>
            <p className="mt-1 font-mono text-sm max-w-lg">
              {(race.winnerPath ?? []).map(displayTitle).join(" → ")}
            </p>
          </>
        ) : (
          <h1 className="text-3xl font-bold">Everyone forfeited</h1>
        )}
      </div>

      <div className="w-full max-w-5xl">
        <h2 className="font-semibold mb-2">Results</h2>
        <div className="flex flex-wrap gap-4">
          {race.players
            .slice()
            .sort((a, b) => b.pagesVisitedCount - a.pagesVisitedCount)
            .map((rp) => {
              const isWinner = rp.playerId === race.winnerPlayerId;
              return (
                <div key={rp.playerId} className="w-72 rounded-lg border p-3 text-sm dark:border-zinc-700">
                  <details open>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{playerName(rp.playerId)}</span>
                      <div className="text-zinc-500 text-xs mt-0.5">
                        {rp.pagesVisitedCount} pages — {statusLabel(rp.status, isWinner)}
                        {!isWinner ? ` — ${remainingPathLabel(rp.remainingPath, remainingPathsTimedOut)}` : ""}
                      </div>
                    </summary>
                    <ol className="mt-2 ml-4 max-h-64 overflow-y-auto list-decimal space-y-0.5 font-mono text-xs text-zinc-500">
                      {rp.visitedPages.map((title, index) => (
                        <li key={`visited-${index}`}>{displayTitle(title)}</li>
                      ))}
                      {!isWinner
                        ? (rp.remainingPath ?? []).slice(1).map((title, index) => (
                            <li key={`remaining-${index}`} className="italic text-zinc-400 dark:text-zinc-500">
                              {displayTitle(title)}
                            </li>
                          ))
                        : null}
                    </ol>
                  </details>
                </div>
              );
            })}
        </div>
      </div>

      {isHost ? (
        <button
          onClick={handleBackToLobby}
          disabled={busy}
          className="rounded-full bg-black text-white px-8 py-3 font-medium disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Back to Lobby
        </button>
      ) : (
        <p className="text-zinc-500 text-sm">Waiting for the host to return everyone to the lobby…</p>
      )}

      <hr className="w-full max-w-5xl border-zinc-200 dark:border-zinc-800" />

      <div className="w-full max-w-5xl">
        <h2 className="font-semibold mb-2">Pages that linked here</h2>
        {targetLinkedPages === null ? (
          <p className="text-sm text-zinc-400 italic">Loading…</p>
        ) : targetLinkedPages.length === 0 ? (
          <p className="text-sm text-zinc-400 italic">No pages link to the target.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-lg border p-3 dark:border-zinc-700">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {targetLinkedPages.map((title) => (
                <span key={title}>{displayTitle(title)}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-full max-w-5xl">
        {targetArticle ? (
          <iframe
            onLoad={handleTargetIframeLoad}
            srcDoc={buildArticleSrcDoc(
              stylesheetHrefs,
              displayTitle(targetArticle.title),
              targetArticle.html,
              targetArticle.tocHtml,
              targetArticle.detailsHtml,
              isDark,
              DEFAULT_TOC_WIDTH,
              DEFAULT_DETAILS_WIDTH
            )}
            title="Target Wikipedia article"
            className="w-full border-0 bg-white"
          />
        ) : (
          <p className="text-sm text-zinc-400 italic">Loading target page…</p>
        )}
      </div>
    </div>
  );
}
