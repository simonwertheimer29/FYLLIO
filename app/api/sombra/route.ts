// app/api/sombra/route.ts
//
// GET   /api/sombra  → los hilos con sombra del cliente de la sesión (fase 1 en sombra, 11-09)
// PATCH /api/sombra  → el veredicto de Simon sobre un turno {id, veredicto|null, nota|null}
//
// Instrumentación de desarrollo, NO producto: para quien no pasa esVisorSombra
// la ruta no existe (404, igual que la pantalla). El aislamiento es el de
// siempre (RLS por cliente de la sesión, withAuth). Un fallo es un 500 real
// (§10), nunca una lista vacía que se lea como «no hay sombra».

import { NextResponse } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { anotarVeredictoSombra, esVisorSombra, listarSombra, sombraActiva, versionSombra } from "../../lib/agente/sombra";
import { VEREDICTOS_SOMBRA, type VeredictoSombra } from "../../lib/agente/actos";

export const dynamic = "force-dynamic";

const noExiste = () => NextResponse.json({ error: "No encontrado" }, { status: 404 });

export const GET = withAuth(async (session) => {
  if (!esVisorSombra(session)) return noExiste();
  try {
    const hilos = await listarSombra();
    return NextResponse.json({ hilos, activa: sombraActiva(session.cliente), version: versionSombra() });
  } catch (err) {
    console.error("[sombra]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer la sombra" }, { status: 500 });
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
  const b = (body ?? {}) as { id?: unknown; veredicto?: unknown; nota?: unknown };
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  let veredicto: VeredictoSombra | null = null;
  if (b.veredicto != null) {
    if (!(VEREDICTOS_SOMBRA as readonly string[]).includes(String(b.veredicto))) {
      return NextResponse.json({ error: "Veredicto no válido" }, { status: 400 });
    }
    veredicto = b.veredicto as VeredictoSombra;
  }
  let nota: string | null = null;
  if (b.nota != null) {
    if (typeof b.nota !== "string") return NextResponse.json({ error: "Nota no válida" }, { status: 400 });
    nota = b.nota.trim().slice(0, 600) || null;
  }
  try {
    const ok = await anotarVeredictoSombra({ id, veredicto, nota, por: session.userId });
    if (!ok) return NextResponse.json({ error: "Ese turno no está en la sombra" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sombra] veredicto", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar el veredicto" }, { status: 500 });
  }
});
