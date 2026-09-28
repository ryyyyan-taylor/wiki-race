export type RoomStatus = "lobby" | "racing";
export type RaceStatus = "active" | "finished" | "all_forfeited";
export type RacePlayerStatus = "racing" | "forfeited" | "finished";
export type GameMode = "race" | "bingo" | "double_bingo" | "lockout";

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
  gameMode: GameMode;
  boardSize: number | null;
}

// Returned by GET /api/rooms for the home page's open-room list — already
// filtered to rooms with a heartbeating player.
export interface OpenRoom {
  code: string;
  hostName: string;
  playerCount: number;
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
  game_mode: GameMode;
  board_size: number | null;
}

export interface RaceRow {
  id: string;
  room_code: string;
  start_page: string;
  // Null for bingo-family races, which have no single shared target.
  target_page: string | null;
  status: RaceStatus;
  started_at: string;
  winner_player_id: string | null;
  winner_path: string[] | null;
  hint_text: string | null;
  linked_page_hints: string[];
  game_mode: GameMode;
  board_size: number | null;
  board_pages: string[] | null;
}

export interface RacePlayerRow {
  race_id: string;
  player_id: string;
  status: RacePlayerStatus;
  current_page: string;
  pages_visited_count: number;
  // The shortest path found from this player's last visited page to the
  // target, once they're out of the race. Null until computed (or forever,
  // for the winner); [] means the search gave up without finding one.
  remaining_path: string[] | null;
  // Assigned at race start for bingo-family races (from BINGO_PALETTE);
  // null for classic 'race' mode, which has no per-player board presence.
  color: string | null;
}

// One player's claim on one board square, in a bingo-family race. Shared
// modes (bingo/double_bingo) can have several of these per square_index;
// lockout's DB constraint (see 0009_bingo.sql) guarantees at most one.
export interface BingoClaim {
  squareIndex: number;
  playerId: string;
  pageTitle: string;
}

export interface BingoClaimRow {
  race_id: string;
  player_id: string;
  square_index: number;
  page_title: string;
  exclusive: boolean;
  claimed_at: string;
}

// The consolidated shape GET /api/rooms/[code] returns for the current (or
// most recently finished) race — `currentPage` and the per-player list are
// pre-shaped for direct rendering rather than raw DB rows.
export interface RaceSnapshot {
  id: string;
  status: RaceStatus;
  startPage: string;
  // Null for bingo-family races.
  targetPage: string | null;
  startedAt: string;
  hintText: string | null;
  linkedPageHints: string[];
  winnerPlayerId: string | null;
  winnerPath: string[] | null;
  gameMode: GameMode;
  boardSize: number | null;
  boardPages: string[] | null;
  claims: BingoClaim[];
  players: {
    playerId: string;
    status: RacePlayerStatus;
    pagesVisitedCount: number;
    visitedPages: string[];
    // The shortest path found from this player's last visited page to the
    // target. Null while the winner (never computed) or still running in
    // the background; [] means the search gave up without finding one.
    // Always null in bingo-family races — there's no single target to be
    // "remaining" toward.
    remainingPath: string[] | null;
    // Assigned at race start for bingo-family races; null in classic 'race'.
    color: string | null;
  }[];
  currentPage: string | null;
}
