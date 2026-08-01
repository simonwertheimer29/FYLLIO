// app/api/seguimiento/vistos/route.ts
//
// "Visto hoy" de la cola de Seguimiento. GET devuelve los de hoy; POST marca y
// desmarca. Ver `lib/seguimiento/vistos` para el porqué de que esto exista aquí
// y NO exista en /alertas.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import {
  vistosDeHoy,
  marcarVistoHoy,
  desmarcarVisto,
  type TipoCaso,
} from "../../../lib/seguimiento/vistos";

export const dynamic = "force-dynamic";

const TIPOS: TipoCaso[] = ["lead", "presupuesto"];

export const GET = withAuth(async () => {
  const vistos = await vistosDeHoy();
  return NextResponse.json({
    vistos: [...vistos.values()],
  });
});

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as {
    tipo?: TipoCaso;
    casoId?: string;
    deshacer?: boolean;
  } | null;
  const tipo = body?.tipo;
  const casoId = body?.casoId;
  if (!tipo || !casoId) {
    return NextResponse.json({ error: "tipo y casoId requeridos" }, { status: 400 });
  }
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }

  if (body?.deshacer) {
    await desmarcarVisto({ tipo, casoId });
    return NextResponse.json({ ok: true, visto: false });
  }
  // Se espera la escritura y se confirma con el dato que produjo (§1).
  const { dia } = await marcarVistoHoy({
    tipo,
    casoId,
    usuarioId: session.userId,
    usuarioNombre: session.nombre,
  });
  return NextResponse.json({ ok: true, visto: true, dia });
});
