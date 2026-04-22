// app/api/admin/ping/route.ts
// Health check para la protección withAdmin. Útil para smoke tests.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async (session) => {
  return NextResponse.json({
    ok: true,
    rol: session.rol,
    userId: session.userId,
  });
});
