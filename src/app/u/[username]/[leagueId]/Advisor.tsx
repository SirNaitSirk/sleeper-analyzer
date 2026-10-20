"use client";

import { useRef, useState } from "react";
import Markdown from "react-markdown";
import type { AdviceEvent } from "@/lib/advisor/advise";
import type { SavedAdvice } from "@/lib/advisor/store";

const when = (t: number) =>
  new Date(t).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Advisor({
  username,
  leagueId,
  history: initialHistory,
  remaining: initialRemaining,
}: {
  username: string;
  leagueId: string;
  history: SavedAdvice[];
  /** Requests left today; null = unlimited. */
  remaining: number | null;
}) {
  const saved = initialHistory[0] ?? null;
  const [history, setHistory] = useState(initialHistory);
  // createdAt of the analysis shown on top; null while a new one is streaming.
  const [shownAt, setShownAt] = useState<number | null>(saved?.createdAt ?? null);
  const [markdown, setMarkdown] = useState(saved?.markdown ?? "");
  const [meta, setMeta] = useState(
    saved ? `${saved.question ? `Frage: „${saved.question}“ · ` : ""}erstellt ${when(saved.createdAt)}` : "",
  );
  const [status, setStatus] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState("");
  const [remaining, setRemaining] = useState(initialRemaining);
  const exhausted = remaining !== null && remaining <= 0;
  const abort = useRef<AbortController | null>(null);

  async function run(q: string | null) {
    abort.current = new AbortController();
    setRunning(true);
    setError("");
    setStatus([]);
    setMarkdown("");
    setShownAt(null);
    setMeta(q ? `Frage: „${q}“` : "");
    let text = "";
    try {
      const res = await fetch("/api/advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, leagueId, question: q }),
        signal: abort.current.signal,
      });
      if (!res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as AdviceEvent;
          if (ev.type === "text") {
            text += ev.text;
            setMarkdown(text);
          }
          else if (ev.type === "quota") setRemaining(ev.remaining);
          else if (ev.type === "status") setStatus((s) => [...s, ev.text]);
          else if (ev.type === "error") setError(ev.message);
          else if (ev.type === "done") {
            const createdAt = Date.now();
            setMeta((m) => `${m ? m + " · " : ""}erstellt ${when(createdAt)}`);
            if (text.trim()) {
              setHistory((h) => [{ markdown: text, question: q, createdAt }, ...h]);
              setShownAt(createdAt);
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const older = history.filter((h) => h.createdAt !== shownAt);

  return (
    <div>
      <div className="inline" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => run(null)} disabled={running || exhausted}>
          {running ? "Analysiere …" : markdown ? "Neue Analyse" : "KI-Analyse starten"}
        </button>
        {running && (
          <button onClick={() => abort.current?.abort()} style={{ background: "transparent", color: "inherit" }}>
            Abbrechen
          </button>
        )}
        <span className="muted">
          Claude recherchiert aktuelle News, dauert 1–3 Minuten.
          {remaining !== null &&
            (exhausted
              ? " Tageslimit erreicht – morgen wieder verfügbar."
              : ` Heute noch ${remaining} ${remaining === 1 ? "Anfrage" : "Anfragen"}.`)}
        </span>
      </div>

      <form
        className="inline"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) run(question.trim());
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Eigene Frage, z. B. „Soll ich Puka Nacua für Bijan Robinson + Pick anbieten?“"
          style={{ flex: 1, minWidth: 260 }}
          disabled={running || exhausted}
        />
        <button type="submit" disabled={running || exhausted || !question.trim()}>
          Fragen
        </button>
      </form>

      {running && status.length > 0 && (
        <ul className="tight muted">
          {status.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {error && <div className="box alert">{error}</div>}
      {meta && !running && <p className="muted">{meta}</p>}
      {markdown && (
        <div className="box advice">
          <Markdown>{markdown}</Markdown>
        </div>
      )}

      {older.length > 0 && (
        <div className="history">
          <h3>Verlauf ({older.length})</h3>
          {older.map((h) => (
            <details key={h.createdAt}>
              <summary>
                <span className="muted">{when(h.createdAt)}</span>
                <span className="q">{h.question ? `„${h.question}“` : "Wochenanalyse"}</span>
              </summary>
              <div className="box advice">
                <Markdown>{h.markdown}</Markdown>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
