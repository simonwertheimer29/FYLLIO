// app/api/notificaciones/route.ts
// GET — lista últimas 50 notificaciones del usuario
// PATCH — marcar como leídas

import { selectNotificacionesRaw, updateNotificacionesBatchRaw } from "../../lib/presupuestos/notificaciones";
import { NextResponse } from "next/server";
import { base, TABLES } from "../../lib/airtable";
import type { Notificacion } from "../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

// Sprint B — migrado a withPresupuestosAuth: fija el contexto de cliente
// (runWithCliente) para que base() resuelva la base correcta. Antes leía la
// cookie inline y llamaba base() sin contexto → 500 con el fail-closed.
export const dynamic = "force-dynamic";

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

export const GET = withPresupuestosAuth(async (session) => {
  try {
    const email = session.email;
    const filterByFormula = `OR({Usuario}='todos', {Usuario}='${email}')`;

    const recs = await selectNotificacionesRaw({
      fields: ["Usuario", "Tipo", "Titulo", "Mensaje", "Link", "Leida", "Fecha_creacion"],
      filterByFormula,
      sort: [{ field: "Fecha_creacion", direction: "desc" }],
      maxRecords: 50,
    });

    const notificaciones = recs.map(recordToNotificacion);
    const noLeidas = notificaciones.filter((n) => !n.leida).length;

    return NextResponse.json({ notificaciones, noLeidas });
  } catch (err) {
    console.error("[notificaciones] GET error:", err);
    return NextResponse.json({ notificaciones: [], noLeidas: 0 });
  }
});

export const PATCH = withPresupuestosAuth(async (session, req) => {
  try {
    const body = await req.json();
    const { ids, all } = body as { ids?: string[]; all?: boolean };

    let idsToUpdate: string[] = [];

    if (all) {
      const email = session.email;
      const filterByFormula = `AND(OR({Usuario}='todos', {Usuario}='${email}'), {Leida}=FALSE())`;
      const recs = await selectNotificacionesRaw({
        fields: ["Leida"],
        filterByFormula,
        maxRecords: 200,
      });
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
      await updateNotificacionesBatchRaw(batch);
      if (i + 10 < idsToUpdate.length) await sleep(150);
    }

    return NextResponse.json({ ok: true, updated: idsToUpdate.length });
  } catch (err) {
    console.error("[notificaciones] PATCH error:", err);
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
  }
});
