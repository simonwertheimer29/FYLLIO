// app/api/notificaciones/route.ts
// GET — lista últimas 50 notificaciones del usuario
// PATCH — marcar como leídas

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../lib/airtable";
import type { UserSession, Notificacion } from "../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

function recordToNotificacion(r: any): Notificacion {
  const f = r.fields as any;
  return {
    id: r.id,
    usuario: String(f["Usuario"] ?? "todos"),
    tipo: f["Tipo"] ?? "Sistema",
    titulo: String(f["Titulo"] ?? ""),
    mensaje: String(f["Mensaje"] ?? ""),
    link: String(f["Link"] ?? "/presupuestos"),
    leida: f["Leida"] === true,
    fechaCreacion: String(f["Fecha_creacion"] ?? ""),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const email = session.email;
    const filterByFormula = `OR({Usuario}='todos', {Usuario}='${email}')`;

    const recs = await base(TABLES.notificaciones as any)
      .select({
        fields: ["Usuario", "Tipo", "Titulo", "Mensaje", "Link", "Leida", "Fecha_creacion"],
        filterByFormula,
        sort: [{ field: "Fecha_creacion", direction: "desc" }],
        maxRecords: 50,
      })
      .all();

    const notificaciones = recs.map(recordToNotificacion);
    const noLeidas = notificaciones.filter((n) => !n.leida).length;

    return NextResponse.json({ notificaciones, noLeidas });
  } catch (err) {
    console.error("[notificaciones] GET error:", err);
    return NextResponse.json({ notificaciones: [], noLeidas: 0 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const { ids, all } = body as { ids?: string[]; all?: boolean };

    let idsToUpdate: string[] = [];

    if (all) {
      const email = session.email;
      const filterByFormula = `AND(OR({Usuario}='todos', {Usuario}='${email}'), {Leida}=FALSE())`;
      const recs = await base(TABLES.notificaciones as any)
        .select({
          fields: ["Leida"],
          filterByFormula,
          maxRecords: 200,
        })
        .all();
      idsToUpdate = recs.map((r: any) => r.id);
    } else if (ids && ids.length > 0) {
      idsToUpdate = ids;
    }

    // Batch update in groups of 10
    for (let i = 0; i < idsToUpdate.length; i += 10) {
      const batch = idsToUpdate.slice(i, i + 10).map((id) => ({
        id,
        fields: { Leida: true },
      }));
      await base(TABLES.notificaciones as any).update(batch as any);
      if (i + 10 < idsToUpdate.length) await sleep(150);
    }

    return NextResponse.json({ ok: true, updated: idsToUpdate.length });
  } catch (err) {
    console.error("[notificaciones] PATCH error:", err);
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
}
