// app/api/kpis/no-shows/route.ts
//
// Sprint 18 Bloque 18.6 — KPIs de no-shows para el tab "No-shows" del
// dashboard /kpis.
//
// AUTH: usa la sesión principal authed (withAuth → cookie fyllio_session),
// NO el JWT fyllio_noshows_token (ese es de otro dominio). El scope de
// clínicas accesibles sale de la sesión global.
//
// Estructura del payload:
//   periodo: "mes"
//   scope: { esGlobal, clinicaId? }
//   tasaMes:        tasa no-show del mes actual + delta vs mes anterior
//   costeOportunidad: € estimados perdidos por no-shows del mes
//   topPacientes:   top 5 pacientes con más no-shows (ventana ~12 meses)
//   comparativaClinicas: tasa no-show por clínica (mes actual)
//   precisionPredictor?: si Supabase está configurado, % de aciertos del
//                        loop cerrado (factores_no_show.prediccion_correcta)
//
// La detección de no-show sigue la misma lógica que /api/no-shows/kpis y
// /api/no-shows/riesgo: Estado ∈ {NO_SHOW,NO SHOW,NOSHOW} OR (Estado
// cancelado AND Notas incluye "[NO_SHOW]").

import { NextResponse } from "next/server";
import { listCitasDesdeRaw } from "../../../lib/scheduler/repo/airtableRepo";
import { listStaffCamposRaw } from "../../../lib/scheduler/repo/staffRepo";
import { DateTime } from "luxon";
import { withAuth } from "../../../lib/auth/session";
import { listClinicas } from "../../../lib/auth/users";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
} from "../../../lib/supabase/client";

export const dynamic = "force-dynamic";

const ZONE = "Europe/Madrid";

const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);

// Ticket medio para coste de oportunidad — alineado con AVG_TICKET de
// /api/no-shows/kpis y /api/no-shows/riesgo.
const AVG_TICKET = 85;

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function toMadridIso(raw: unknown): string {
  if (!raw) return "";
  const iso = raw instanceof Date ? raw.toISOString() : String(raw);
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") : "";
}

type ApptRecord = {
  dayIso: string;
  isNoShow: boolean;
  clinicaId: string;
  clinicaNombre: string;
  pacienteKey: string; // teléfono (estable) o nombre como fallback
  pacienteNombre: string;
};

