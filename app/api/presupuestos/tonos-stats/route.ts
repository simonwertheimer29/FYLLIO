// app/api/presupuestos/tonos-stats/route.ts
// GET ?clinica=X&tratamiento=Y
// Devuelve stats de conversión por tono IA para el A/B analysis.
// Lógica: contactos con MensajeIAUsado=true → presupuesto → ACEPTADO/no

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../../lib/presupuestos/repo";
import { listContactosConTonoRaw } from "../../../lib/presupuestos/contactos";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas, permiteClinica } from "../../../lib/presupuestos/clinica-scope";

export interface TonoStat {
  contactados: number;
  aceptados: number;
  tasa: number | null; // null si < MIN_CONTACTS
}

export type TonosStats = Record<"directo" | "empatico" | "urgencia", TonoStat>;

// (DEMO_STATS retirado: no se inventan estadísticas de tono.)


const MIN_CONTACTS = 10;
const TONOS = ["directo", "empatico", "urgencia"] as const;

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  // (Aquí había una puerta a datos DEMO condicionada a AIRTABLE_API_KEY /
  // AIRTABLE_BASE_ID. Airtable está retirado y esas variables no existen en
  // Vercel, así que la condición se cumplía SIEMPRE en producción: la ruta no
  // llegaba nunca a su código real. Eliminada, no re-condicionada — si no se
  // pueden servir datos reales, se devuelve un error honesto, jamás inventados.
  // §4 y §1, 2026-07-29.)

  const { searchParams } = new URL(req.url);
  const clinicaFilter = searchParams.get("clinica") ?? "";
  const tratFilter = searchParams.get("tratamiento") ?? "";
  // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión (null = admin).
  const permitidas = await nombresClinicasPermitidas(session);

  try {
    // 1. Fetch contacts with IA message used (max 2000)
    const contactRecs = await listContactosConTonoRaw();

    if (!contactRecs.length) {
      return NextResponse.json({ stats: null, insuficiente: true });
    }

    // 2. Group by presupuestoId → set of tonos used
    const tonosByPres = new Map<string, Set<string>>();
    for (const rec of contactRecs) {
      const f = rec.fields as any;
      const pid = String(f["PresupuestoId"] ?? "");
      const tono = String(f["TonoUsado"] ?? "");
      if (!pid || !tono) continue;
      if (!tonosByPres.has(pid)) tonosByPres.set(pid, new Set());
      tonosByPres.get(pid)!.add(tono);
    }

    const presIds = Array.from(tonosByPres.keys());

    // 3. Fetch those presupuestos in batches of 50
    const presMap = new Map<string, { estado: string; clinica: string; tratamiento: string }>();
    const BATCH = 50;

    for (let i = 0; i < presIds.length; i += BATCH) {
      const batch = presIds.slice(i, i + BATCH);
      const formula = `OR(${batch.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const recs = await selectPresupuestosRaw({
          filterByFormula: formula,
          fields: ["Estado", "Clinica", "Tratamiento_nombre"],
          maxRecords: BATCH,
        });
      for (const rec of recs) {
        const f = rec.fields as any;
        presMap.set(rec.id, {
          estado: String(f["Estado"] ?? ""),
          clinica: String(f["Clinica"] ?? ""),
          tratamiento: String(f["Tratamiento_nombre"] ?? ""),
        });
      }
    }

    // 4. Compute per-tono stats
    const counts: Record<string, { contactados: number; aceptados: number }> = {
      directo:  { contactados: 0, aceptados: 0 },
      empatico: { contactados: 0, aceptados: 0 },
      urgencia: { contactados: 0, aceptados: 0 },
    };

    for (const [presId, tonos] of tonosByPres) {
      const pres = presMap.get(presId);
      if (!pres) continue;
      if (permitidas && !permiteClinica(permitidas, pres.clinica ?? "")) continue;
      if (clinicaFilter && pres.clinica !== clinicaFilter) continue;
      if (tratFilter && !pres.tratamiento.toLowerCase().includes(tratFilter.toLowerCase())) continue;

      for (const tono of tonos) {
        if (!counts[tono]) continue;
        counts[tono].contactados++;
        if (pres.estado === "ACEPTADO") counts[tono].aceptados++;
      }
    }

    // 5. Build response
    const stats: TonosStats = {} as TonosStats;
    for (const tono of TONOS) {
      const { contactados, aceptados } = counts[tono];
      stats[tono] = {
        contactados,
        aceptados,
        tasa: contactados >= MIN_CONTACTS ? Math.round((aceptados / contactados) * 100) : null,
      };
    }

    return NextResponse.json({ stats });
  } catch (err) {
    // Devolvía estadísticas DEMO inventadas: números de tono con cara de reales
    // sobre los que se decide qué se le escribe a un paciente.
    console.error("[tonos-stats]", err);
    return NextResponse.json({ error: "No se pudieron calcular las estadísticas" }, { status: 500 });
  }
});
