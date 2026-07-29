// app/api/presupuestos/kpi-hoy/route.ts
//
// Sprint 10 C — KPI tiempo medio de respuesta para sub-tab Presupuestos.
// Lee Mensajes_WhatsApp del día (que ya tiene Direccion Entrante/Saliente
// y vínculo a Presupuesto), empareja cada entrante con el siguiente
// saliente del mismo presupuesto. Promedio en minutos.

import { selectMensajesWhatsAppRaw } from "../../../lib/presupuestos/mensajeria";
import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { hoyISO, inicioDelDiaUTC } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = withPresupuestosAuth(async () => {
  // "Hoy" es el día de la clínica y empieza a sus 00:00, no a las de UTC.
  const desde = inicioDelDiaUTC(hoyISO()).toISOString();
  const formula = `IS_AFTER({Timestamp}, '${desde}')`;

  try {
    const recs = await selectMensajesWhatsAppRaw({ filterByFormula: formula });

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
    return NextResponse.json({ error: "No se pudo calcular el KPI de hoy" }, { status: 500 });
  }
});
