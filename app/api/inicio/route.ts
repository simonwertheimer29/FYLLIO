// app/api/inicio/route.ts
//
// INICIO (rediseño 31-08) — los cinco bloques en una llamada. Scoping igual
// que /api/red/dashboard (fail-closed): admin → toda la red; coordinación →
// sus clínicas; ?clinica= verificado contra lo accesible (403, jamás «sin
// filtro»). `esRed` decide el bloque 3 y el rol de la pantalla: una clínica
// (accesible única o filtro activo) ve 0, 1, 1 y 2 con sus datos.
//
// Tras responder, si falta la FOTO de hoy del bloque «dinero parado» para
// este alcance, se guarda en segundo plano (after(): prescindible, §1) — así
// el delta vs hace 7 días existe aunque el cron de un día falle.

import { NextResponse, after } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { listClinicaIdsForUser } from "../../lib/auth/users";
import { runWithCliente } from "../../lib/airtable";
import { calcularInicio, faltaFotoDeHoy, guardarFotoInicio } from "../../lib/inicio/calcular";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    return await runWithCliente(session.cliente, async () => {
      const accesibles = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
      const pedida = new URL(req.url).searchParams.get("clinica");
      let clinicaIds: string[] | null = accesibles;
      if (pedida) {
        if (accesibles !== null && !accesibles.includes(pedida)) {
          return NextResponse.json({ error: "Clínica no accesible" }, { status: 403 });
        }
        clinicaIds = [pedida];
      }
      const esRed = clinicaIds === null || clinicaIds.length > 1;
      const t0 = Date.now();
      const data = await calcularInicio({ clinicaIds, esRed });
      const ms = Date.now() - t0;

      after(async () => {
        try {
          await runWithCliente(session.cliente!, async () => {
            if (await faltaFotoDeHoy({ clinicaIds, esRed })) await guardarFotoInicio({ clinicaIds, esRed });
          });
        } catch (e) {
          console.error("[inicio] foto de hoy:", e instanceof Error ? e.message : e);
        }
      });

      return NextResponse.json({ ...data, calculadoEnMs: ms });
    });
  } catch (err) {
    console.error("[inicio] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo calcular Inicio" }, { status: 500 });
  }
});
