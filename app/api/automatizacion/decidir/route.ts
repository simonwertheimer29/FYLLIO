// app/api/automatizacion/decidir/route.ts
//
// La decisión humana sobre un caso: cogerlo, devolverlo al agente, o quedárselo.
// Fase 1 de PLAN-AGENTE.
//
// POR QUÉ ES UNA RUTA Y NO UN EFECTO AUTOMÁTICO. Cuando la coordinadora termina
// de hablar con el paciente elige explícitamente: `devuelto_al_agente` (sigue la
// cadencia) o `asumido_manual` (sigo yo hasta el final). Sin esa elección, el
// agente escribiría encima de una conversación humana en curso — que es la peor
// cosa que puede hacer un sistema así.
//
// La reanudación NO guarda posición: el siguiente toque es `toques + 1` y sale
// del contador que ya existe (`contact_count` / `whatsapp_enviados`). Devolver
// al agente es, literalmente, dejar de tener un evento humano por encima.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { registrarEvento } from "../../../lib/automatizacion/pg";
import type { EventoAutomatizacion, TipoCaso } from "../../../lib/automatizacion/estado";
import { CLAVES_APLAZADO, type ClaveAplazado } from "../../../lib/automatizacion/aplazamientos";

export const dynamic = "force-dynamic";

const TIPOS: readonly TipoCaso[] = ["presupuesto", "lead", "cobro", "conversacion"];

/** Solo las decisiones humanas. `mensaje_enviado` NO entra aquí: lo escribe el
 *  camino del envío, con su medida, y no un cliente que podría inventarla.
 *  `devuelto_al_agente` se retiró en la 022 (la derivación no se revierte) y
 *  `derivado` tampoco entra: lo emite el evaluador, no un botón.
 *
 *  026 — las decisiones del semáforo, sobre `conversacion` (caso = teléfono):
 *  `resuelto_manual` es UN SOLO botón para todas las causas — la causa ya
 *  está en el log y la coordinadora no repite taxonomía al cerrar. Es la
 *  salida para los asuntos sin hecho observable (queja atendida, urgencia
 *  resuelta por teléfono, negociación que quedó en llamar). `soltado` suelta
 *  el «este hilo es mío». `espera_fijada` manual lleva fecha y NO tiene tope
 *  (el tope de 14 días es del agente); `espera_levantada` la retira. */
const DECISIONES: readonly EventoAutomatizacion[] = [
  "quiebre_reconocido",
  "asumido",
  "asumido_manual",
  "resuelto_manual",
  "soltado",
  "espera_fijada",
  "espera_levantada",
  // MEJORAS 121 (auditoría 2026-09-05): nadie emitía `aplazado_resuelto` y
  // los pendientes eran eternos. El botón «Respondido» de la ficha, con su
  // clave, es el emisor que faltaba desde la fase C.
  "aplazado_resuelto",
  // MEJORAS 135: el opt-out también lo puede marcar (o revertir) una persona.
  "opt_out",
  "opt_in",
];

