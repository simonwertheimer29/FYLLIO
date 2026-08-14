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
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { registrarEvento } from "../../../lib/automatizacion/pg";
import { verificarPresupuestoPermitido } from "../../../lib/presupuestos/clinica-scope";
import type { EventoAutomatizacion, TipoCaso } from "../../../lib/automatizacion/estado";

export const dynamic = "force-dynamic";

const TIPOS: readonly TipoCaso[] = ["presupuesto", "lead", "cobro"];

/** Solo las decisiones humanas. `mensaje_enviado` NO entra aquí: lo escribe el
 *  camino del envío, con su medida, y no un cliente que podría inventarla.
 *  `devuelto_al_agente` se retiró en la 022 (la derivación no se revierte) y
 *  `derivado` tampoco entra: lo emite el evaluador, no un botón. */
const DECISIONES: readonly EventoAutomatizacion[] = [
  "quiebre_reconocido",
  "asumido",
  "asumido_manual",
];

export const POST = withPresupuestosAuth(async (session, req: Request) => {
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

  // Aislamiento por clínica (§5): un caso de otra clínica no se toca, ni para
  // registrar una decisión sobre él. Se comprueba lo que se puede comprobar hoy
  // —presupuestos tiene su verificador— y se declara lo que no.
  if (tipoCaso === "presupuesto") {
    const permiso = await verificarPresupuestoPermitido(session, casoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
  }

  try {
    await registrarEvento({
      tipoCaso,
      casoId,
      evento,
      actorId: session.email ?? null,
      actorNombre: session.nombre ?? null,
      motivoTexto,
    });
    // El estado NO se devuelve desde aquí: se deriva en la siguiente carga, con
    // el resto de señales. Devolverlo ahora obligaría a calcularlo dos veces y
    // abriría la puerta a que el cliente y el servidor discrepen.
    return NextResponse.json({ ok: true });
  } catch (err) {
    // §1 — el registro ES el dato: si no se guardó, no se confirma. Un
    // "devuelto al agente" que se pierde deja el caso en manos de alguien para
    // siempre, y la coordinadora creyendo que lo soltó.
    console.error("[automatizacion/decidir]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo registrar la decisión" }, { status: 500 });
  }
});
