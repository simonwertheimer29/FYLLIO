// app/no-shows/page.tsx
// Server Component — lee JWT, extrae sesión, renderiza Shell

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { NoShowsUserSession } from "../lib/no-shows/types";
import NoShowsShell from "../components/no-shows/NoShowsShell";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch {
    return null;
  }
}

export default async function NoShowsPage() {
  const user = await getSession();
  if (!user) {
    redirect("/no-shows/login");
  }

  return <NoShowsShell user={user} />;
}
