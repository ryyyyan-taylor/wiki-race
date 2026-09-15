"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSavedName, saveName, setIdentity, useIdentity, type Identity } from "@/lib/identity";
import { subscribeRoomRow, subscribePlayersTable, upsertPlayer } from "@/lib/realtime/tables";
import { useHostFailover } from "@/lib/realtime/presence";
import { displayTitle } from "@/lib/format";
import type { Player, Room, RoomRow } from "@/lib/types";

interface Props {
  roomCode: string;
}

const HEARTBEAT_INTERVAL_MS = 15_000;

// Picks and persists one field's random page server-side (see
// /api/rooms/[code]/random-pages) — every viewer's `rooms` row subscription
// then converges on the same value, rather than each client guessing its
// own via a separate API call. Returns the picked title so a caller that
// wants immediate feedback (the dice button) doesn't have to wait on the
// subscription round-trip; null on failure.
async function requestRandomPage(roomCode: string, identity: Identity, field: "start" | "target") {
  const res = await fetch(`/api/rooms/${roomCode}/random-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: identity.playerId, token: identity.token, field }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.title as string;
}

export function LobbyView({ roomCode }: Props) {
  const router = useRouter();
  const identity = useIdentity(roomCode);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Guards the redirect on the lobby->racing transition rather than the
  // value, so a later, unrelated `rooms` update while still racing (e.g.
  // the host revisits this tab) doesn't re-push every time.
  const lastStatus = useRef<Room["status"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms/${roomCode}`).then(async (res) => {
      if (!res.ok) {
        if (!cancelled) setError("Room not found");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      lastStatus.current = data.room.status;
      if (data.room.status === "racing") {
        router.replace(`/race/${roomCode}`);
        return;
      }
      setRoom(data.room);
      setPlayers(data.players);
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode, router]);

  useEffect(() => {
    const channel = subscribeRoomRow(roomCode, (row: RoomRow) => {
      setRoom({
        code: row.code,
        status: row.status,
        startPage: row.start_page,
        targetPage: row.target_page,
        bannedPages: row.banned_pages,
      });
      if (row.status === "racing" && lastStatus.current !== "racing") {
        router.push(`/race/${roomCode}`);
      }
      lastStatus.current = row.status;
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

  // Keeps this player's `last_seen_at` fresh so the home page's open-room
  // list (see GET /api/rooms) knows someone is actually still here — well
  // under ROOM_STALE_MS there, so a missed beat or two doesn't drop the
  // room from the list.
  useEffect(() => {
    if (!identity) return;
    const beat = () => {
      fetch(`/api/rooms/${roomCode}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: identity.playerId, token: identity.token }),
      });
    };
    beat();
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomCode, identity]);

  // Keeps the room's start/target pages populated with a random pick
  // whenever they're empty — on first load, and again if the host clears a
  // field back to blank. Guarded per-field so a slow request in flight
  // doesn't fire a duplicate; retries naturally on the next `room` update
  // if a previous attempt failed and the field is still empty. Capped per
  // field so a persistent failure (e.g. Wikipedia rate-limiting) doesn't
  // retry forever every time `players` churns (presence, host-transfer).
  const autoFilling = useRef({ start: false, target: false });
  const autoFillAttempts = useRef({ start: 0, target: 0 });
  const [autoFillError, setAutoFillError] = useState<string | null>(null);
  const MAX_AUTO_FILL_ATTEMPTS = 3;
  useEffect(() => {
    const amHost = players.find((p) => p.id === identity?.playerId)?.isHost ?? false;
    if (!amHost || !room || !identity) return;

    if (!room.startPage && !autoFilling.current.start && autoFillAttempts.current.start < MAX_AUTO_FILL_ATTEMPTS) {
      autoFilling.current.start = true;
      autoFillAttempts.current.start += 1;
      requestRandomPage(roomCode, identity, "start")
        .then((title) => {
          if (title) setAutoFillError(null);
          else setAutoFillError("Couldn't pick a random start page — use the dice button to try again.");
        })
        .finally(() => {
          autoFilling.current.start = false;
        });
    }
    if (!room.targetPage && !autoFilling.current.target && autoFillAttempts.current.target < MAX_AUTO_FILL_ATTEMPTS) {
      autoFilling.current.target = true;
      autoFillAttempts.current.target += 1;
      requestRandomPage(roomCode, identity, "target")
        .then((title) => {
          if (title) setAutoFillError(null);
          else setAutoFillError("Couldn't pick a random target page — use the dice button to try again.");
        })
        .finally(() => {
          autoFilling.current.target = false;
        });
    }
  }, [room, players, identity, roomCode]);

  if (error) {
    return <div className="flex flex-1 items-center justify-center">{error}</div>;
  }

  if (!identity) {
    return <JoinForm roomCode={roomCode} />;
  }

  if (!room) {
    return <div className="flex flex-1 items-center justify-center">Loading…</div>;
  }

  const isHost = players.find((p) => p.id === identity.playerId)?.isHost ?? false;

  return (
    <div className="flex flex-1 flex-col items-center p-6 gap-8">
      <div className="text-center">
        <p className="text-sm text-zinc-500">Room code</p>
        <p className="text-5xl font-mono font-bold tracking-widest">{roomCode}</p>
      </div>

      <div className="w-full max-w-md">
        <h2 className="font-semibold mb-2">Players</h2>
        <ul className="divide-y rounded-lg border dark:border-zinc-700 dark:divide-zinc-700">
          {players.map((p) => (
            <li key={p.id} className="px-4 py-2 flex justify-between">
              <span>{p.name}</span>
              {p.isHost && <span className="text-xs text-zinc-500">Host</span>}
            </li>
          ))}
        </ul>
      </div>

      {isHost && autoFillError && <p className="text-amber-600 text-sm max-w-md text-center">{autoFillError}</p>}
      <RulesPanel
        roomCode={roomCode}
        identity={identity}
        room={room}
        isHost={isHost}
        onManualReroll={(field) => {
          autoFillAttempts.current[field] = 0;
        }}
      />

      {isHost ? (
        <StartRaceButton roomCode={roomCode} identity={identity} />
      ) : (
        <p className="text-zinc-500 text-sm">Waiting for the host to start the race…</p>
      )}
    </div>
  );
}

function JoinForm({ roomCode }: { roomCode: string }) {
  const [name, setName] = useState(getSavedName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleJoin() {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    setBusy(true);
    setError(null);
    saveName(name.trim());
    const res = await fetch(`/api/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not join room");
      return;
    }
    setIdentity(roomCode, { playerId: data.playerId, token: data.token, name: name.trim() });
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-center">Join room {roomCode}</h1>
        <input
          className="rounded-lg border px-4 py-3 text-lg dark:bg-zinc-900 dark:border-zinc-700"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          onClick={handleJoin}
          disabled={busy}
          className="rounded-full bg-black text-white py-3 font-medium disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Join Room
        </button>
      </div>
    </div>
  );
}

// Search-as-you-type against Wikipedia, shared by the start/target/banned
// fields. `onSelect` fires both for a clicked suggestion and for pressing
// Enter with whatever's currently typed — the server resolves/validates the
// title either way (via resolveCanonicalTitle), so an unmatched Enter isn't
// a dead end, just not autocompleted.
function WikiSearchInput({
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (title: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Blank input: skip fetching and leave any stale `suggestions` as-is —
    // the render guard below (`value.trim() && ...`) hides them either way,
    // so there's no need to clear them synchronously from here too.
    if (!value.trim()) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(value)}`);
      if (cancelled || !res.ok) return;
      const data = await res.json();
      setSuggestions(data.titles ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  function selectTitle(title: string) {
    onSelect(title);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="relative flex-1 min-w-0">
      <input
        className="w-full rounded border px-3 py-2 dark:bg-zinc-900 dark:border-zinc-700"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            e.preventDefault();
            selectTitle(value.trim());
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && value.trim() && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded border bg-white shadow dark:bg-zinc-900 dark:border-zinc-700">
          {suggestions.map((title) => (
            <li key={title}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectTitle(title)}
                className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {displayTitle(title)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RulesPanel({
  roomCode,
  identity,
  room,
  isHost,
  onManualReroll,
}: {
  roomCode: string;
  identity: Identity;
  room: Room;
  isHost: boolean;
  onManualReroll: (field: "start" | "target") => void;
}) {
  // start/targetPage always begin blank, even if `room.startPage` is
  // already set — that field holds the ambient auto-picked preview (shown
  // via the placeholder below) as much as it holds a host-typed override,
  // and the two are indistinguishable once saved. Seeding the input from it
  // would show the random pick as if it were a locked-in override and — via
  // the dice button's `disabled={startPage.trim().length > 0}` — leave the
  // reroll button permanently disabled on every fresh page load.
  const [startPage, setStartPage] = useState("");
  const [targetPage, setTargetPage] = useState("");
  const [banInput, setBanInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic placeholder for the reroll the host themselves just
  // triggered — the `rooms` row subscription will confirm it shortly, but
  // this gives instant feedback rather than a click that looks like nothing
  // happened until the round-trip lands. Banned-page edits use the same
  // trick (add/remove saves immediately, and this shows the result before
  // the round-trip confirms) rather than a separate piece of state kept in
  // sync with `room.bannedPages` via an effect.
  const [optimisticStart, setOptimisticStart] = useState<string | null>(null);
  const [optimisticTarget, setOptimisticTarget] = useState<string | null>(null);
  const [optimisticBannedPages, setOptimisticBannedPages] = useState<string[] | null>(null);
  const [rerollingStart, setRerollingStart] = useState(false);
  const [rerollingTarget, setRerollingTarget] = useState(false);
  const displayStartPage = optimisticStart ?? room.startPage;
  const displayTargetPage = optimisticTarget ?? room.targetPage;
  const bannedPages = optimisticBannedPages ?? room.bannedPages ?? [];

  async function handleRerollStart() {
    setRerollingStart(true);
    const title = await requestRandomPage(roomCode, identity, "start");
    if (title) {
      setOptimisticStart(title);
      onManualReroll("start");
    }
    setRerollingStart(false);
  }

  async function handleRerollTarget() {
    setRerollingTarget(true);
    const title = await requestRandomPage(roomCode, identity, "target");
    if (title) {
      setOptimisticTarget(title);
      onManualReroll("target");
    }
    setRerollingTarget(false);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rooms/${roomCode}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: identity.playerId,
        token: identity.token,
        // Blank means "no override" now, not "clear it to random" — the
        // room's start/target already carry a live auto-picked preview, and
        // an empty field here should leave that alone rather than null it
        // out from under the lobby (the dice button is what resets it).
        ...(startPage.trim() && { startPage: startPage.trim() }),
        ...(targetPage.trim() && { targetPage: targetPage.trim() }),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save rules");
      return;
    }
    setStartPage("");
    setTargetPage("");
  }

  async function saveBannedPages(nextList: string[]) {
    await fetch(`/api/rooms/${roomCode}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: identity.playerId, token: identity.token, bannedPages: nextList }),
    });
  }

  // Each add/remove saves immediately rather than batching into Save Rules
  // — a list edit reads as a discrete action, not a draft in progress.
  // Reading `bannedPages` directly (rather than through a ref) is fine
  // here: these only ever fire one at a time from a discrete click/keypress,
  // each of which lands after the previous one's render has already
  // committed, so the closure is never stale in practice.
  function addBannedPage(rawTitle: string) {
    const title = rawTitle.trim();
    setBanInput("");
    if (!title || bannedPages.includes(title)) return;
    const nextList = [...bannedPages, title];
    setOptimisticBannedPages(nextList);
    saveBannedPages(nextList);
  }

  function removeBannedPage(title: string) {
    const nextList = bannedPages.filter((p) => p !== title);
    setOptimisticBannedPages(nextList);
    saveBannedPages(nextList);
  }

  // Everyone can see the rules; only the host gets the editable form below.
  if (!isHost) {
    return (
      <div className="w-full max-w-md rounded-lg border p-4 flex flex-col gap-3 dark:border-zinc-700">
        <h2 className="font-semibold">Rules</h2>
        <p className="text-sm">
          Start page: <strong>{room.startPage ? displayTitle(room.startPage) : "Random"}</strong>
        </p>
        <p className="text-sm">
          Target page: <strong>{room.targetPage ? displayTitle(room.targetPage) : "Random"}</strong>
        </p>
        {bannedPages.length > 0 && (
          <div className="text-sm flex flex-col gap-1">
            Banned pages
            <div className="flex flex-wrap gap-2">
              {bannedPages.map((title) => (
                <span key={title} className="rounded-full border px-3 py-1 text-xs dark:border-zinc-600">
                  {displayTitle(title)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-lg border p-4 flex flex-col gap-3 dark:border-zinc-700">
      <h2 className="font-semibold">Rules (host only)</h2>
      <label className="text-sm flex flex-col gap-1">
        Start page (leave blank for random)
        <div className="flex gap-2">
          <WikiSearchInput
            value={startPage}
            onChange={setStartPage}
            onSelect={setStartPage}
            placeholder={displayStartPage ? displayTitle(displayStartPage) : "Random"}
          />
          <button
            type="button"
            onClick={handleRerollStart}
            disabled={startPage.trim().length > 0 || rerollingStart}
            title={startPage.trim() ? "Clear the field to use a random page" : "Re-roll random start page"}
            aria-label="Re-roll random start page"
            className="rounded border px-3 py-2 disabled:opacity-30 dark:border-zinc-700"
          >
            🎲
          </button>
        </div>
      </label>
      <label className="text-sm flex flex-col gap-1">
        Target page (leave blank for random)
        <div className="flex gap-2">
          <WikiSearchInput
            value={targetPage}
            onChange={setTargetPage}
            onSelect={setTargetPage}
            placeholder={displayTargetPage ? displayTitle(displayTargetPage) : "Random"}
          />
          <button
            type="button"
            onClick={handleRerollTarget}
            disabled={targetPage.trim().length > 0 || rerollingTarget}
            title={targetPage.trim() ? "Clear the field to use a random page" : "Re-roll random target page"}
            aria-label="Re-roll random target page"
            className="rounded border px-3 py-2 disabled:opacity-30 dark:border-zinc-700"
          >
            🎲
          </button>
        </div>
      </label>
      <div className="text-sm flex flex-col gap-1">
        Banned pages
        <div className="flex gap-2">
          <WikiSearchInput value={banInput} onChange={setBanInput} onSelect={addBannedPage} placeholder="Search a page to ban" />
          <button
            type="button"
            onClick={() => addBannedPage(banInput)}
            disabled={!banInput.trim()}
            aria-label="Add banned page"
            className="rounded border px-3 py-2 disabled:opacity-30 dark:border-zinc-700"
          >
            +
          </button>
        </div>
        {bannedPages.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {bannedPages.map((title) => (
              <span
                key={title}
                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs dark:border-zinc-600"
              >
                {displayTitle(title)}
                <button
                  type="button"
                  onClick={() => removeBannedPage(title)}
                  aria-label={`Remove ${displayTitle(title)}`}
                  className="text-zinc-500 hover:text-red-600"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        onClick={handleSave}
        disabled={busy}
        className="rounded-full border py-2 font-medium disabled:opacity-50 dark:border-zinc-600"
      >
        Save Rules
      </button>
    </div>
  );
}

function StartRaceButton({ roomCode, identity }: { roomCode: string; identity: Identity }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleStart() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/rooms/${roomCode}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: identity.playerId, token: identity.token }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error ?? "Could not start race");
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        onClick={handleStart}
        disabled={busy}
        className="rounded-full bg-black text-white px-8 py-3 font-medium disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Start Race
      </button>
    </div>
  );
}
