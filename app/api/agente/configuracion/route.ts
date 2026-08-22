// app/api/agente/configuracion/route.ts
//
// FASE D — la configuración del agente. Por ahora, el grupo 2 (QUÉ SABE):
// lo publicado por la clínica. GET devuelve la config y el BLOQUE renderizado
// (el mismo render que ve el evaluador — el prompt visible de la pantalla no
// es una maqueta, es la misma función); PUT guarda validando con EL MISMO
// parser que usa la lectura (e, decisión de raíz): un JSON malo no llega a la
// base — recibe 422 con el motivo, no un 500 críptico ni un guardado a
// medias.
//
// SOLO rol de red (admin): configurar qué afirma el agente a pacientes es
// una decisión de la clínica ante su clínica, no de una coordinadora ante su
// bandeja. Cuando exista un rol manager, se abrirá ahí.

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import {
  parseConocimiento,
  renderConocimiento,
  ConocimientoIlegibleError,
} from "../../../lib/agente/conocimiento";
import { SYSTEM_PROMPT_EVALUADOR } from "../../../lib/agente/evaluador";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: session.cliente ? 403 : 401 });
  }
  const url = new URL(req.url);
  const clinicaId = url.searchParams.get("clinicaId");

  try {
    return await runWithCliente(session.cliente, async () => {
      const r: any = await runWithClienteDb(session.cliente!, (trx) =>
        sql`select conocimiento, evaluador_activo
            from configuracion_automatizaciones
            where ${clinicaId ? sql`clinica_id = ${clinicaId}` : sql`clinica_id is null`}
            limit 1`.execute(trx),
      );
      // El parser LANZA ante un raw ilegible — aquí eso es un 500 honesto
      // con el motivo: la pantalla tiene que enseñar «la config guardada
      // está rota», no un formulario vacío que al guardar la pisaría.
      const conocimiento = parseConocimiento(r.rows?.[0]?.conocimiento ?? null);
      return NextResponse.json({
        conocimiento,
        evaluadorActivo: r.rows?.[0]?.evaluador_activo === true,
        // El bloque EXACTO que entra en el prompt — la misma función que usa
        // el evaluador, no una copia para enseñar.
        bloquePrompt: renderConocimiento(conocimiento).join("\n"),
        // Y las instrucciones base del agente, enteras: el manager tiene que
        // poder leer qué se le dice a sus pacientes (PLAN §6 — sin esto no
        // sube de modo A nunca).
        systemPrompt: SYSTEM_PROMPT_EVALUADOR,
      });
    });
  } catch (err) {
    const motivo = err instanceof ConocimientoIlegibleError ? ` ${err.message}` : "";
    console.error("[agente/configuracion] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: `No se pudo leer la configuración.${motivo}` },
      { status: 500 },
    );
  }
});

export const PUT = withAuth(async (session, req) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: session.cliente ? 403 : 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400 });
  }
  const clinicaId = typeof body.clinicaId === "string" && body.clinicaId ? body.clinicaId : null;

  // LA VALIDACIÓN DE RAÍZ: el mismo parser que usa la lectura, sobre el
  // string EXACTO que se guardaría. Lo que se persiste es el resultado
  // NORMALIZADO del parse (textos recortados), no el input crudo.
  let raw: string | null;
  try {
    const parseado = parseConocimiento(JSON.stringify(body.conocimiento ?? null));
    raw = JSON.stringify(parseado);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Configuración no válida" },
      { status: 422 },
    );
  }

  try {
    return await runWithCliente(session.cliente, async () => {
      await runWithClienteDb(session.cliente!, async (trx) => {
        if (clinicaId) {
          // Fail-closed: una clínica que no existe en este cliente no crea
          // una fila huérfana — 404, no insert.
          const c = await trx.selectFrom("clinicas").select("id").where("id", "=", clinicaId).executeTakeFirst();
          if (!c) throw new Error("clinica_desconocida");
        }
        const existe: any = await sql`select id from configuracion_automatizaciones
            where ${clinicaId ? sql`clinica_id = ${clinicaId}` : sql`clinica_id is null`}
            limit 1`.execute(trx);
        if (existe.rows?.length) {
          await sql`update configuracion_automatizaciones
              set conocimiento = ${raw}, actualizado_en = now()
              where id = ${String(existe.rows[0].id)}`.execute(trx);
        } else {
          await sql`insert into configuracion_automatizaciones (cliente, clinica_id, conocimiento, actualizado_en)
              values (${session.cliente}, ${clinicaId}, ${raw}, now())`.execute(trx);
        }
      });
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "clinica_desconocida") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    // §1 — si no se guardó, no se confirma.
    console.error("[agente/configuracion] PUT:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar la configuración" }, { status: 500 });
  }
});
