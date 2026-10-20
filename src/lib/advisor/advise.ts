import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
const MAX_CONTINUATIONS = 5;

const SYSTEM = `Du bist ein erfahrener Fantasy-Football-Berater für Sleeper-Ligen. Du berätst genau einen Manager („ICH“ im Kontext) und willst, dass er Spiele und am Ende die Meisterschaft gewinnt (in Dynasty-Ligen auch langfristig).

Du bekommst:
- Rohdaten der Liga (Kader, Scoring, Tabelle, Transaktionen)
- Marktwerte (FantasyCalc, aus echten Trades) und Wochenprojektionen (Sleeper/Rotowire)
- Vorschläge einer mechanischen Rechen-Engine (optimale Aufstellung, Waiver- und Trade-Kandidaten)

So arbeitest du:
- Die Zahlen sind Input, nicht die Wahrheit. Die Engine optimiert stur auf Projektionspunkte und Marktwert. Projektionsunterschiede unter ~2 Punkten sind Rauschen – entscheide dann nach Rolle, Usage-Trend, Matchup, Spielskript, Verletzungsrisiko und Upside/Floor (Favorit vs. Außenseiter im Matchup).
- Denke wie ein Manager: Kadertiefe für Bye-Weeks und Verletzungen, Playoff-Spielplan, Contender vs. Rebuild (eigene Lage und die der Partner), Trade-Deadline, Positionsknappheit, Alterskurven in Dynasty.
- Trades: Schlage konkrete Angebote vor und begründe, warum der Partner annehmen würde (seine Schwächen, seine Lage, sein Verhalten laut Transaktionen). Nutze die Engine-Kandidaten als Startpunkt, verwirf sie, wenn sie inhaltlich keinen Sinn ergeben, und ergänze eigene Ideen – nur mit Spielern, die laut Kontext wirklich auf den Kadern stehen.
- Recherchiere per Websuche gezielt aktuelle News zu den Spielern, die für deine Empfehlungen entscheidend sind (Verletzungen, Depth Charts, Rollenwechsel, Trainerzitate). Maximal 3 Suchen – nur für die wichtigsten Entscheidungen, nicht zu jedem Spieler.
- Erfinde keine Fakten. Wenn du etwas nicht verifizieren kannst, sag es. Nenne bei News die Quelle.
- Gib bei jeder Empfehlung an, wie sicher du bist (hoch/mittel/niedrig).

Antworte auf Deutsch in Markdown, knapp und konkret – der Manager will handeln, keinen Aufsatz lesen.`;

const DEFAULT_TASK = `Erstelle meine Analyse mit genau diesen Abschnitten:
## Kurzfazit
2–3 Sätze: Wo steht mein Team, was ist diese Woche das Wichtigste?
## Aufstellung diese Woche
Nur die Entscheidungen, die zählen (Start/Sit, Wackelkandidaten, Verletzungen). Widersprich der Engine, wo sie falsch liegt.
## Waiver / Free Agents
Konkrete Adds mit Drop und ggf. FAAB-Gebot.
## Trade-Vorschläge
2–4 konkrete Angebote mit Partner, Begründung für beide Seiten und Einschätzung der Annahmewahrscheinlichkeit.
## Langfristig
Kaderbaustellen und Strategie für die nächsten Wochen.`;

export type AdviceEvent =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  /** Requests left today after this one; null = unlimited. */
  | { type: "quota"; remaining: number | null }
  | { type: "done" };

export const hasApiCredentials = () =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function* streamAdvice(context: string, question: string | null): AsyncGenerator<AdviceEvent> {
  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);
  const task = question?.trim()
    ? `Heute ist ${today}. Beantworte meine Frage auf Basis der Liga-Daten (recherchiere, wo nötig):\n\n${question.trim()}`
    : `Heute ist ${today}. ${DEFAULT_TASK}`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        // Context first + cache breakpoint: follow-up questions on the same data are cheaper.
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
        { type: "text", text: task },
      ],
    },
  ];

  const sources = new Map<string, string>();

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
    });

    // Collect the search query JSON per block so it can be shown as progress.
    const toolInput = new Map<number, string>();
    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") {
        toolInput.set(ev.index, "");
      } else if (ev.type === "content_block_delta") {
        if (ev.delta.type === "text_delta") yield { type: "text", text: ev.delta.text };
        else if (ev.delta.type === "input_json_delta" && toolInput.has(ev.index)) {
          toolInput.set(ev.index, toolInput.get(ev.index)! + ev.delta.partial_json);
        }
      } else if (ev.type === "content_block_stop" && toolInput.has(ev.index)) {
        let query = "";
        try {
          query = (JSON.parse(toolInput.get(ev.index) || "{}") as { query?: string }).query ?? "";
        } catch {
          // partial / malformed input – progress display only
        }
        yield { type: "status", text: query ? `Websuche: ${query}` : "Websuche …" };
        toolInput.delete(ev.index);
      }
    }

    const msg = await stream.finalMessage();
    for (const block of msg.content) {
      if (block.type === "text") {
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") sources.set(c.url, c.title ?? c.url);
        }
      }
    }

    if (msg.stop_reason === "refusal") {
      yield { type: "error", message: "Die Anfrage wurde vom Modell abgelehnt." };
      return;
    }
    if (msg.stop_reason === "max_tokens") {
      yield { type: "text", text: "\n\n_(Antwort wurde wegen Längenlimit abgeschnitten.)_" };
    }
    if (msg.stop_reason !== "pause_turn") break;
    // Server-side search loop paused – resend so it resumes where it left off.
    messages.push({ role: "assistant", content: msg.content });
  }

  if (sources.size) {
    const list = [...sources].map(([url, title]) => `- [${title}](${url})`).join("\n");
    yield { type: "text", text: `\n\n---\n**Quellen**\n${list}\n` };
  }
  yield { type: "done" };
}