export const GET = withAuth(async (session, req) => {
  try {
    const url = new URL(req.url);
    const clinicaQuery = url.searchParams.get("clinica");

    // ── Scope de clínicas accesibles desde la sesión global ──────────
    const esAdmin = session.rol === "admin";
    const accesibles = esAdmin ? null : session.clinicasAccesibles;
    // Drilldown / filtro a una clínica concreta (si está permitida).
    const restrictedToOne =
      clinicaQuery &&
      (esAdmin || (accesibles ?? []).includes(clinicaQuery))
        ? clinicaQuery
        : null;
    const scopeIds: string[] | null = restrictedToOne
      ? [restrictedToOne]
      : esAdmin
        ? null // null = todas
        : accesibles ?? [];

    // ── Ventanas temporales (zona Madrid) ────────────────────────────
    const now = DateTime.now().setZone(ZONE);
    const todayIso = now.toISODate()!;
    const inicioMesIso = now.startOf("month").toISODate()!;
    const inicioMesAntIso = now.minus({ months: 1 }).startOf("month").toISODate()!;
    const finMesAntIso = now.startOf("month").toISODate()!; // exclusivo
    // Ventana amplia para el ranking de pacientes (12 meses).
    const desdeRankingIso = now.minus({ months: 12 }).startOf("month").toISODate()!;

    // ── Clínicas (nombres + mapa record→canónico) ────────────────────
    const [clinicasGlobal, clinicaRecs, staffRecs, allRecs] = await Promise.all([
      listClinicas({ onlyActivas: true }),
      base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all(),
      listStaffCamposRaw(["Staff ID", "Nombre", "Clínica"]),
      listCitasDesdeRaw(desdeRankingIso),
    ]);

    const clinicaNombrePorId = new Map<string, string>();
    for (const c of clinicasGlobal) clinicaNombrePorId.set(c.id, c.nombre);

    // record ID → canónico ("Clínica ID") y record ID → nombre
    const clinicaRecordToId = new Map<string, string>(
      (clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica ID"])]),
    );
    const clinicaByRecordId = new Map<string, string>(
      (clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Nombre"])]),
    );
    // Staff record ID → Clínica record ID (linked en Staff)
    const staffToClinicaRec = new Map<string, string>(
      (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica"])]),
    );

    // ── Normalizar citas ─────────────────────────────────────────────
    const records: ApptRecord[] = [];
    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);
      // Sólo citas pasadas o de hoy: las futuras aún no son no-show.
      if (dayIso > todayIso) continue;

      // Resolver clínica vía linked records (fuente de verdad):
      // Cita.Profesional → Staff → Staff.Clínica → canónico.
      const profRecId = firstString(f["Profesional"]);
      const clinicaRecId = profRecId ? staffToClinicaRec.get(profRecId) ?? "" : "";
      const clinicaId =
        (clinicaRecId ? clinicaRecordToId.get(clinicaRecId) : null) ||
        firstString(f["Clínica_id"]) ||
        "";

      const clinicaNombre =
        (clinicaRecId ? clinicaByRecordId.get(clinicaRecId) : null) ||
        clinicaNombrePorId.get(clinicaId) ||
        clinicaId ||
        "Sin clínica";

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const notas = firstString(f["Notas"]);
      const isNoShow =
        NO_SHOW_SET.has(estado) ||
        (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));

      const pacienteNombre = firstString(f["Paciente_nombre"]) || "Paciente";
      const pacienteKey =
        firstString(f["Paciente_teléfono"]) || pacienteNombre;

      records.push({
        dayIso,
        isNoShow,
        clinicaId,
        clinicaNombre,
        pacienteKey,
        pacienteNombre,
      });
    }

    // ── Aplicar scope de clínica ─────────────────────────────────────
    const scopeSet = scopeIds ? new Set(scopeIds) : null;
    const inScope = (rec: ApptRecord): boolean => {
      if (!scopeSet) return true;
      if (!rec.clinicaId) return false;
      return scopeSet.has(rec.clinicaId);
    };
    const scoped = records.filter(inScope);

    // ── Tasa mes actual vs mes anterior ──────────────────────────────
    const calcTasa = (desde: string, hasta: string | null) => {
      const recs = scoped.filter(
        (r) => r.dayIso >= desde && (hasta == null || r.dayIso < hasta),
      );
      const total = recs.length;
      const noShows = recs.filter((r) => r.isNoShow).length;
      return { total, noShows, tasa: total > 0 ? noShows / total : 0 };
    };

    const mesActual = calcTasa(inicioMesIso, null);
    const mesAnterior = calcTasa(inicioMesAntIso, finMesAntIso);

    // deltaPct: variación relativa de la tasa. Para no-shows, BAJAR es bueno
    // → el signo lo interpreta la vista (menor tasa = mejora).
    const deltaPct =
      mesAnterior.tasa > 0
        ? Math.round(((mesActual.tasa - mesAnterior.tasa) / mesAnterior.tasa) * 100)
        : null;

    // ── Coste de oportunidad estimado del mes (noShows × ticket) ─────
    const costeOportunidad = Math.round(mesActual.noShows * AVG_TICKET);

    // ── Top 5 pacientes con más no-shows (ventana 12 meses) ──────────
    const pacienteAgg = new Map<
      string,
      { nombre: string; noShows: number; total: number; clinicaNombre: string }
    >();
    for (const r of scoped) {
      if (r.dayIso < desdeRankingIso) continue;
      const prev =
        pacienteAgg.get(r.pacienteKey) ?? {
          nombre: r.pacienteNombre,
          noShows: 0,
          total: 0,
          clinicaNombre: r.clinicaNombre,
        };
      pacienteAgg.set(r.pacienteKey, {
        nombre: prev.nombre || r.pacienteNombre,
        noShows: prev.noShows + (r.isNoShow ? 1 : 0),
        total: prev.total + 1,
        clinicaNombre: prev.clinicaNombre,
      });
    }
    const topPacientes = [...pacienteAgg.values()]
      .filter((p) => p.noShows > 0)
      .sort((a, b) => b.noShows - a.noShows || b.total - a.total)
      .slice(0, 5)
      .map((p) => ({
        nombre: p.nombre,
        noShows: p.noShows,
        totalCitas: p.total,
        tasa: p.total > 0 ? p.noShows / p.total : 0,
        clinicaNombre: p.clinicaNombre,
      }));

    // ── Comparativa por clínica (mes actual) ─────────────────────────
    // Sólo tiene sentido cuando hay más de una clínica en el scope.
    const clinicaAgg = new Map<
      string,
      { nombre: string; total: number; noShows: number }
    >();
    const recsMesPorClinica = scoped.filter((r) => r.dayIso >= inicioMesIso);
    for (const r of recsMesPorClinica) {
      if (!r.clinicaId) continue;
      const prev =
        clinicaAgg.get(r.clinicaId) ?? {
          nombre: r.clinicaNombre,
          total: 0,
          noShows: 0,
        };
      clinicaAgg.set(r.clinicaId, {
        nombre: prev.nombre,
        total: prev.total + 1,
        noShows: prev.noShows + (r.isNoShow ? 1 : 0),
      });
    }
    const comparativaClinicas = [...clinicaAgg.entries()]
      .map(([clinicaId, v]) => ({
        clinicaId,
        nombre: v.nombre,
        total: v.total,
        noShows: v.noShows,
        tasa: v.total > 0 ? v.noShows / v.total : 0,
      }))
      .sort((a, b) => b.tasa - a.tasa);

    // ── Precisión del predictor (opcional, vía Supabase) ─────────────
    let precisionPredictor:
      | { correctas: number; total: number; precision: number }
      | null = null;
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseAdmin();
        let query = supabase
          .from("factores_no_show")
          .select("prediccion_correcta, clinica_id")
          .not("prediccion_correcta", "is", null);
        if (scopeSet) {
          query = query.in("clinica_id", [...scopeSet]);
        }
        const { data, error } = await query;
        if (!error && data) {
          const rows = data as Array<{ prediccion_correcta: boolean | null }>;
          const total = rows.length;
          const correctas = rows.filter((x) => x.prediccion_correcta === true).length;
          if (total > 0) {
            precisionPredictor = {
              correctas,
              total,
              precision: correctas / total,
            };
          }
        }
      } catch {
        precisionPredictor = null;
      }
    }

    let clinicaResp: { id: string; nombre: string } | undefined;
    if (restrictedToOne) {
      clinicaResp = {
        id: restrictedToOne,
        nombre: clinicaNombrePorId.get(restrictedToOne) ?? "Clínica",
      };
    }

    return NextResponse.json({
      periodo: "mes",
      scope: {
        esGlobal: scopeSet === null,
        clinica: clinicaResp,
      },
      tasaMes: {
        tasa: mesActual.tasa,
        total: mesActual.total,
        noShows: mesActual.noShows,
        tasaAnterior: mesAnterior.tasa,
        totalAnterior: mesAnterior.total,
        noShowsAnterior: mesAnterior.noShows,
        deltaPct,
      },
      costeOportunidad: {
        importe: costeOportunidad,
        ticketMedio: AVG_TICKET,
        noShows: mesActual.noShows,
      },
      topPacientes,
      comparativaClinicas,
      precisionPredictor,
    });
  } catch (e: any) {
    console.error("[kpis/no-shows] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
});
