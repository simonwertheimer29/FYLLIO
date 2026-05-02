// app/api/plantillas/preview/route.ts
//
// Sprint 14b Bloque 4 — preview en vivo de un contenido de plantilla
// usando un paciente de muestra. La UI lo invoca al editar el cuerpo
// (debounced) para mostrar la sustitución en vivo sin guardar.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listPacientes } from "../../../lib/pacientes/pacientes";
import { previewContenido } from "../../../lib/plantillas/plantillas";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as
    | {
        contenido?: string;
        pacienteId?: string;
        overrides?: Record<string, unknown>;
      }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const contenido = String(body.contenido ?? "");
  if (!contenido.trim()) {
    return NextResponse.json({ texto: "", valoresUsados: {} });
  }

  let pacienteId = String(body.pacienteId ?? "").trim();
  if (!pacienteId) {
    // Sin paciente concreto: tomamos el primer paciente activo del seed
    // (UI puede pasar uno explícito si lo prefiere).
    const pacs = await listPacientes({});
    pacienteId = pacs[0]?.id ?? "";
    if (!pacienteId) {
      return NextResponse.json(
        { error: "No hay pacientes para preview" },
        { status: 404 },
      );
    }
  }

  // Sanitiza overrides al tipo esperado.
  const ov = body.overrides ?? {};
  const overrides: any = {};
  if (typeof ov.nombre === "string") overrides.nombre = ov.nombre;
  if (typeof ov.importe === "number") overrides.importe = ov.importe;
  if (typeof ov.tratamiento === "string") overrides.tratamiento = ov.tratamiento;
  if (typeof ov.nombre_doctor === "string") overrides.nombre_doctor = ov.nombre_doctor;
  if (typeof ov.nombre_clinica === "string") overrides.nombre_clinica = ov.nombre_clinica;
  if (typeof ov.fecha_aceptado === "string") overrides.fecha_aceptado = ov.fecha_aceptado;
  if (typeof ov.plazo_dias === "number") overrides.plazo_dias = ov.plazo_dias;
  if (typeof ov.dias_vencido === "number") overrides.dias_vencido = ov.dias_vencido;

  const r = await previewContenido({ contenido, pacienteId, overrides });
  return NextResponse.json(r);
});
