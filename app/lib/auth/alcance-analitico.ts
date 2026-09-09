// app/lib/auth/alcance-analitico.ts
//
// EL ALCANCE DE UNA PANTALLA ANALÍTICA, una sola vez (MEJORAS 219): qué
// clínicas ve la sesión (admin = la red; otro rol = las suyas) y cuál pide la
// URL (`?clinicaId=<id|red>`). Sin parámetro: la red si puede, si no su primera
// sede. «red» sin permiso → 403; sede fuera de alcance → 404; nunca «sin
// filtro» (§5 del skill de ingeniería). Antes/después, Dónde se pierde y Qué
// dicen lo llaman; una copia en cada ruta eran tres sitios donde equivocarse.
// Debe llamarse dentro de `runWithCliente`.

import { NextResponse } from "next/server";
import { listClinicaIdsForUser } from "./users";
import { runWithClienteDb } from "../db/context";
import type { Session } from "./session";

export type AlcanceAnalitico = {
  clinicas: { id: string; nombre: string }[];
  puedeRed: boolean;
  /** null = toda la red. */
  clinicaId: string | null;
};

export async function resolverAlcanceAnalitico(
  session: Pick<Session, "rol" | "userId" | "cliente">,
  url: URL,
): Promise<AlcanceAnalitico | NextResponse> {
  const permitidas = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const todas = await runWithClienteDb(session.cliente, (trx) =>
    trx.selectFrom("clinicas").select(["id", "nombre"]).where("activa", "is not", false).orderBy("nombre").execute(),
  );
  const clinicas = (permitidas ? todas.filter((c) => permitidas.includes(c.id)) : todas).map((c) => ({ id: c.id, nombre: c.nombre }));
  const puedeRed = permitidas === null;

  const pedida = url.searchParams.get("clinicaId");
  let clinicaId: string | null;
  if (pedida == null || pedida === "") clinicaId = puedeRed ? null : (clinicas[0]?.id ?? null);
  else if (pedida === "red") clinicaId = null;
  else clinicaId = pedida;
  if (clinicaId === null && !puedeRed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (clinicaId !== null && !clinicas.some((c) => c.id === clinicaId)) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }
  return { clinicas, puedeRed, clinicaId };
}
