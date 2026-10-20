# Sleeper Analyzer

Analyse-App für Sleeper Fantasy Football (Next.js) – für dich allein oder für deine ganze Liga.

```bash
npm install
cp .env.local.example .env.local   # ANTHROPIC_API_KEY eintragen (für den KI-Berater)
npm run dev      # http://localhost:3000 → Sleeper-Username eingeben
npm test         # Unit-Tests der Analyse-Logik
```

## KI-Berater

Claude (Sonnet 5) bekommt Liga, Kader, Tabelle, Transaktionen, Projektionen, Marktwerte und die
Kandidaten der Rechen-Engine als Kontext, recherchiert per Websuche aktuelle News und gibt begründete
Empfehlungen (Aufstellung, Waiver, konkrete Trade-Angebote, Strategie). Die Zahlen der Engine sind
dabei nur Input – kleine Projektionsunterschiede werden als Rauschen behandelt. Eigene Fragen sind
möglich. Alle Analysen werden pro Liga und Manager gespeichert (Redis bzw. lokal `.cache/`). Kosten grob 0,10–0,40 $ pro Analyse.

Code: `src/lib/advisor/` (Kontext, Prompt, Streaming) und `src/app/api/advice/route.ts`.

## Für die Liga freigeben

Die Rechen-Engine ist für jeden offen. Der KI-Berater läuft über **deinen** API-Key und ist deshalb abgesichert:

- **Persönlicher Link statt Login**: Jeder Manager bekommt einen eigenen Link (`/invite?u=<userId>&t=<token>`,
  Token = HMAC der Sleeper-User-ID). Der Link setzt ein Cookie. Damit kann man den Berater nur für das
  **eigene** Team nutzen und nur die eigenen Analysen sehen, auch wenn man das Team eines anderen öffnet.
- **Liga-Whitelist**: `ALLOWED_LEAGUE_IDS`. In anderen Ligen gibt es nur die Rechen-Engine.
- **Tageslimit**: `ADVICE_DAILY_LIMIT` Anfragen (Analysen + Fragen) pro Person und Tag (Default 3,
  Reset um Mitternacht deutscher Zeit). Fehlgeschlagene Anfragen ohne Antwort zählen nicht.
  `ADVICE_ADMIN_USER_IDS` hat kein Limit.
- Ohne `INVITE_SECRET` ist der Berater lokal (`npm run dev`) für alle offen und in Produktion gesperrt.

### Setup auf Vercel