/** Las del semáforo solo tienen sentido sobre el HILO (tipo conversacion). */
const SOLO_CONVERSACION: readonly EventoAutomatizacion[] = [
  "resuelto_manual",
  "soltado",
  "espera_fijada",
  "espera_levantada",
  "aplazado_resuelto",
  "opt_out",
  "opt_in",
];

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const tipoCaso = body?.tipoCaso as TipoCaso | undefined;
  const casoId = body?.casoId as string | undefined;
  const evento = body?.evento as EventoAutomatizacion | undefined;
  const motivoTexto = typeof body?.motivoTexto === "string" ? body.motivoTexto.slice(0, 300) : null;

  if (!tipoCaso || !TIPOS.includes(tipoCaso)) {
    return NextResponse.json({ error: "tipoCaso no válido" }, { status: 400 });
  }
  if (!casoId) {
    return NextResponse.json({ error: "Falta casoId" }, { status: 400 });
  }
  if (!evento || !DECISIONES.includes(evento)) {
    return NextResponse.json({ error: "evento no válido" }, { status: 400 });
  }
  if (SOLO_CONVERSACION.includes(evento) && tipoCaso !== "conversacion") {
    return NextResponse.json({ error: `${evento} solo aplica a tipoCaso=conversacion` }, { status: 400 });
  }

  // La espera manual: fecha obligatoria, futura, y NADA de texto libre en la
  // decisión — el campo de nota (motivoTexto) es para la siguiente persona,
  // el sistema solo lee la fecha. Sin tope: el de 14 días es del AGENTE.
  // `aplazado_resuelto` exige su clave (constraint de la 021): resolver «lo
  // de la financiación» es resolver ESA clave, no todas.
  let claveAplazado: ClaveAplazado | null = null;
  if (evento === "aplazado_resuelto") {
    const cruda = typeof body?.claveAplazado === "string" ? body.claveAplazado : "";
    if (!(CLAVES_APLAZADO as readonly string[]).includes(cruda)) {
      return NextResponse.json({ error: "aplazado_resuelto requiere claveAplazado válida" }, { status: 400 });
    }
    claveAplazado = cruda as ClaveAplazado;
  }

  let hasta: string | null = null;
  if (evento === "espera_fijada") {
    const cruda = typeof body?.hasta === "string" ? body.hasta : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cruda)) {
      return NextResponse.json({ error: "espera_fijada requiere hasta=YYYY-MM-DD" }, { status: 400 });
    }
    const { hoyISO } = await import("../../../lib/time");
    if (cruda <= hoyISO()) {
      return NextResponse.json({ error: "hasta debe ser una fecha futura" }, { status: 400 });
    }
    hasta = cruda;
  }

  try {
    return await runWithCliente(session.cliente, async () => {
      // Aislamiento por clínica (§5) — IDOR por tipo, el mismo criterio que
      // /api/seguimiento/llamada (fase C: con botón en pantalla, «cualquier
      // sesión resuelve cualquier hilo» dejó de ser aceptable). Fail-closed:
      // sin clínica resoluble, solo red. `cobro` queda declarado sin
      // verificador propio (no tiene ruta de UI que emita decisiones hoy).
      if (session.rol !== "admin") {
        const permitidas = await listClinicaIdsForUser(session.userId);
        if (tipoCaso === "presupuesto") {
          const { verificarPresupuestoPermitido } = await import("../../../lib/presupuestos/clinica-scope");
          const permiso = await verificarPresupuestoPermitido(
            { ...session, clinicasAccesibles: permitidas } as any,
            casoId,
          );
          if (permiso !== "ok") {
            return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          }
        } else if (tipoCaso === "lead") {
          const { getLead } = await import("../../../lib/leads/leads");
          const lead = await getLead(casoId);
          if (!lead || !lead.clinicaId || !permitidas.includes(lead.clinicaId)) {
            return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          }
        } else if (tipoCaso === "conversacion") {
          // El caso ES el teléfono: la clínica se resuelve del hilo (019).
          const { hiloDe } = await import("../../../lib/mensajeria/conversaciones");
          const mensajes = await hiloDe(casoId);
          // 2026-09-05 (MEJORAS 122): cualquiera de las clínicas del hilo.
          const { clinicasDeMensajes, puedeVerHilo } = await import("../../../lib/mensajeria/acceso-hilo");
          if (!puedeVerHilo(permitidas, clinicasDeMensajes(mensajes))) {
            return NextResponse.json({ error: "No encontrado" }, { status: 404 });
          }
        }
      }

      if (evento === "opt_out" || evento === "opt_in") {
        // Una fuente: el opt-out se escribe donde lo leen todos (paciente +
        // log), no como un evento suelto que solo vería esta ruta.
        const { marcarOptOut, revertirOptOut } = await import("../../../lib/contacto/optout");
        if (evento === "opt_out") {
          await marcarOptOut({ telefono: casoId, frase: motivoTexto, actorNombre: session.nombre ?? "persona", actorId: session.userId ?? null });
        } else {
          await revertirOptOut({ telefono: casoId, actorNombre: session.nombre ?? "persona", actorId: session.userId ?? null });
        }
      } else {
        await registrarEvento({
          tipoCaso,
          casoId,
          evento,
          actorId: session.userId ?? null,
          actorNombre: session.nombre ?? null,
          motivoTexto,
          hasta,
          claveAplazado,
        });
      }
      // El estado NO se devuelve desde aquí: se deriva en la siguiente carga, con
      // el resto de señales. Devolverlo ahora obligaría a calcularlo dos veces y
      // abriría la puerta a que el cliente y el servidor discrepen.
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    // §1 — el registro ES el dato: si no se guardó, no se confirma. Un
    // "devuelto al agente" que se pierde deja el caso en manos de alguien para
    // siempre, y la coordinadora creyendo que lo soltó.
    console.error("[automatizacion/decidir]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo registrar la decisión" }, { status: 500 });
  }
});
