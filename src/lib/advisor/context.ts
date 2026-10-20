import { lineupAdvice, positionalNeeds, powerRankings } from "../analysis";
import type { LoadedLeague } from "../load";
import type { LeagueModel, PlayerInfo, Team } from "../model";
import { getTransactions, type Transaction } from "../sleeper";
import { findTrades } from "../trades";
import { findWaivers } from "../waivers";

const TYPE = ["Redraft", "Keeper", "Dynasty"];

const r1 = (n: number) => Math.round(n * 10) / 10;

function playerLine(p: PlayerInfo, extra = ""): string {
  const parts = [
    `${p.name} (${p.position}, ${p.team ?? "FA"}`,
    p.age ? `, ${p.age} J.` : "",
    `) Wert ${Math.round(p.value)}`,
    p.trend30 ? ` (30T ${p.trend30 > 0 ? "+" : ""}${Math.round(p.trend30)})` : "",
    p.week ? ` | Proj. ${r1(p.week.points)}${p.week.opponent ? ` vs ${p.week.opponent}` : ""}` : "",
    p.week && p.week.availability !== "ok" ? ` [${p.week.availability}]` : "",
    p.injury && p.week?.availability === "ok" ? ` [${p.injury}]` : "",
    p.week?.locked ? " [Spiel läuft/vorbei – gesperrt]" : "",
    Math.abs(p.scoringFactor - 1) > 0.03 ? ` (Wert inkl. Scoring-Faktor ×${p.scoringFactor.toFixed(2)})` : "",
    extra,
  ];
  return parts.join("");
}

function scoringSummary(scoring: Record<string, number>): string {
  const keys = [
    "rec", "bonus_rec_te", "bonus_rec_rb", "bonus_rec_wr", "pass_td", "pass_yd", "pass_int",
    "rush_yd", "rec_yd", "rush_td", "rec_td", "fum_lost", "bonus_rec_yd_100", "bonus_rush_yd_100",
    "bonus_pass_yd_300", "pass_fd", "rush_fd", "rec_fd",
  ];
  return keys
    .filter((k) => scoring[k])
    .map((k) => `${k}=${scoring[k]}`)
    .join(", ");
}

function standings(m: LeagueModel): Team[] {
  return [...m.teams].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor,
  );
}

async function recentTransactions(m: LeagueModel, leagueId: string): Promise<string[]> {
  if (m.week === null) return [];
  const weeks = [m.week, m.week - 1, m.week - 2].filter((w) => w >= 1);
  const results = await Promise.allSettled(weeks.map((w) => getTransactions(leagueId, w)));
  const tx: Transaction[] = results.flatMap((r) => (r.status === "fulfilled" ? r.value.data : []));
  const teamName = (rid: number) => m.teams.find((t) => t.rosterId === rid)?.name ?? `Team ${rid}`;
  const pname = (id: string) => m.players[id]?.name ?? `Spieler #${id}`;
  return tx
    .filter((t) => t.status === "complete")
    .sort((a, b) => b.created - a.created)
    .slice(0, 40)
    .map((t) => {
      const date = new Date(t.created).toISOString().slice(0, 10);
      if (t.type === "trade") {
        const sides = t.roster_ids.map((rid) => {
          const got = Object.entries(t.adds ?? {}).filter(([, r]) => r === rid).map(([id]) => pname(id));
          const picks = (t.draft_picks ?? [])
            .filter((p) => p.owner_id === rid)
            .map((p) => `${p.season} R${p.round}`);
          return `${teamName(rid)} bekommt ${[...got, ...picks].join(", ") || "nichts"}`;
        });
        return `${date} TRADE: ${sides.join(" / ")}`;
      }
      const rid = t.roster_ids[0];
      const adds = Object.keys(t.adds ?? {}).map(pname).join(", ");
      const drops = Object.keys(t.drops ?? {}).map(pname).join(", ");
      const bid = t.settings?.waiver_bid ? ` (FAAB ${t.settings.waiver_bid})` : "";
      return `${date} ${t.type}: ${teamName(rid)} +${adds || "-"} −${drops || "-"}${bid}`;
    });
}

