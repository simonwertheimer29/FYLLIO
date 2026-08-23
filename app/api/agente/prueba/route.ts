// app/api/agente/prueba/route.ts
//
// FASE E — el banco de pruebas del agente. POST evalúa UN turno de una
// conversación de mentira con el agente REAL de la clínica (evaluarTurno:
// misma función, mismo juez que producción — y CERO escritura salvo el
// contador de uso). GET devuelve el estado (¿puede esta sesión? ¿cuántos
// mensajes quedan hoy?) para pintar la pantalla sin adivinarlo.
//
// PERMISO (§4 del dictado): admin siempre; coordinación según
// `pruebas_coordinacion` de la clínica (default true — se cobra poder
// configurar, no poder comprobar). IDOR: coordinación solo sobre SUS
// clínicas, fail-closed.

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import {
  probarTurno,
  usoDeHoy,
  TopeDePruebasError,
  type EscenarioPrueba,
  type TurnoPrueba,
} from "../../../lib/agente/banco-pruebas";
import { ConocimientoIlegibleError } from "../../../lib/agente/conocimiento";
import type { Session } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
// Un turno = evaluador + juez (dos llamadas al modelo con margen de retraso).
export const maxDuration = 60;

/** admin → ok; coordinación → su clínica Y el flag de la clínica (sin fila =
 *  true). Devuelve el motivo del no, para que la pantalla lo diga. */
async function puedeProbar(
  session: Session,
  clinicaId: string,
): Promise<{ ok: true } | { ok: false; motivo: string; status: number }> {
  if (session.rol === "admin") return { ok: true };
  const permitidas = await listClinicaIdsForUser(session.userId);
  if (!permitidas.includes(clinicaId)) {
    return { ok: false, motivo: "No encontrado", status: 404 };
  }
  const r: any = await runWithClienteDb(session.cliente, (trx) =>
    sql`select pruebas_coordinacion from configuracion_automatizaciones
        where clinica_id = ${clinicaId} limit 1`.execute(trx),
  );
  if (r.rows?.[0]?.pruebas_coordinacion === false) {
    return {
      ok: false,
      motivo: "En esta clínica, el banco de pruebas lo usa solo administración.",
      status: 403,
    };
  }
  return { ok: true };
}

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const clinicaId = new URL(req.url).searchParams.get("clinicaId");
  if (!clinicaId) {
    return NextResponse.json({ error: "El banco prueba el agente DE una clínica — falta clinicaId" }, { status: 400 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      const permiso = await puedeProbar(session, clinicaId);
      if (!permiso.ok) {
        return NextResponse.json({ permitido: false, motivo: permiso.motivo }, { status: 200 });
      }
      const uso = await usoDeHoy(clinicaId);
      return NextResponse.json({ permitido: true, ...uso });
    });
  } catch (err) {
    console.error("[agente/prueba] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo consultar el banco de pruebas" }, { status: 500 });
  }
});

const TIPOS: readonly EscenarioPrueba["tipo"][] = ["lead_nuevo", "presupuesto", "cobro", "al_dia"];

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const clinicaId = typeof body?.clinicaId === "string" ? body.clinicaId : "";
  const mensaje = typeof body?.mensaje === "string" ? body.mensaje.trim().slice(0, 1000) : "";
  const tipo = body?.escenario?.tipo as EscenarioPrueba["tipo"] | undefined;
  if (!clinicaId || !mensaje || !tipo || !TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "Faltan datos de la prueba" }, { status: 400 });
  }
  const escenario: EscenarioPrueba = {
    tipo,
    nombre: typeof body.escenario.nombre === "string" ? body.escenario.nombre.slice(0, 60) : undefined,
    tratamiento: typeof body.escenario.tratamiento === "string" ? body.escenario.tratamiento.slice(0, 80) : undefined,
    importe: Number.isFinite(body.escenario.importe) ? Number(body.escenario.importe) : undefined,
    deuda: Number.isFinite(body.escenario.deuda) ? Number(body.escenario.deuda) : undefined,
  };
  // El hilo de la sesión viaja del cliente y muere con la pantalla — es un
  // banco de ensayo sintético: no hay integridad que proteger, nada se
  // escribe. Acotado igualmente (40 turnos × 1000 chars).
  const hilo: TurnoPrueba[] = Array.isArray(body.hilo)
    ? body.hilo.slice(0, 40).map((t: any) => ({
        direccion: t?.direccion === "Saliente" ? ("Saliente" as const) : ("Entrante" as const),
        contenido: String(t?.contenido ?? "").slice(0, 1000),
      }))
    : [];

  try {
    return await runWithCliente(session.cliente, async () => {
      const permiso = await puedeProbar(session, clinicaId);
      if (!permiso.ok) {
        return NextResponse.json({ error: permiso.motivo }, { status: permiso.status });
      }
      const nombre: any = await runWithClienteDb(session.cliente!, (trx) =>
        sql`select nombre from clinicas where id = ${clinicaId} limit 1`.execute(trx),
      );
      const r = await probarTurno({
        clinicaId,
        clinicaNombre: nombre.rows?.[0]?.nombre ?? null,
        escenario,
        hilo,
        mensaje,
        derivadoPrevio: body.derivadoPrevio === true,
      });
      return NextResponse.json(r);
    });
  } catch (err) {
    if (err instanceof TopeDePruebasError) {
      // La condición dictada: el tope corta CON su motivo y cuándo se
      // renueva — nunca un fallo mudo.
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof ConocimientoIlegibleError) {
      return NextResponse.json(
        { error: `La configuración guardada de esta clínica está rota y el banco no la puede probar. ${err.message}` },
        { status: 500 },
      );
    }
    console.error("[agente/prueba] POST:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo evaluar el mensaje de prueba" }, { status: 500 });
  }
});
