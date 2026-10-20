export default function Home() {
  return (
    <>
      <h1>Sleeper Analyzer</h1>
      <p className="muted">
        Analysiert deinen Kader und deine Liga: optimale Aufstellung, Waiver-Pickups und
        Trade-Vorschläge.
      </p>
      <form action="/u" className="inline">
        <label>
          Sleeper-Username
          <br />
          <input name="username" required autoFocus autoComplete="username" />
        </label>
        <button type="submit">Ligen laden</button>
      </form>
    </>
  );
}
