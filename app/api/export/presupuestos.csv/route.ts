// app/api/export/presupuestos.csv/route.ts
//
// Sprint 14b Bloque 7 — export contable de Presupuestos en CSV con
// formato Excel español (UTF-8 BOM, separador ';', números 1.234,56
// y fechas dd/mm/yyyy).
//
// Auth: withAdmin (sesión global Fyllio). El admin sin scope ve todas;
// si pasa ?clinicaId=X se filtra a esa clínica. Coordinacion no
// expone export contable (decision producto: reportes ejecutivos
// son admin-only).
//
// Filtros opcionales por query string:
//   clinicaId  recordId de Clinicas
//   desde      ISO YYYY-MM-DD (filtra Fecha >= desde)
//   hasta      ISO YYYY-MM-DD (filtra Fecha <= hasta)
//   estado     PresupuestoEstado (PRESENTADO, ACEPTADO, etc.)
//
// Stream del CSV directamente al browser via Response body string.
// Para volúmenes pequeños (<10k filas) cabe en memoria. Si crece,
// migrar a ReadableStream chunked.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { DateTime } from "luxon";

export const dynamic = "force-dynamic";

const ZONE = "Europe/Madrid";

// ─── Formato Excel español ─────────────────────────────────────────────

function fmtFechaEs(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = DateTime.fromISO(String(iso).slice(0, 10), { zone: ZONE });
  if (!d.isValid) return "";
  return d.toFormat("dd/MM/yyyy");
}

function fmtImporteEs(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  // 1.234,56 — separador miles '.', decimal ','. useGrouping:true fuerza
  // el separador desde el primer millar (sin esto, el Intl es-ES omite
  // el punto en numeros de 4 digitos como '2711').
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
}

/**
 * Escapa una celda para CSV con separador ';'. Estrategia: siempre
 * envolver entre comillas dobles (cubre saltos de línea, ; y caracteres
 * raros sin tener que detectar nada). Las " internas se duplican.
 */
function csvCell(raw: unknown): string {
  if (raw == null) return '""';
  const s = String(raw);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(";");
}

function diasEnPipeline(fechaAlta: string, estado: string, today: DateTime): number {
  if (!fechaAlta) return 0;
  const d = DateTime.fromISO(fechaAlta, { zone: ZONE });
  if (!d.isValid) return 0;
  // Si está cerrado, congelamos el contador (los pipelines abiertos
  // siguen creciendo; los cerrados quedan al días-cerrado pero no
  // tenemos fechaCierre fiable, asumimos hoy).
  return Math.max(0, Math.round(today.diff(d.startOf("day"), "days").days));
}

function ultimaAccionTexto(f: any): string {
  const tipo = f["Tipo_ultima_accion"];
  const fecha = f["Ultima_accion_registrada"];
  if (!tipo && !fecha) return "";
  const t = tipo ? String(tipo) : "Acción";
  if (!fecha) return t;
  const d = DateTime.fromISO(String(fecha));
  if (!d.isValid) return t;
  const hoy = DateTime.now().setZone(ZONE).startOf("day");
  const dias = Math.round(hoy.diff(d.startOf("day"), "days").days);
  if (dias === 0) return `${t} hoy`;
  if (dias === 1) return `${t} ayer`;
  return `${t} hace ${dias}d`;
}

// ─── GET handler ───────────────────────────────────────────────────────

