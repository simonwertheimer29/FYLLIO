// app/api/presupuestos/kpi-hoy/route.ts
//
// Sprint 10 C — KPI tiempo medio de respuesta para sub-tab Presupuestos.
// Lee Mensajes_WhatsApp del día (que ya tiene Direccion Entrante/Saliente
// y vínculo a Presupuesto), empareja cada entrante con el siguiente
// saliente del mismo presupuesto. Promedio en minutos.

import { NextResponse } from "next/server";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

export const dynamic = "force-dynamic";

export const GET = withPresupuestosAuth(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const formula = `IS_AFTER({Timestamp}, '${today}T00:00:00.000Z')`;

  try {
    const recs = await fetchAll(
      base(TABLES.mensajesWhatsApp as any).select({ filterByFormula: formula }),
    );

    const porPresup = new Map<
      string,
      Array<{ direccion: "Entrante" | "Saliente"; ts: string }>
    >();
    for (const r of recs) {
      const f = r.fields as any;
      const presup = f.Presupuesto ? String(f.Presupuesto) : null;
      if (!presup) continue;
      const direccion = String(f.Direccion ?? "Entrante") as "Entrante" | "Saliente";
      const ts = String(f.Timestamp ?? "");
      if (!ts) continue;
      if (!porPresup.has(presup)) porPresup.set(presup, []);
      porPresup.get(presup)!.push({ direccion, ts });
    }

    const diffs: number[] = [];
    for (const list of porPresup.values()) {
      list.sort((a, b) => a.ts.localeCompare(b.ts));
      let i = 0;
      while (i < list.length) {
        const a = list[i]!;
        if (a.direccion === "Entrante") {
          const next = list.slice(i + 1).find((x) => x.direccion === "Saliente");
          if (next) {
            const dt =
              (new Date(next.ts).getTime() - new Date(a.ts).getTime()) / (1000 * 60);
            if (dt >= 0) diffs.push(dt);
          }
        }
        i++;
      }
    }

    const tiempoMedioMin =
      diffs.length === 0
        ? null
        : Math.round(diffs.reduce((s, n) => s + n, 0) / diffs.length);

    return NextResponse.json({ tiempoMedioMin, totalMensajes: recs.length });
  } catch (err) {
    console.error("[presupuestos/kpi-hoy]", err instanceof Error ? err.message : err);
    return NextResponse.json({ tiempoMedioMin: null, totalMensajes: 0 });
  }
});
