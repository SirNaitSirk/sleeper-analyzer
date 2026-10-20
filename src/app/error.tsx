"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <h1>Fehler beim Laden</h1>
      <div className="box alert">
        <p>{error.message || "Unbekannter Fehler"}</p>
        <p className="muted">
          Meist ist eine der APIs (Sleeper / FantasyCalc) kurz nicht erreichbar. Einfach nochmal
          versuchen.
        </p>
      </div>
      <button onClick={reset}>Nochmal versuchen</button>
    </>
  );
}
