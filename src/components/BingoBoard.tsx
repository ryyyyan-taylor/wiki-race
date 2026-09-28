"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { displayTitle } from "@/lib/format";
import type { BingoClaim } from "@/lib/types";

interface Props {
  boardSize: number;
  boardPages: string[];
  claims: BingoClaim[];
  players: { id: string; color: string | null }[];
  // false renders a plain static grid (the finish page's frozen board) with
  // no drag/resize chrome — true (the default) is the floating race overlay.
  draggable?: boolean;
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const POS_KEY = "wikirace:bingo-board-pos";
const SIZE_KEY = "wikirace:bingo-board-size";
const DEFAULT_POS: Point = { x: 24, y: 88 };
const DEFAULT_SIZE: Size = { width: 320, height: 320 };
const MIN_SIZE = 200;

// Per-browser convenience only — not shared state, so a plain try/catch
// around localStorage is enough (private windows, blocked storage, etc.
// just fall back to the default position/size).
function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore — see readStored
  }
}

export function BingoBoard({ boardSize, boardPages, claims, players, draggable = true }: Props) {
  const colorByPlayer = useMemo(
    () => new Map(players.filter((p) => p.color).map((p) => [p.id, p.color as string])),
    [players]
  );
  const claimantsBySquare = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const claim of claims) {
      const list = map.get(claim.squareIndex) ?? [];
      list.push(claim.playerId);
      map.set(claim.squareIndex, list);
    }
    return map;
  }, [claims]);

  const [pos, setPos] = useState<Point>(() => readStored(POS_KEY, DEFAULT_POS));
  const [size, setSize] = useState<Size>(() => readStored(SIZE_KEY, DEFAULT_SIZE));
  const panelRef = useRef<HTMLDivElement>(null);

  // Same technique as the race iframe's own TOC/details resize handles
  // (RaceView.tsx): direct style writes on every mousemove for full frame
  // rate, with the final value only committed to React state (and here,
  // localStorage) on mouseup — but at `window` level, since this panel
  // floats outside the iframe entirely.
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPos = pos;
      let latest = startPos;
      const onMouseMove = (moveEvent: MouseEvent) => {
        latest = { x: startPos.x + (moveEvent.clientX - startX), y: startPos.y + (moveEvent.clientY - startY) };
        const panel = panelRef.current;
        if (panel) {
          panel.style.left = `${latest.x}px`;
          panel.style.top = `${latest.y}px`;
        }
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setPos(latest);
        writeStored(POS_KEY, latest);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [pos]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = size;
      let latest = startSize;
      const onMouseMove = (moveEvent: MouseEvent) => {
        latest = {
          width: Math.max(MIN_SIZE, startSize.width + (moveEvent.clientX - startX)),
          height: Math.max(MIN_SIZE, startSize.height + (moveEvent.clientY - startY)),
        };
        const panel = panelRef.current;
        if (panel) {
          panel.style.width = `${latest.width}px`;
          panel.style.height = `${latest.height}px`;
        }
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setSize(latest);
        writeStored(SIZE_KEY, latest);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [size]
  );

  function squareStyle(squareIndex: number): React.CSSProperties {
    const colors = (claimantsBySquare.get(squareIndex) ?? [])
      .map((playerId) => colorByPlayer.get(playerId))
      .filter((color): color is string => Boolean(color));
    if (colors.length === 0) return {};
    const background =
      colors.length === 1
        ? colors[0]
        : `conic-gradient(${colors
            .map((color, i) => `${color} ${(i * 360) / colors.length}deg ${((i + 1) * 360) / colors.length}deg`)
            .join(", ")})`;
    return { background, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.7)" };
  }

  const grid = (
    <div
      className="grid h-full w-full gap-1"
      style={{ gridTemplateColumns: `repeat(${boardSize}, 1fr)`, gridTemplateRows: `repeat(${boardSize}, 1fr)` }}
    >
      {boardPages.map((title, index) => (
        <div
          key={index}
          className="flex items-center justify-center overflow-hidden rounded border p-1 text-center text-[10px] leading-tight dark:border-zinc-600"
          style={squareStyle(index)}
        >
          {displayTitle(title)}
        </div>
      ))}
    </div>
  );

  if (!draggable) {
    return <div className="aspect-square w-full max-w-md">{grid}</div>;
  }

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height }}
      className="z-40 flex flex-col rounded-lg border bg-white/95 shadow-lg dark:border-zinc-700 dark:bg-zinc-900/95"
    >
      <div
        onMouseDown={handleDragStart}
        className="cursor-move select-none rounded-t-lg border-b bg-zinc-100 px-3 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-800"
      >
        Bingo Board
      </div>
      <div className="min-h-0 flex-1 p-2">{grid}</div>
      <div onMouseDown={handleResizeStart} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" />
    </div>
  );
}
