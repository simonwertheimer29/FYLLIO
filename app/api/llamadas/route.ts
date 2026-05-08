// app/api/llamadas/route.ts
//
// Sprint 17 Bloque 6 — list de Llamadas_Vapi para el panel /llamadas.
//
// Query params: estado?, resultado?, desde?, hasta?, limit (default 50,
// max 200), pacienteId?

import { NextResponse } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { listLlamadas } from "../../lib/llamadas/repo";
import type {
  EstadoLlamada,
  ResultadoLlamada,
} from "../../lib/llamadas/types";

export const dynamic = "force-dynamic";

const ESTADOS: EstadoLlamada[] = [
  "pendiente",
  "iniciada",
  "en_curso",
  "completada",
  "fallida",
  "cancelada",
];
const RESULTADOS: ResultadoLlamada[] = [
  "confirmada",
  "reagenda_solicitada",
  "cancelada",
  "no_contesta",
  "escalado_humano",
  "sin_resultado",
];

export const GET = withAuth(async (_session, req) => {
  const url = new URL(req.url);
  const estadoRaw = url.searchParams.get("estado");
  const resultadoRaw = url.searchParams.get("resultado");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "50"), 1),
    200,
  );
  const llamadas = await listLlamadas({
    estado: ESTADOS.includes(estadoRaw as EstadoLlamada)
      ? (estadoRaw as EstadoLlamada)
      : undefined,
    resultado: RESULTADOS.includes(resultadoRaw as ResultadoLlamada)
      ? (resultadoRaw as ResultadoLlamada)
      : undefined,
    desde: url.searchParams.get("desde") ?? undefined,
    hasta: url.searchParams.get("hasta") ?? undefined,
    pacienteId: url.searchParams.get("pacienteId") ?? undefined,
    limit,
  });
  return NextResponse.json({ llamadas });
});
