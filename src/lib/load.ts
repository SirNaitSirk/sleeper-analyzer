import type { Cached } from "./cache";
import { startingSlots } from "./lineup";
import { strength, type LeagueModel, type PlayerInfo, type Team } from "./model";
import { buildPicks, pickLabel } from "./picks";
import { getSeasonProjections, scoringFactors } from "./scoring-adjust";
import { getPlayers } from "./players";
import { getWeekProjections, weeklyOutlook } from "./projections";
import {
  getLeague,
  getLeagueUsers,
  getMatchups,
  getNflState,
  getRosters,
  getTradedPicks,
  getTrendingAdds,
  type League,
  type Matchup,
} from "./sleeper";
import { getMarketValues, valueParamsFor } from "./values";
import { getSchedule, lockedTeams } from "./schedule";
import { SLOT_ELIGIBILITY } from "./lineup";

export interface SourceStatus {
  name: string;
  fetchedAt: number | null;
  stale: boolean;
  error?: string;
}

export interface LoadedLeague {
  league: League;
  model: LeagueModel;
  matchups: Matchup[] | null;
  sources: SourceStatus[];
  warnings: string[];
}

async function optional<T>(name: string, p: Promise<Cached<T>>, sources: SourceStatus[]) {
  try {
    const r = await p;
    sources.push({ name, fetchedAt: r.fetchedAt, stale: r.stale });
    return r.data;
  } catch (e) {
    sources.push({ name, fetchedAt: null, stale: true, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function loadLeague(leagueId: string, userId: string): Promise<LoadedLeague> {
  const sources: SourceStatus[] = [];
  const warnings: string[] = [];
  const track = <T,>(name: string, c: Cached<T>) => {
    sources.push({ name, fetchedAt: c.fetchedAt, stale: c.stale });
    return c.data;
  };

  // Required: without these there is nothing to analyse.
  const [leagueC, rostersC, usersC, playersC, stateC] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getLeagueUsers(leagueId),
    getPlayers(),
    getNflState(),
  ]);
  const league = track("Sleeper Liga", leagueC);
  const rosters = track("Sleeper Kader", rostersC);
  const users = track("Sleeper Manager", usersC);
  const playersDb = track("Sleeper Spieler-DB", playersC);
  const state = track("NFL Status", stateC);

  const inSeason = state.season_type === "regular" && league.season === state.season;
  const week = inSeason ? state.week : null;
  if (!inSeason) warnings.push("Keine laufende Regular Season – Wochenprojektionen sind deaktiviert.");

  const valueParams = valueParamsFor(league);
  const [market, proj, trending, matchups, schedule, seasonProj, tradedPicks] = await Promise.all([
    optional("FantasyCalc Marktwerte", getMarketValues(valueParams), sources),
    week ? optional(`Projektionen Woche ${week}`, getWeekProjections(league.season, week), sources) : null,
    optional("Sleeper Trending", getTrendingAdds(), sources),
    week ? optional(`Matchups Woche ${week}`, getMatchups(leagueId, week), sources) : null,
    week ? optional("NFL Spielplan", getSchedule(league.season), sources) : null,
    optional("Saisonprojektionen", getSeasonProjections(league.season), sources),
    valueParams.isDynasty ? optional("Getradete Picks", getTradedPicks(leagueId), sources) : null,
  ]);
  const values = market?.players ?? null;
  // Adapt market values (built for standard scoring) to this league's scoring.
  const factors = seasonProj ? scoringFactors(seasonProj, league.scoring_settings, valueParams.ppr) : {};
  const locked = week && schedule ? lockedTeams(schedule, week) : new Set<string>();
  if (!values) warnings.push("Marktwerte nicht verfügbar – Trade- und Stärke-Analyse sind nicht aussagekräftig.");
  if (week && !proj) warnings.push("Projektionen nicht verfügbar – Start/Sit-Empfehlungen fehlen.");

  const slots = startingSlots(league.roster_positions);
  const usefulPositions = new Set(slots.flatMap((s) => SLOT_ELIGIBILITY[s] ?? [s]));
  const teamsPlaying = new Set(proj?.teamsPlaying ?? []);
  const trendingMap = new Map((trending ?? []).map((t) => [t.player_id, t.count]));

  const players: Record<string, PlayerInfo> = {};
  const info = (id: string): PlayerInfo | null => {
    if (players[id]) return players[id];
    const p = playersDb[id];
    if (!p) return null;
    const v = values?.[id];
    players[id] = {
      id,
      name: p.name,
      position: p.position,
      positions: p.fantasyPositions,
      team: p.team,
      age: p.age,
      injury: proj?.byPlayer[id]?.injuryStatus ?? p.injuryStatus,
      value: (v?.value ?? 0) * (factors[id] ?? 1),
      rawValue: v?.value ?? 0,
      scoringFactor: factors[id] ?? 1,
      trend30: v?.trend30Day ?? 0,
      week: proj
        ? {
            ...weeklyOutlook(id, p.team, p.injuryStatus, proj, teamsPlaying, league.scoring_settings),
            locked: !!p.team && locked.has(p.team),
          }
        : null,
      trendingAdds: trendingMap.get(id) ?? 0,
    };
    return players[id];
  };

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const unknownIds = new Set<string>();
  const teams: Team[] = rosters.map((r) => {
    const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
    const known = (ids: string[] | null) =>
      (ids ?? []).filter((id) => {
        if (info(id)) return true;
        unknownIds.add(id);
        return false;
      });
    const s = r.settings;
    return {
      rosterId: r.roster_id,
      name: owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`,
      manager: owner?.display_name ?? "—",
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      pointsFor: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
      pointsAgainst: (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100,
      players: known(r.players),
      reserve: known(r.reserve),
      taxi: known(r.taxi),
      starters: r.starters ?? [],
      picks: [],
    };
  });
  if (unknownIds.size) warnings.push(`${unknownIds.size} Spieler-ID(s) unbekannt und ignoriert.`);

  const myRoster = rosters.find((r) => r.owner_id === userId || r.co_owners?.includes(userId));
  if (!myRoster) throw new Error("Du hast in dieser Liga keinen Kader.");
  const me = teams.find((t) => t.rosterId === myRoster.roster_id)!;

  const rostered = new Set(rosters.flatMap((r) => r.players ?? []));
  const freeAgents = Object.values(playersDb)
    .filter(
      (p) =>
        !rostered.has(p.id) &&
        p.team &&
        p.fantasyPositions.some((pos) => usefulPositions.has(pos)) &&
        (values?.[p.id] || proj?.byPlayer[p.id] || trendingMap.has(p.id)),
    )
    .map((p) => info(p.id)!.id);

  const model: LeagueModel = {
    leagueId,
    leagueName: league.name,
    season: league.season,
    week,
    isDynasty: valueParams.isDynasty,
    slots,
    players,
    teams,
    me,
    freeAgents,
  };

  if (valueParams.isDynasty && market && Object.keys(market.picks).length) {
    const weakestFirst = [...teams]
      .sort((a, b) => strength(a.players, model) - strength(b.players, model))
      .map((t) => t.rosterId);
    const teamName = (rid: number) => teams.find((t) => t.rosterId === rid)?.name ?? `Team ${rid}`;
    const picks = buildPicks({
      season: league.season,
      draftDone: league.status === "in_season" || league.status === "complete",
      rounds: Math.min(league.settings.draft_rounds ?? 4, 4),
      rosterIds: teams.map((t) => t.rosterId),
      traded: tradedPicks ?? [],
      pickValues: market.picks,
      weakestFirst,
    });
    if (!tradedPicks) warnings.push("Getradete Picks nicht verfügbar – Pick-Besitz kann abweichen.");
    for (const pk of picks) {
      players[pk.id] = {
        id: pk.id,
        name: pickLabel(pk, teamName),
        position: "PICK",
        positions: ["PICK"],
        team: null,
        age: null,
        injury: null,
        value: pk.value,
        rawValue: pk.value,
        scoringFactor: 1,
        trend30: 0,
        week: null,
        trendingAdds: 0,
      };
      teams.find((t) => t.rosterId === pk.ownerRosterId)?.picks.push(pk.id);
    }
  }

  return {
    league,
    model,
    matchups,
    sources,
    warnings,
  };
}
