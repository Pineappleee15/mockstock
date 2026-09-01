import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Cheap edge gate: redirects anonymous requests away from app pages so people
 * do not land on a flash of empty UI.
 *
 * This is NOT the authorisation boundary. It verifies the cookie signature but
 * cannot check session_version or the disabled flag without a DB round trip,
 * so every page and every server action re-checks properly via currentActor().
 */
const PUBLIC = ["/login", "/admin/login", "/results", "/_next", "/favicon.ico"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // API routes do their own auth and must return JSON errors, not redirects.
  // /api/export is the exception: it is an admin-only download.
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/export")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("mockstock_session")?.value;
  let payload: { kind?: string } | null = null;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
      payload = (await jwtVerify(token, secret)).payload as { kind?: string };
    } catch {
      payload = null;
    }
  }

  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/export");

  if (!payload) {
    return NextResponse.redirect(new URL(isAdminArea ? "/admin/login" : "/login", req.url));
  }
  if (isAdminArea && payload.kind !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  if (!isAdminArea && payload.kind === "admin" && pathname !== "/") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
