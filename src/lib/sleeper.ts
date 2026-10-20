import { cached } from "./cache";
import { fetchJson } from "./http";

const API = "https://api.sleeper.app/v1";
const MIN = 60_000;

export interface NflState {
  week: number;
  display_week: number;
  season: string;
  league_season: string;
  season_type: "pre" | "regular" | "post" | "off";
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
}

export interface League {
  league_id: string;
  name: string;
  season: string;
  status: "pre_draft" | "drafting" | "in_season" | "complete";
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: {
    /** 0 redraft, 1 keeper, 2 dynasty */
    type?: number;
    playoff_week_start?: number;
    trade_deadline?: number;
    waiver_type?: number;
    waiver_budget?: number;
    [k: string]: number | undefined;
  };
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
  };
}

export interface LeagueUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
}

export interface Matchup {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  starters: string[] | null;
}

export interface Trending {
  player_id: string;
  count: number;
}

export const getNflState = () =>
  cached("nfl_state", 10 * MIN, () => fetchJson<NflState>(`${API}/state/nfl`), { persist: true });

// Sleeper returns `null` for unknown usernames.
export const getUser = (username: string) =>
  cached(`user_${username.toLowerCase()}`, 24 * 60 * MIN, () =>
    fetchJson<SleeperUser | null>(`${API}/user/${encodeURIComponent(username)}`),
  );

export const getUserLeagues = (userId: string, season: string) =>
  cached(`leagues_${userId}_${season}`, 5 * MIN, () =>
    fetchJson<League[]>(`${API}/user/${userId}/leagues/nfl/${season}`),
  );

// League data changes with every waiver/trade, so keep it short-lived.
export const getLeague = (id: string) =>
  cached(`league_${id}`, MIN, () => fetchJson<League>(`${API}/league/${id}`));

export const getRosters = (id: string) =>
  cached(`rosters_${id}`, MIN, () => fetchJson<Roster[]>(`${API}/league/${id}/rosters`));

export const getLeagueUsers = (id: string) =>
  cached(`users_${id}`, 10 * MIN, () => fetchJson<LeagueUser[]>(`${API}/league/${id}/users`));

export const getMatchups = (id: string, week: number) =>
  cached(`matchups_${id}_${week}`, MIN, () =>
    fetchJson<Matchup[]>(`${API}/league/${id}/matchups/${week}`),
  );

export interface Transaction {
  type: "trade" | "waiver" | "free_agent" | "commissioner";
  status: string;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  roster_ids: number[];
  created: number;
  settings?: { waiver_bid?: number } | null;
  draft_picks?: { season: string; round: number; roster_id: number; owner_id: number; previous_owner_id: number }[];
}

export const getTransactions = (id: string, week: number) =>
  cached(`tx_${id}_${week}`, 5 * MIN, () =>
    fetchJson<Transaction[]>(`${API}/league/${id}/transactions/${week}`),
  );

export interface TradedPick {
  season: string;
  round: number;
  /** original owner */
  roster_id: number;
  /** current owner */
  owner_id: number;
  previous_owner_id: number;
}

export const getTradedPicks = (id: string) =>
  cached(`traded_picks_${id}`, 5 * MIN, () => fetchJson<TradedPick[]>(`${API}/league/${id}/traded_picks`));

export const getTrendingAdds = () =>
  cached("trending_add", 30 * MIN, () =>
    fetchJson<Trending[]>(`${API}/players/nfl/trending/add?lookback_hours=24&limit=100`),
  );
