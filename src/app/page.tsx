"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSavedName, saveName, setIdentity } from "@/lib/identity";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState(getSavedName);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleHost() {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    setBusy(true);
    setError(null);
    saveName(name.trim());
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create room");
      return;
    }
    setIdentity(data.roomCode, { playerId: data.playerId, token: data.token, name: name.trim() });
    router.push(`/lobby/${data.roomCode}`);
  }

  async function handleJoin() {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 5) {
      setError("Room codes are 5 characters");
      return;
    }
    setBusy(true);
    setError(null);
    saveName(name.trim());
    const res = await fetch(`/api/rooms/${code}/join`, {
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
    setIdentity(code, { playerId: data.playerId, token: data.token, name: name.trim() });
    router.push(`/lobby/${code}`);
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <h1 className="text-3xl font-bold text-center mb-8">Wiki Race</h1>
        <input
          className="w-full rounded-lg border px-4 py-3 mb-6 text-lg dark:bg-zinc-900 dark:border-zinc-700"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
        />
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border p-6 flex flex-col items-center gap-4 dark:border-zinc-700">
            <h2 className="text-xl font-semibold">Host</h2>
            <button
              onClick={handleHost}
              disabled={busy}
              className="w-full rounded-full bg-black text-white py-3 font-medium disabled:opacity-50 dark:bg-white dark:text-black"
            >
              Create Room
            </button>
          </div>
          <div className="rounded-xl border p-6 flex flex-col items-center gap-4 dark:border-zinc-700">
            <h2 className="text-xl font-semibold">Join</h2>
            <input
              className="w-full rounded-lg border px-4 py-2 text-center tracking-widest uppercase dark:bg-zinc-900 dark:border-zinc-700"
              placeholder="CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={5}
            />
            <button
              onClick={handleJoin}
              disabled={busy}
              className="w-full rounded-full border py-3 font-medium disabled:opacity-50 dark:border-zinc-600"
            >
              Join Room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
