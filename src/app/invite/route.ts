import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, cookieValue } from "@/lib/access";
import { getUser } from "@/lib/sleeper";
import { verifyToken } from "@/lib/token";

export const dynamic = "force-dynamic";

/** Personal invite link (`npm run invite`): stores the access cookie and opens the user's leagues. */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("u") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!verifyToken(process.env.INVITE_SECRET ?? "", userId, token)) {
    return new NextResponse("Ungültiger oder abgelaufener Einladungslink.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Sleeper resolves /user/<id> just like /user/<username>.
  const { data: user } = await getUser(userId);
  const res = NextResponse.redirect(new URL(user ? `/u/${encodeURIComponent(user.username)}` : "/u", req.url));
  res.cookies.set(ACCESS_COOKIE, cookieValue(userId, token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return res;
}
