export type RoomStatus = "lobby" | "racing";
export type RaceStatus = "active" | "finished" | "all_forfeited";
export type RacePlayerStatus = "racing" | "forfeited" | "finished";

// Shapes returned by our own API routes (camelCase).
export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

export interface Room {
  code: string;
  status: RoomStatus;
  startPage: string | null;
  targetPage: string | null;
  bannedPages: string[];
}

// Raw Postgres row shapes, as delivered by postgres_changes payloads
// (snake_case, matching the DB columns directly).
export interface PlayerRow {
  id: string;
  room_code: string;
  name: string;
  is_host: boolean;
  connected: boolean;
}

export interface RoomRow {
  code: string;
  host_player_id: string | null;
  status: RoomStatus;
  start_page: string | null;
  target_page: string | null;
  banned_pages: string[];
}

export interface RaceRow {
  id: string;
  room_code: string;
  start_page: string;
  target_page: string;
  status: RaceStatus;
  started_at: string;
  winner_player_id: string | null;
  winner_path: string[] | null;
  hint_text: string | null;
  linked_page_hints: string[];
}

export interface RacePlayerRow {
  race_id: string;
  player_id: string;
  status: RacePlayerStatus;
  current_page: string;
  pages_visited_count: number;
}

// The consolidated shape GET /api/rooms/[code] returns for the current (or
// most recently finished) race — `currentPage` and the per-player list are
// pre-shaped for direct rendering rather than raw DB rows.
export interface RaceSnapshot {
  id: string;
  status: RaceStatus;
  startPage: string;
  targetPage: string;
  startedAt: string;
  hintText: string | null;
  linkedPageHints: string[];
  winnerPlayerId: string | null;
  winnerPath: string[] | null;
  players: { playerId: string; status: RacePlayerStatus; pagesVisitedCount: number }[];
  currentPage: string | null;
}
