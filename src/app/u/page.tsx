import { redirect } from "next/navigation";

export default async function UserRedirect(props: PageProps<"/u">) {
  const { username } = await props.searchParams;
  const name = typeof username === "string" ? username.trim() : "";
  redirect(name ? `/u/${encodeURIComponent(name)}` : "/");
}