1. Projekt auf Vercel importieren.
2. Unter *Storage* bzw. im *Marketplace* **Upstash Redis** anlegen und mit dem Projekt verbinden
   (setzt `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Darin liegen Analyse-Verlauf, Tageslimits und der API-Cache.
   Ohne Redis gehen Verlauf und Limits bei jedem Deploy oder Kaltstart verloren.
3. Environment Variables setzen:

   | Variable | Wert |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | dein Key |
   | `INVITE_SECRET` | zufällig, z. B. `openssl rand -base64 32` |
   | `ALLOWED_LEAGUE_IDS` | Liga-ID(s) aus der URL `/u/<name>/<ligaId>`, kommagetrennt |
   | `ADVICE_DAILY_LIMIT` | z. B. `3` |
   | `ADVICE_ADMIN_USER_IDS` | optional, deine Sleeper-User-ID |
   | `APP_URL` | nur lokal für `npm run invite` nötig |

4. In der [Anthropic-Console](https://console.anthropic.com/) ein **monatliches Ausgabenlimit** setzen –
   die harte Obergrenze, falls doch etwas schiefgeht.
5. Links erzeugen (mit demselben `INVITE_SECRET` und `APP_URL=https://<deine-app>` in `.env.local`):

   ```bash
   npm run invite -- manager1 manager2 manager3
   ```

   Jeden Link nur an die jeweilige Person schicken, nicht in den Gruppenchat. Wer den Link hat, nutzt
   den Berater in dessen Namen. Wird `INVITE_SECRET` geändert, werden alle Links ungültig.

Die Advice-Route hat `maxDuration = 300` s (Websuche + lange Antwort). Falls dein Vercel-Plan weniger
erlaubt, brechen lange Analysen ab. Dann das Limit im Vercel-Dashboard unter *Functions* prüfen.

Code: `src/lib/access.ts` (Zugang, Limit), `src/lib/token.ts`, `src/lib/kv.ts` (Redis/Datei),
`src/app/invite/route.ts`, `scripts/invite.mts`.

## Rechen-Engine (Datengrundlage)

- **Aufstellung**: Optimale Startaufstellung für die aktuelle Woche (exakte Zuordnung inkl. FLEX/SUPER_FLEX),
  Vergleich mit deiner aktuell gesetzten Aufstellung, Warnungen bei Bye/Out/Questionable/leeren Slots,
  Projektion gegen den Gegner.
- **Stärken & Schwächen**: Marktwert deiner Starter pro Position vs. Liga-Schnitt.
- **Waiver**: langfristige Upgrades (Marktwert) und Streaming für diese Woche (Projektion), jeweils mit Drop-Vorschlag.
- **Trade-Ideen**: 1:1-, 2:1- und 1:2-Trades mit jedem Team, die deine Startaufstellung verbessern,
  für den Partner fair sind und ihn nicht spürbar schwächen.
- **Trade-Check**: beliebigen Trade bewerten (Fairness + Auswirkung auf beide Kader).
- **Power Ranking**: alle Teams nach Kaderstärke, Starter-Wert und Wochenprojektion.

## Datenquellen

| Quelle | Wofür | Cache |
| --- | --- | --- |
| Sleeper API (Liga, Kader, Matchups) | Ligadaten | 1 min |
| Sleeper Spieler-DB | Namen, Positionen, Verletzungen | 24 h (auf Disk) |
| Sleeper-Projektionen (Rotowire) | Wochenpunkte, mit **deinen** Scoring-Regeln neu berechnet | 30 min |
| FantasyCalc | Marktwerte aus echten Trades (Dynasty/Redraft, 1QB/SF, PPR passend zur Liga) | 6 h |

Fällt eine Quelle aus, arbeitet die App mit dem letzten Cache-Stand weiter und zeigt einen Hinweis an.
Der Cache liegt in Redis bzw. lokal in `.cache/` und kann jederzeit gelöscht werden. Die Spieler-DB (zu groß für Redis) liegt immer auf der Disk, auf Vercel in `/tmp`.

## Wie gerechnet wird

- **Projektionen**: mit den Scoring-Regeln der Liga; Yard-Boni (z. B. +2 ab 100 Yards) und DEF-Stufen
  (Punkte/Yards zugelassen) als Erwartungswert über eine Normalverteilung statt als Punktschätzung.
- **Gesperrte Spieler**: aus dem NFL-Spielplan (Spiel läuft/vorbei) – werden bei Start/Sit und Drops nicht bewegt.
- **Marktwerte**: FantasyCalc, pro Spieler angepasst an das Liga-Scoring (TE-Premium, 6-Punkte-Pass-TDs usw.),
  berechnet aus Saisonprojektionen im Vergleich zum Standard-Scoring.
- **Draft-Picks** (Dynasty): nächste 3 Jahre, Besitz inkl. getradeter Picks, Wert von FantasyCalc;
  früh/mittel/spät für das nächste Jahr geschätzt aus der Kaderstärke des ursprünglichen Teams.

## Bekannte Grenzen

- K/DEF haben keinen Marktwert, IDP-Spieler werden nicht bewertet.
- Die Scoring-Anpassung und die Pick-Stufen sind Heuristiken (Faktor = Punkteverhältnis^1,5, begrenzt auf 0,6–1,6).
- Keine eigene Contender/Rebuild-Logik in der Rechen-Engine – diese Abwägung übernimmt der KI-Berater.
