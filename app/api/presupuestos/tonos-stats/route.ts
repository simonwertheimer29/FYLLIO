// app/api/presupuestos/tonos-stats/route.ts
// GET ?clinica=X&tratamiento=Y
// Devuelve stats de conversión por tono IA para el A/B analysis.
// Lógica: contactos con MensajeIAUsado=true → presupuesto → ACEPTADO/no

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { UserSession } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

export interface TonoStat {
  contactados: number;
  aceptados: number;
  tasa: number | null; // null si < MIN_CONTACTS
}

export type TonosStats = Record<"directo" | "empatico" | "urgencia", TonoStat>;

const DEMO_STATS: TonosStats = {
  directo:  { contactados: 28, aceptados: 8,  tasa: 29 },
  empatico: { contactados: 31, aceptados: 13, tasa: 42 },
  urgencia: { contactados: 24, aceptados: 6,  tasa: 25 },
};

const MIN_CONTACTS = 10;
const TONOS = ["directo", "empatico", "urgencia"] as const;

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch { return null; }
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ stats: DEMO_STATS, isDemo: true });
  }

  const { searchParams } = new URL(req.url);
  const clinicaFilter = searchParams.get("clinica") ?? "";
  const tratFilter = searchParams.get("tratamiento") ?? "";

  try {
    // 1. Fetch contacts with IA message used (max 2000)
    const contactRecs = await base(TABLES.contactosPresupuesto as any)
      .select({
        filterByFormula: `AND({MensajeIAUsado}=TRUE(), NOT({TonoUsado}=''))`,
        fields: ["PresupuestoId", "TonoUsado"],
        maxRecords: 2000,
      })
      .all();

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
      const recs = await base(TABLES.presupuestos as any)
        .select({
          filterByFormula: formula,
          fields: ["Estado", "Clinica", "Tratamiento_nombre"],
          maxRecords: BATCH,
        })
        .all();
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
  } catch {
    return NextResponse.json({ stats: DEMO_STATS, isDemo: true });
  }
}
