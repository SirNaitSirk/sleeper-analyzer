import Anthropic from "@anthropic-ai/sdk";
import { advisorAccess, consumeQuota } from "@/lib/access";
import { buildAdvisorContext } from "@/lib/advisor/context";
import { hasApiCredentials, streamAdvice, type AdviceEvent } from "@/lib/advisor/advise";
import { saveAdvice } from "@/lib/advisor/store";
import { loadLeague } from "@/lib/load";
import { getUser } from "@/lib/sleeper";

export const dynamic = "force-dynamic";
// Web search + a long streamed answer can take several minutes.
export const maxDuration = 300;

function errorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Ungültiger Anthropic-API-Key.";
  if (e instanceof Anthropic.RateLimitError) return "Rate-Limit der Anthropic-API erreicht – bitte gleich nochmal versuchen.";
  if (e instanceof Anthropic.APIError) return `Anthropic-API-Fehler ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Streams the AI analysis as newline-delimited JSON events. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    leagueId?: string;
    question?: string;
  };
  const question = body.question?.trim().slice(0, 2000) || null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AdviceEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          // Client disconnected – keep going so cleanup (refund, save) still runs.
        }
      };
      try {
        if (!hasApiCredentials()) {
          send({ type: "error", message: "Kein ANTHROPIC_API_KEY gesetzt – in .env.local eintragen und den Server neu starten." });
          return;
        }
        if (!body.username || !body.leagueId) throw new Error("username und leagueId fehlen");
        const { data: user } = await getUser(body.username);
        if (!user) throw new Error("Sleeper-User nicht gefunden");

        const access = await advisorAccess(body.leagueId, user.user_id);
        if (!access.allowed) {
          send({ type: "error", message: access.reason });
          return;
        }
        const quota = await consumeQuota(user.user_id);
        if (!quota.ok) {
          send({ type: "quota", remaining: 0 });
          send({ type: "error", message: "Dein Tageslimit für den KI-Berater ist aufgebraucht – morgen geht's weiter." });
          return;
        }
        send({ type: "quota", remaining: quota.remaining });

        let markdown = "";
        try {
          send({ type: "status", text: "Lade Liga-Daten …" });
          const loaded = await loadLeague(body.leagueId, user.user_id);
          const context = await buildAdvisorContext(loaded);
          send({ type: "status", text: "Claude analysiert …" });

          for await (const ev of streamAdvice(context, question)) {
            if (ev.type === "text") markdown += ev.text;
            if (ev.type === "done" && markdown.trim()) {
              await saveAdvice(body.leagueId, user.user_id, { markdown, question, createdAt: Date.now() });
            }
            send(ev);
          }
        } finally {
          // Nothing was answered (error, refusal, aborted) – don't count it against the limit.
          if (!markdown.trim()) {
            await quota.refund();
            send({ type: "quota", remaining: quota.remaining === null ? null : quota.remaining + 1 });
          }
        }
      } catch (e) {
        console.error("[advice]", e);
        send({ type: "error", message: errorMessage(e) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
