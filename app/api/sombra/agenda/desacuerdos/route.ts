// app/api/sombra/agenda/desacuerdos/route.ts
//
// GET /api/sombra/agenda/desacuerdos → los candidatos con LAS DOS columnas:
// la etiqueta de Simon y el veredicto del juicio especializado.
//
// Es una ruta APARTE de `/api/sombra/agenda` a propósito, no un parámetro de
// aquella: la pantalla de etiquetar es ciega por diseño y esa garantía no
// puede depender de que nadie ponga el flag al revés. Aquí se lee después,
// con la lista terminada.
//
// Instrumentación de desarrollo, NO producto: sin esVisorSombra no existe
// (404). Un fallo es un 500 real (§10), nunca una lista vacía que se lea como
// «no hay desacuerdos» — que es justo la conclusión contraria a la verdadera.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { esVisorSombra } from "../../../../lib/agente/sombra";
import { listarDesacuerdosAgenda } from "../../../../lib/agente/agenda-corpus";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!esVisorSombra(session)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  try {
    return NextResponse.json(await listarDesacuerdosAgenda());
  } catch (err) {
    console.error("[agenda-desacuerdos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer la comparación" }, { status: 500 });
  }
});
