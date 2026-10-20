import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Nicht gefunden</h1>
      <p>Diesen Sleeper-User oder diese Liga gibt es nicht.</p>
      <Link href="/">Zurück</Link>
    </>
  );
}