/**
 * Everything the advisor needs, as compact text. Numbers come from the
 * deterministic engine; the model is told to treat them as input, not truth.
 */
export async function buildAdvisorContext(loaded: LoadedLeague): Promise<string> {
  const { league, model: m, matchups } = loaded;
  const me = m.me;
  const val = (id: string) => m.players[id]?.value ?? 0;
  const out: string[] = [];

  out.push(`# Liga: ${league.name}`);
  out.push(
    `Format: ${TYPE[league.settings.type ?? 0] ?? "?"}, ${league.total_rosters} Teams, Saison ${league.season}` +
      (m.week !== null ? `, aktuelle Woche ${m.week}` : ", keine laufende Regular Season") +
      (league.settings.playoff_week_start ? `, Playoffs ab Woche ${league.settings.playoff_week_start}` : "") +
      (league.settings.trade_deadline ? `, Trade-Deadline Woche ${league.settings.trade_deadline}` : ""),
  );
  out.push(`Startaufstellung: ${m.slots.join(", ")}; Kaderplätze gesamt: ${league.roster_positions.length}`);
  out.push(`Scoring: ${scoringSummary(league.scoring_settings)}`);
  out.push(
    "Hinweis: Marktwerte (FantasyCalc) sind bereits an dieses Scoring angepasst (z. B. TE-Premium)" +
      (m.isDynasty ? "; Pick-Stufen früh/mittel/spät sind aus der aktuellen Kaderstärke geschätzt." : "."),
  );
  if (league.settings.waiver_type === 2) out.push(`Waiver: FAAB, Budget ${league.settings.waiver_budget ?? "?"}`);

  out.push(`\n# Tabelle`);
  const power = powerRankings(m);
  const powerRank = new Map(power.map((p, i) => [p.team.rosterId, i + 1]));
  standings(m).forEach((t, i) => {
    out.push(
      `${i + 1}. ${t.name}${t.rosterId === me.rosterId ? " (ICH)" : ""}: ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}, ` +
        `PF ${r1(t.pointsFor)}, PA ${r1(t.pointsAgainst)}, Kaderstärke-Rang ${powerRank.get(t.rosterId)}/${m.teams.length}`,
    );
  });

  out.push(`\n# Mein Kader (${me.name})`);
  const current = new Set(me.starters);
  for (const id of [...me.players].sort((a, b) => val(b) - val(a))) {
    const tag = me.reserve.includes(id) ? " {IR}" : me.taxi.includes(id) ? " {Taxi}" : current.has(id) ? " {aktuell Starter}" : "";
    out.push(`- ${playerLine(m.players[id], tag)}`);
  }

  if (me.picks.length) {
    out.push(`\n# Meine Draft-Picks`);
    for (const id of [...me.picks].sort((a, b) => val(b) - val(a))) {
      out.push(`- ${m.players[id].name}: Wert ${Math.round(val(id))}`);
    }
  }

  out.push(`\n# Positionsstärke meiner Starter (Marktwert vs. Liga-Schnitt)`);
  for (const n of positionalNeeds(m)) {
    out.push(`- ${n.position}: ${Math.round(n.delta * 100)} % (Rang ${n.rank}/${m.teams.length})`);
  }

  if (m.week !== null) {
    const la = lineupAdvice(m);
    out.push(`\n# Rechnerisch optimale Aufstellung Woche ${m.week} (nur nach Projektion)`);
    out.push(`Aktuell gesetzt: ${r1(la.currentTotal)} Pkt. projiziert, Optimum: ${r1(la.optimalTotal)}`);
    for (const o of la.optimal) out.push(`- ${o.slot}: ${o.playerId ? m.players[o.playerId].name : "LEER"} (${r1(o.points)})`);
    for (const w of la.warnings) out.push(`! ${w.slot}: ${w.playerId ? m.players[w.playerId].name : ""} ${w.reason}`);

    const mine = matchups?.find((x) => x.roster_id === me.rosterId);
    const opp = mine?.matchup_id != null
      ? m.teams.find((t) => t.rosterId === matchups!.find((x) => x.matchup_id === mine.matchup_id && x.roster_id !== me.rosterId)?.roster_id)
      : undefined;
    if (opp) {
      const oppProj = opp.starters.reduce((s, id) => s + (m.players[id]?.week?.points ?? 0), 0);
      out.push(`Gegner diese Woche: ${opp.name}, dessen gesetzte Starter projiziert ${r1(oppProj)} Pkt.`);
    }
  }

  const waivers = findWaivers(m, 10);
  out.push(`\n# Free Agents – rechnerische Kandidaten`);
  for (const w of [...waivers.restOfSeason, ...waivers.thisWeek]) {
    const p = m.players[w.add];
    out.push(
      `- ${playerLine(p)}${p.trendingAdds ? ` | trending +${p.trendingAdds}` : ""} | Drop-Vorschlag: ${w.drop ? m.players[w.drop].name : "-"}`,
    );
  }
  // A broader pool so the model can find what the formula misses (e.g. new starters after injuries).
  const byPos = new Map<string, string[]>();
  for (const id of m.freeAgents) {
    const pos = m.players[id].position;
    byPos.set(pos, [...(byPos.get(pos) ?? []), id]);
  }
  out.push(`\n# Beste Free Agents je Position (Wert / Proj. / Trending)`);
  for (const [pos, ids] of byPos) {
    const top = [...new Set([
      ...[...ids].sort((a, b) => val(b) - val(a)).slice(0, 4),
      ...[...ids].sort((a, b) => (m.players[b].week?.points ?? 0) - (m.players[a].week?.points ?? 0)).slice(0, 3),
      ...[...ids].sort((a, b) => m.players[b].trendingAdds - m.players[a].trendingAdds).slice(0, 3),
    ])];
    out.push(`${pos}: ${top.map((id) => {
      const p = m.players[id];
      return `${p.name} (${p.team}, W ${Math.round(p.value)}, P ${r1(p.week?.points ?? 0)}${p.trendingAdds ? `, +${p.trendingAdds}` : ""}${p.injury ? `, ${p.injury}` : ""})`;
    }).join("; ")}`);
  }

  out.push(`\n# Rechnerische Trade-Kandidaten (Marktwert-fair, verbessern meine Starter)`);
  for (const t of findTrades(m).slice(0, 12)) {
    out.push(
      `- mit ${t.partner.name}: gebe ${t.give.map((id) => m.players[id].name).join(" + ")} ` +
        `für ${t.get.map((id) => m.players[id].name).join(" + ")} | ich ${r1(t.myGainPct * 100)} %, Partner ${r1(t.theirGainPct * 100)} %`,
    );
  }

  out.push(`\n# Andere Teams`);
  for (const t of m.teams) {
    if (t.rosterId === me.rosterId) continue;
    const needs = positionalNeeds(m, t)
      .map((n) => `${n.position} ${n.delta > 0 ? "+" : ""}${Math.round(n.delta * 100)}%`)
      .join(", ");
    out.push(`\n## ${t.name} (Manager ${t.manager}) ${t.wins}-${t.losses}, PF ${r1(t.pointsFor)}, Kaderstärke-Rang ${powerRank.get(t.rosterId)}`);
    out.push(`Positionsstärke: ${needs}`);
    if (t.picks.length) {
      out.push(`Picks: ${[...t.picks].sort((a, b) => val(b) - val(a)).map((id) => `${m.players[id].name} (W ${Math.round(val(id))})`).join("; ")}`);
    }
    const ids = [...t.players].sort((a, b) => val(b) - val(a)).slice(0, 18);
    out.push(ids.map((id) => {
      const p = m.players[id];
      return `${p.name} (${p.position}, ${p.age ?? "?"} J., W ${Math.round(p.value)}${p.injury ? `, ${p.injury}` : ""})`;
    }).join("; "));
  }

  const tx = await recentTransactions(m, m.leagueId);
  if (tx.length) {
    out.push(`\n# Letzte Transaktionen der Liga`);
    out.push(...tx.map((l) => `- ${l}`));
  }

  return out.join("\n");
}
