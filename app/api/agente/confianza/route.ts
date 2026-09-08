// app/api/agente/confianza/route.ts
// GET /api/agente/confianza?dias=30[&clinica=id] — la confianza en el agente
// (plan maestro 2.4): la vara y lo que dicen las conversaciones reales por
// clínica. Scoping igual que Inicio (fail-closed): admin → la red; otro rol →
// sus clínicas; ?clinica= verificado contra lo accesible (403, jamás «sin
// filtro»). Solo lee lo persistido: ni una llamada al modelo.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { requireCliente } from "../../../lib/cliente-contexto";
import { confianzaDe, CONFIANZA_DIAS } from "../../../lib/agente/confianza";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const diasRaw = Number(url.searchParams.get("dias") ?? CONFIANZA_DIAS);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(Math.round(diasRaw), 1), 365) : CONFIANZA_DIAS;
  try {
    return await runWithCliente(session.cliente, async () => {
      const accesibles = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
      const pedida = url.searchParams.get("clinica");
      let clinicaIds: string[] | null = accesibles;
      if (pedida) {
        if (accesibles !== null && !accesibles.includes(pedida)) {
          return NextResponse.json({ error: "Clínica no accesible" }, { status: 403 });
        }
        clinicaIds = [pedida];
      }
      const data = await confianzaDe({ cliente: requireCliente("agente/confianza"), clinicaIds, ahora: new Date(), dias });
      return NextResponse.json({ ...data, esRed: clinicaIds === null || clinicaIds.length > 1 });
    });
  } catch (err) {
    // §4/§10 — error real. Un cero aquí se leería como «el agente no acierta nunca».
    console.error("[agente/confianza]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer la confianza del agente" }, { status: 500 });
  }
});