export const GET = withAdmin(async (_session, req) => {
  const url = new URL(req.url);
  const clinicaIdParam = url.searchParams.get("clinicaId");
  const desdeParam = url.searchParams.get("desde");
  const hastaParam = url.searchParams.get("hasta");
  const estadoParam = url.searchParams.get("estado");

  // ── Resolver mapa clínicas (recordId → nombre) para filtrar/escribir.
  const clinicaRecs = await fetchAll(
    base(TABLES.clinics as any).select({ fields: ["Nombre"] }),
  );
  const clinicaNombrePorId = new Map<string, string>();
  for (const c of clinicaRecs) {
    clinicaNombrePorId.set(c.id, String((c.fields as any)?.["Nombre"] ?? ""));
  }
  const clinicaNombreFiltro = clinicaIdParam
    ? clinicaNombrePorId.get(clinicaIdParam) ?? null
    : null;

  // ── Cargar presupuestos. Aplicamos filtros via filterByFormula
  // donde sea trivial; el resto en JS para evitar fórmulas frágiles.
  const formulaParts: string[] = [];
  if (estadoParam) {
    formulaParts.push(`{Estado}='${estadoParam.replace(/'/g, "")}'`);
  }
  if (clinicaNombreFiltro) {
    formulaParts.push(`{Clinica}='${clinicaNombreFiltro.replace(/'/g, "''")}'`);
  }
  if (desdeParam) {
    formulaParts.push(
      `IS_AFTER({Fecha}, '${shiftDay(desdeParam, -1)}')`,
    );
  }
  if (hastaParam) {
    formulaParts.push(
      `IS_BEFORE({Fecha}, '${shiftDay(hastaParam, 1)}')`,
    );
  }
  const filterByFormula =
    formulaParts.length > 0 ? `AND(${formulaParts.join(",")})` : undefined;

  const recs = await fetchAll(
    base(TABLES.presupuestos as any).select({
      fields: [
        "Paciente_nombre",
        "Paciente_Telefono",
        "Teléfono",
        "Doctor",
        "Clinica",
        "Tratamiento_nombre",
        "Importe",
        "Estado",
        "Fecha",
        "FechaAlta",
        "Tipo_ultima_accion",
        "Ultima_accion_registrada",
        "Accion_sugerida",
        "OrigenLead",
        "Notas",
      ],
      ...(filterByFormula ? { filterByFormula } : {}),
      sort: [{ field: "Fecha", direction: "desc" }],
    }),
  );

  const today = DateTime.now().setZone(ZONE).startOf("day");

  // ── Encabezados (ES) ─
  const headers = [
    "Fecha presentación",
    "Paciente",
    "Teléfono",
    "Doctor",
    "Clínica",
    "Tratamiento",
    "Importe",
    "Estado",
    "Última acción",
    "Próx. acción",
    "Días en pipeline",
    "Origen lead",
  ];

  const lines: string[] = [csvLine(headers)];

  for (const r of recs) {
    const f = r.fields as any;
    const fechaPresentacion = f["Fecha"]
      ? String(f["Fecha"]).slice(0, 10)
      : f["FechaAlta"]
        ? String(f["FechaAlta"]).slice(0, 10)
        : "";
    const fechaAlta = f["FechaAlta"] ? String(f["FechaAlta"]).slice(0, 10) : fechaPresentacion;
    const patientName = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "")
      : "";
    const telefono = f["Paciente_Telefono"]
      ? String(f["Paciente_Telefono"])
      : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
        ? String(f["Teléfono"][0])
        : "";
    const doctor = f["Doctor"] ? String(f["Doctor"]) : "";
    const clinica = f["Clinica"] ? String(f["Clinica"]) : "";
    const tratamiento = f["Tratamiento_nombre"]
      ? String(f["Tratamiento_nombre"])
      : "";
    const importe = f["Importe"] != null ? Number(f["Importe"]) : null;
    const estado = f["Estado"] ? String(f["Estado"]) : "";
    const accionSugerida = f["Accion_sugerida"] ? String(f["Accion_sugerida"]) : "";
    const origenLead = f["OrigenLead"] ? String(f["OrigenLead"]) : "";

    lines.push(
      csvLine([
        fmtFechaEs(fechaPresentacion),
        patientName,
        telefono,
        doctor,
        clinica,
        tratamiento,
        fmtImporteEs(importe),
        estado,
        ultimaAccionTexto(f),
        accionSugerida,
        diasEnPipeline(fechaAlta, estado, today),
        origenLead,
      ]),
    );
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  const todayIso = today.toISODate()!;
  const filename = `fyllio_presupuestos_${todayIso}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

function shiftDay(iso: string, days: number): string {
  const d = DateTime.fromISO(iso, { zone: ZONE });
  if (!d.isValid) return iso;
  return d.plus({ days }).toFormat("yyyy-MM-dd");
}
