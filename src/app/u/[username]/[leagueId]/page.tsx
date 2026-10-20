import Link from "next/link";
import { notFound } from "next/navigation";
import { advisorAccess } from "@/lib/access";
import { loadAdviceHistory } from "@/lib/advisor/store";
import { lineupAdvice, positionalNeeds, powerRankings } from "@/lib/analysis";
import { loadLeague } from "@/lib/load";
import { activePlayers, assets, weeklyLineup, type LeagueModel } from "@/lib/model";
import { getUser } from "@/lib/sleeper";
import { evaluateTrade, findTrades } from "@/lib/trades";
import { findWaivers } from "@/lib/waivers";
import Advisor from "./Advisor";

const f0 = (n: number) => Math.round(n).toLocaleString("de-DE");
const f1 = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} %`;
const sign = (n: number) => (n > 0.0001 ? "good" : n < -0.0001 ? "bad" : "");
const ago = (t: number | null) => {
  if (!t) return "–";
  const min = Math.round((Date.now() - t) / 60000);
  return min < 1 ? "gerade eben" : min < 60 ? `vor ${min} min` : `vor ${Math.round(min / 60)} h`;
};
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(",")).filter(Boolean);

function P({ id, m }: { id: string | null; m: LeagueModel }) {
  if (!id) return <span className="muted">— leer —</span>;
  const p = m.players[id];
  if (!p) return <span className="muted">{id}</span>;
  if (p.position === "PICK") return <span>{p.name} <span className="muted">Pick</span></span>;
  return (
    <span>
      {p.name} <span className="muted">{p.position} {p.team ?? "FA"}</span>
      {p.injury && <span className="pill warn">{p.injury}</span>}
      {p.week?.locked && <span className="muted" title="Spiel läuft oder ist vorbei – in Sleeper gesperrt"> 🔒</span>}
    </span>
  );
}

export default async function LeaguePage(props: PageProps<"/u/[username]/[leagueId]">) {
  const { username, leagueId } = await props.params;
  const sp = await props.searchParams;
  const { data: user } = await getUser(decodeURIComponent(username));
  if (!user) notFound();

  // The saved analyses are private: only loaded for the owner of the invite link.
  const access = await advisorAccess(leagueId, user.user_id);
  const [{ model: m, matchups, sources, warnings }, adviceHistory] = await Promise.all([
    loadLeague(leagueId, user.user_id),
    access.allowed ? loadAdviceHistory(leagueId, user.user_id) : [],
  ]);
  const me = m.me;
  const lineup = m.week !== null ? lineupAdvice(m) : null;
  const needs = positionalNeeds(m);
  const power = powerRankings(m);
  const waivers = findWaivers(m);
  const trades = findTrades(m).slice(0, 15);

  // Manual trade check
  const myAssets = assets(me);
  const allRostered = new Set(m.teams.flatMap(assets));
  const give = list(sp.give).filter((id) => myAssets.includes(id));
  const get = list(sp.get).filter((id) => allRostered.has(id) && !myAssets.includes(id));
  const check = give.length && get.length ? evaluateTrade(m, give, get) : null;
  const ignoredIds = list(sp.give).length + list(sp.get).length - give.length - get.length;

  // Matchup
  const mine = matchups?.find((x) => x.roster_id === me.rosterId);
  const oppRoster = mine?.matchup_id != null
    ? matchups!.find((x) => x.matchup_id === mine.matchup_id && x.roster_id !== me.rosterId)
    : undefined;
  const opp = oppRoster ? m.teams.find((t) => t.rosterId === oppRoster.roster_id) : undefined;
  const oppSetProj = opp
    ? opp.starters.reduce((s, id) => s + (m.players[id]?.week?.points ?? 0), 0)
    : 0;

  const staleOrFailed = sources.filter((s) => s.stale || s.error);
  const val = (id: string) => m.players[id]?.value ?? 0;
  const byValue = [...me.players].sort((a, b) => val(b) - val(a));
  const rosterSpots = (ids: string[]) => ids.filter((id) => m.players[id]?.position !== "PICK").length;
  const myPicks = [...me.picks].sort((a, b) => val(b) - val(a));
  const hasScoringAdjust = Object.values(m.players).some((p) => Math.abs(p.scoringFactor - 1) > 0.03);

  return (
    <>
      <p className="muted">
        <Link href={`/u/${username}`}>← Ligen</Link>
      </p>
      <h1>{m.leagueName}</h1>
      <p className="muted">
        {me.name} · {me.wins}-{me.losses}
        {me.ties ? `-${me.ties}` : ""} · {f1(me.pointsFor)} PF · Saison {m.season}
        {m.week !== null && ` · Woche ${m.week}`} · {m.isDynasty ? "Dynasty" : "Redraft"}-Werte
      </p>

      {(warnings.length > 0 || staleOrFailed.length > 0) && (
        <div className="box alert">
          <ul className="tight">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {staleOrFailed.map((s) => (
              <li key={s.name}>
                {s.name}: {s.error ? `nicht erreichbar (${s.error})` : `Aktualisierung fehlgeschlagen, zeige Daten von ${ago(s.fetchedAt)}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav className="toc">
        <a href="#berater">KI-Berater</a>
        <a href="#aufstellung">Aufstellung</a>
        <a href="#staerken">Stärken/Schwächen</a>
        <a href="#waiver">Waiver</a>
        <a href="#trades">Trade-Ideen</a>
        <a href="#trade-check">Trade-Check</a>
        <a href="#kader">Kader</a>
        <a href="#ranking">Power Ranking</a>
      </nav>

      {/* ---------------- AI advisor ---------------- */}
      <h2 id="berater">KI-Berater</h2>
      {access.allowed ? (
        <Advisor
          username={decodeURIComponent(username)}
          leagueId={leagueId}
          history={adviceHistory}
          remaining={access.remaining}
        />
      ) : (
        <p className="muted">{access.reason}</p>
      )}

      <h2 className="muted" style={{ borderTop: "none", fontSize: 13, fontWeight: 400 }}>
        Datengrundlage (rechnerisch) – diese Zahlen bekommt auch der KI-Berater als Input.
      </h2>

      {/* ---------------- Lineup ---------------- */}
      <h2 id="aufstellung">Aufstellung Woche {m.week ?? "–"}</h2>
      {!lineup ? (
        <p className="muted">Keine Wochenprojektionen verfügbar.</p>
      ) : (
        <>
          {opp && (
            <p>
              Gegner: <b>{opp.name}</b> — projiziert: du <b>{f1(lineup.optimalTotal)}</b> (optimal) vs.{" "}
              <b>{f1(oppSetProj)}</b> (aktuell gesetzt) /{" "}
              {f1(weeklyLineup(activePlayers(opp), m).total)} (deren Optimum)
            </p>
          )}
          {lineup.moves.length === 0 && lineup.warnings.length === 0 ? (
            <p className="good">✓ Deine aktuelle Aufstellung ist optimal.</p>
          ) : (
            <div className="box">
              {lineup.moves.length > 0 && (
                <>
                  <b>
                    Änderungen: +{f1(lineup.optimalTotal - lineup.currentTotal)} Punkte projiziert (
                    {f1(lineup.currentTotal)} → {f1(lineup.optimalTotal)})
                  </b>
                  <ul className="tight">
                    {lineup.moves.map((mv) => (
                      <li key={mv.start}>
                        Starte <P id={mv.start} m={m} />
                        {mv.bench && (
                          <>
                            {" "}statt <P id={mv.bench} m={m} />
                          </>
                        )}{" "}
                        <span className="good">+{f1(mv.gain)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {lineup.warnings.length > 0 && (
                <ul className="tight">
                  {lineup.warnings.map((w, i) => (
                    <li key={i} className="warn">
                      {w.slot}: {w.playerId ? <P id={w.playerId} m={m} /> : null} {w.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Optimal</th>
                  <th>Gegner</th>
                  <th className="num">Proj.</th>
                </tr>
              </thead>
              <tbody>
                {lineup.optimal.map((o, i) => (
                  <tr key={i}>
                    <td>{o.slot}</td>
                    <td>
                      <P id={o.playerId} m={m} />
                    </td>
                    <td className="muted">{o.playerId ? m.players[o.playerId]?.week?.opponent ?? "" : ""}</td>
                    <td className="num">{f1(o.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Projektionen: Sleeper (Rotowire), mit deinen Liga-Scoring-Regeln neu berechnet, inkl. erwarteter
            Yard-Boni und DEF-Stufen. Out/IR/Bye = 0, Doubtful = 25 %.
            {lineup.lockedSlots > 0 && ` 🔒 = Spiel läuft/vorbei, bleibt gesetzt (${lineup.lockedSlots} Slot(s)).`}
          </p>
        </>
      )}

      {/* ---------------- Needs ---------------- */}
      <h2 id="staerken">Stärken & Schwächen</h2>
      <p className="muted">Marktwert deiner Starter pro Position im Vergleich zum Liga-Schnitt.</p>
      <table>
        <thead>
          <tr>
            <th>Pos.</th>
            <th className="num">Deine Starter</th>
            <th className="num">Liga-Ø</th>
            <th className="num">Abweichung</th>
            <th className="num">Rang</th>
          </tr>
        </thead>
        <tbody>
          {needs.map((n) => (
            <tr key={n.position}>
              <td>{n.position}</td>
              <td className="num">{f0(n.mine)}</td>
              <td className="num">{f0(n.leagueAvg)}</td>
              <td className={`num ${sign(n.delta)}`}>{pct(n.delta)}</td>
              <td className="num">
                {n.rank}/{m.teams.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------- Waivers ---------------- */}
      <h2 id="waiver">Waiver / Free Agents</h2>
      <h3>Langfristige Upgrades</h3>
      {waivers.restOfSeason.length === 0 ? (
        <p className="muted">Kein Free Agent ist wertvoller als dein schwächster Bankspieler.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Holen</th>
                <th>Dafür droppen</th>
                <th className="num">Wert +/-</th>
                <th className="num">Kaderstärke</th>
                <th className="num">Trending</th>
              </tr>
            </thead>
            <tbody>
              {waivers.restOfSeason.map((w) => (
                <tr key={w.add}>
                  <td>
                    <P id={w.add} m={m} />
                  </td>
                  <td>
                    <P id={w.drop} m={m} />
                  </td>
                  <td className={`num ${sign(w.valueGain)}`}>{f0(w.valueGain)}</td>
                  <td className={`num ${sign(w.rosGain)}`}>{f0(w.rosGain)}</td>
                  <td className="num">{m.players[w.add].trendingAdds ? f0(m.players[w.add].trendingAdds) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Diese Woche (Streaming / Bye-Ersatz)</h3>
      {m.week === null ? (
        <p className="muted">Keine Wochenprojektionen verfügbar.</p>
      ) : waivers.thisWeek.length === 0 ? (
        <p className="muted">Kein Free Agent verbessert deine Aufstellung diese Woche um ≥ 1 Punkt.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Holen</th>
                <th>Dafür droppen</th>
                <th className="num">Proj.</th>
                <th className="num">Aufstellung +</th>
              </tr>
            </thead>
            <tbody>
              {waivers.thisWeek.map((w) => (
                <tr key={w.add}>
                  <td>
                    <P id={w.add} m={m} />
                  </td>
                  <td>
                    <P id={w.drop} m={m} />
                  </td>
                  <td className="num">{f1(m.players[w.add].week?.points ?? 0)}</td>
                  <td className="num good">+{f1(w.weekGain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- Trade ideas ---------------- */}
      <h2 id="trades">Trade-Ideen</h2>
      <p className="muted">
        Trades, die deine Startaufstellung (nach Marktwert) verbessern, für den Partner nach Marktwert fair
        sind und dessen Team nicht spürbar schwächen. „Win-win“ = beide Teams werden stärker – die haben die
        besten Chancen, angenommen zu werden.
      </p>
      {trades.length === 0 ? (
        <p className="muted">Keine passenden Trades gefunden.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Du gibst</th>
                <th>Du bekommst</th>
                <th className="num">Wert</th>
                <th className="num">Du</th>
                <th className="num">Partner</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i}>
                  <td>{t.partner.name}</td>
                  <td>
                    {t.give.map((id) => (
                      <div key={id}>
                        <P id={id} m={m} /> <span className="muted">({f0(val(id))})</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {t.get.map((id) => (
                      <div key={id}>
                        <P id={id} m={m} /> <span className="muted">({f0(val(id))})</span>
                      </div>
                    ))}
                  </td>
                  <td className="num" title="angepasster Wert Geben / Bekommen">
                    {t.valueRatio > 1.02 ? <span className="warn">du zahlst {pct(t.valueRatio - 1)}</span> : "fair"}
                  </td>
                  <td className="num good">{pct(t.myGainPct)}</td>
                  <td className={`num ${sign(t.theirGainPct)}`}>{pct(t.theirGainPct)}</td>
                  <td>
                    {t.theirGainPct >= 0.001 && <span className="pill good">win-win</span>}{" "}
                    {rosterSpots(t.get) > rosterSpots(t.give) && <span className="muted">du brauchst 1 Kaderplatz · </span>}
                    {rosterSpots(t.give) > rosterSpots(t.get) && <span className="muted">Partner braucht 1 Kaderplatz · </span>}
                    <Link href={`?give=${t.give.join(",")}&get=${t.get.join(",")}#trade-check`}>prüfen</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- Trade check ---------------- */}
      <h2 id="trade-check">Trade-Check</h2>
      {ignoredIds > 0 && (
        <p className="warn">
          {ignoredIds} Spieler ignoriert (nicht mehr im Kader – vermutlich wurde inzwischen getradet/gedroppt).
        </p>
      )}
      {check && (
        <div className="box">
          <p>
            Du gibst <b>{give.map((id) => m.players[id].name).join(" + ")}</b> für{" "}
            <b>{get.map((id) => m.players[id].name).join(" + ")}</b>
          </p>
          <ul className="tight">
            <li>
              Angepasster Marktwert: {f0(check.giveValue)} gegeben vs. {f0(check.getValue)} bekommen —{" "}
              {check.valueRatio > 1.05 ? (
                <span className="bad">du zahlst {pct(check.valueRatio - 1)} drauf</span>
              ) : check.valueRatio < 0.95 ? (
                <span className="good">du gewinnst {pct(1 / check.valueRatio - 1)} Wert</span>
              ) : (
                "fair"
              )}
            </li>
            <li>
              Deine Kaderstärke: <span className={sign(check.myGain)}>{pct(check.myGainPct)}</span>
            </li>
            {check.partners.map((p) => (
              <li key={p.team.rosterId}>
                {p.team.name}: <span className={sign(p.gain)}>{pct(p.gainPct)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form className="inline" action="#trade-check">
        <label>
          Du gibst
          <br />
          <select name="give" multiple defaultValue={give}>
            {[...byValue, ...myPicks].map((id) => (
              <option key={id} value={id}>
                {m.players[id].name} ({m.players[id].position}, {f0(val(id))})
              </option>
            ))}
          </select>
        </label>
        <label>
          Du bekommst
          <br />
          <select name="get" multiple defaultValue={get}>
            {m.teams
              .filter((t) => t.rosterId !== me.rosterId)
              .map((t) => (
                <optgroup key={t.rosterId} label={t.name}>
                  {assets(t)
                    .sort((a, b) => val(b) - val(a))
                    .map((id) => (
                      <option key={id} value={id}>
                        {m.players[id].name} ({m.players[id].position}, {f0(val(id))})
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </label>
        <button type="submit">Bewerten</button>
      </form>
      <p className="muted">Mehrfachauswahl mit ⌘/Strg-Klick.</p>

      {/* ---------------- Roster ---------------- */}
      <h2 id="kader">Mein Kader</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Spieler</th>
              <th className="num">Alter</th>
              <th className="num">Marktwert</th>
              <th className="num">Trend 30T</th>
              <th className="num">Proj. Wo.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {byValue.map((id) => {
              const p = m.players[id];
              return (
                <tr key={id}>
                  <td>
                    <P id={id} m={m} />
                  </td>
                  <td className="num">{p.age ?? ""}</td>
                  <td className="num" title={p.scoringFactor !== 1 ? `FantasyCalc ${f0(p.rawValue)} × ${p.scoringFactor.toFixed(2)} (dein Scoring)` : undefined}>
                    {f0(p.value)}
                    {Math.abs(p.scoringFactor - 1) > 0.03 && (
                      <span className={`muted ${sign(p.scoringFactor - 1)}`}> ×{p.scoringFactor.toFixed(2)}</span>
                    )}
                  </td>
                  <td className={`num ${sign(p.trend30)}`}>{p.trend30 ? f0(p.trend30) : ""}</td>
                  <td className="num">{p.week ? f1(p.week.points) : ""}</td>
                  <td className="muted">
                    {me.reserve.includes(id) ? "IR" : me.taxi.includes(id) ? "Taxi" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {myPicks.length > 0 && (
        <>
          <h3>Meine Draft-Picks</h3>
          <table>
            <tbody>
              {myPicks.map((id) => (
                <tr key={id}>
                  <td>{m.players[id].name}</td>
                  <td className="num">{f0(val(id))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted">
        {hasScoringAdjust &&
          "Marktwert = FantasyCalc-Wert, angepasst an dein Scoring (×Faktor, z. B. TE-Premium). "}
        {m.isDynasty && "Pick-Werte: FantasyCalc; „früh/mittel/spät“ geschätzt aus der aktuellen Kaderstärke des ursprünglichen Teams. "}
        Trend = Veränderung des Marktwerts in 30 Tagen. Stark steigende Bankspieler sind Verkaufskandidaten
        („sell high“), stark fallende Starter eher halten, statt billig abzugeben.
      </p>

      {/* ---------------- Power ranking ---------------- */}
      <h2 id="ranking">Power Ranking</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>Bilanz</th>
              <th className="num">PF</th>
              <th className="num">Kaderstärke</th>
              <th className="num">Starter-Wert</th>
              <th className="num">Gesamtwert</th>
              <th className="num">Proj. Woche</th>
            </tr>
          </thead>
          <tbody>
            {power.map((r, i) => (
              <tr key={r.team.rosterId} className={r.team.rosterId === me.rosterId ? "me" : ""}>
                <td>{i + 1}</td>
                <td>{r.team.name}</td>
                <td>
                  {r.team.wins}-{r.team.losses}
                  {r.team.ties ? `-${r.team.ties}` : ""}
                </td>
                <td className="num">{f1(r.team.pointsFor)}</td>
                <td className="num">{f0(r.strength)}</td>
                <td className="num">{f0(r.starterValue)}</td>
                <td className="num">{f0(r.totalValue)}</td>
                <td className="num">{r.weekProjection === null ? "–" : f1(r.weekProjection)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details>
        <summary className="muted">Datenquellen</summary>
        <ul className="tight">
          {sources.map((s) => (
            <li key={s.name} className={s.error ? "bad" : s.stale ? "warn" : ""}>
              {s.name}: {s.error ? `Fehler – ${s.error}` : `${ago(s.fetchedAt)}${s.stale ? " (veraltet)" : ""}`}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
