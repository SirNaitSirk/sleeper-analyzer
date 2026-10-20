import Link from "next/link";
import { notFound } from "next/navigation";
import { getNflState, getUser, getUserLeagues } from "@/lib/sleeper";

const TYPE = ["Redraft", "Keeper", "Dynasty"];

export default async function Leagues(props: PageProps<"/u/[username]">) {
  const { username } = await props.params;
  const [{ data: user }, { data: state }] = await Promise.all([
    getUser(decodeURIComponent(username)),
    getNflState(),
  ]);
  if (!user) notFound();

  const season = state.league_season || state.season;
  const { data: leagues } = await getUserLeagues(user.user_id, season);

  return (
    <>
      <h1>{user.display_name}</h1>
      <p className="muted">
        Saison {season} · Woche {state.display_week}
      </p>
      {leagues.length === 0 ? (
        <p>Keine Ligen in der Saison {season} gefunden.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Liga</th>
              <th>Typ</th>
              <th className="num">Teams</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {leagues.map((l) => (
              <tr key={l.league_id}>
                <td>
                  <Link href={`/u/${username}/${l.league_id}`}>{l.name}</Link>
                </td>
                <td>{TYPE[l.settings.type ?? 0] ?? "?"}</td>
                <td className="num">{l.total_rosters}</td>
                <td>{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
