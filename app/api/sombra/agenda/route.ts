// app/api/sombra/agenda/route.ts
//
// GET   /api/sombra/agenda → los candidatos del corpus de agenda, con la
//                            etiqueta que ya tengan. SIN el juicio del modelo:
//                            se etiqueta a ciegas y por eso no viaja.
// PATCH /api/sombra/agenda → la etiqueta de un candidato
//                            {clave, etiqueta?, seArroga?, nota?}
//
// Instrumentación de desarrollo, NO producto: para quien no pasa esVisorSombra
// la ruta no existe (404, igual que la pantalla). Aislamiento de siempre (RLS
// por cliente de la sesión, withAuth). Un fallo es un 500 real (§10), nunca una
// lista vacía que se lea como «no hay candidatos».

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { esVisorSombra } from "../../../lib/agente/sombra";
import { anotarEtiquetaAgenda, listarCorpusAgenda } from "../../../lib/agente/agenda-corpus";
import { ETIQUETAS_AGENDA, type EtiquetaAgenda } from "../../../lib/agente/agenda-enrutador";

export const dynamic = "force-dynamic";

const noExiste = () => NextResponse.json({ error: "No encontrado" }, { status: 404 });

export const GET = withAuth(async (session) => {
  if (!esVisorSombra(session)) return noExiste();
  try {
    return NextResponse.json(await listarCorpusAgenda());
  } catch (err) {
    console.error("[agenda-corpus]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer el corpus de agenda" }, { status: 500 });
  }
});

export const PATCH = withAuth(async (session, req) => {
  if (!esVisorSombra(session)) return noExiste();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo ilegible" }, { status: 400 });
  }
  const b = (body ?? {}) as { clave?: unknown; etiqueta?: unknown; seArroga?: unknown; nota?: unknown };
  const clave = typeof b.clave === "string" ? b.clave.trim() : "";
  if (!clave) return NextResponse.json({ error: "Falta la clave del candidato" }, { status: 400 });

  // `undefined` = no se toca; `null` = se borra. Las dos preguntas son
  // independientes a propósito: contestar una no borra la otra.
  let etiqueta: EtiquetaAgenda | null | undefined;
  if ("etiqueta" in b) {
    if (b.etiqueta == null) etiqueta = null;
    else if ((ETIQUETAS_AGENDA as readonly string[]).includes(String(b.etiqueta))) etiqueta = b.etiqueta as EtiquetaAgenda;
    else return NextResponse.json({ error: "Etiqueta no válida" }, { status: 400 });
  }
  let seArroga: boolean | null | undefined;
  if ("seArroga" in b) {
    if (b.seArroga == null) seArroga = null;
    else if (typeof b.seArroga === "boolean") seArroga = b.seArroga;
    else return NextResponse.json({ error: "Respuesta no válida" }, { status: 400 });
  }
  let nota: string | null | undefined;
  if ("nota" in b) {
    if (b.nota == null) nota = null;
    else if (typeof b.nota === "string") nota = b.nota.trim().slice(0, 600) || null;
    else return NextResponse.json({ error: "Nota no válida" }, { status: 400 });
  }
  if (etiqueta === undefined && seArroga === undefined && nota === undefined) {
    return NextResponse.json({ error: "Nada que guardar" }, { status: 400 });
  }
  try {
    const ok = await anotarEtiquetaAgenda({ clave, etiqueta, seArroga, nota, por: session.userId });
    if (!ok) return NextResponse.json({ error: "Ese mensaje no está en el corpus" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agenda-corpus] etiqueta", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar la etiqueta" }, { status: 500 });
  }
});
