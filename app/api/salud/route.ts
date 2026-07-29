// app/api/salud/route.ts
//
// "¿Este entorno está sirviendo datos REALES?" — la pregunta que no se podía
// responder desde fuera el 2026-07-29, cuando producción llevaba semanas
// sirviendo listas vacías y datos inventados sin que nada lo dijera.
//
// Devuelve el estado del contrato de entorno y una lectura REAL de la base
// (cuenta filas, no hace ping): un entorno puede tener todas las variables y
// aun así no llegar a los datos.
//
// Requiere sesión: no es un endpoint público. No devuelve ningún valor de
// ninguna variable, solo si está o no.

import { NextResponse } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { revisarEntorno } from "../../lib/entorno";
import { listPacientes } from "../../lib/pacientes/pacientes";
import { selectPresupuestosRaw } from "../../lib/presupuestos/repo";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const entorno = revisarEntorno();

  // Lectura real: si esto devuelve 0 en un entorno con datos, algo está mal
  // aunque el entorno esté completo.
  let datos: { pacientes: number; presupuestos: number } | null = null;
  let errorDatos: string | null = null;
  try {
    const [pacientes, presupuestos] = await Promise.all([
      listPacientes({}),
      selectPresupuestosRaw({ fields: ["Estado"] }),
    ]);
    datos = { pacientes: pacientes.length, presupuestos: presupuestos.length };
  } catch (err) {
    errorDatos = err instanceof Error ? err.message : "error desconocido";
  }

  const sano = entorno.ok && !!datos && !errorDatos;
  return NextResponse.json(
    {
      sano,
      cliente: session.cliente,
      entorno: {
        ok: entorno.ok,
        faltanCriticas: entorno.faltanCriticas.map((r) => r.nombre),
        faltanFuncionales: entorno.faltanFuncionales.map((r) => r.nombre),
      },
      datos,
      errorDatos,
    },
    { status: sano ? 200 : 503 },
  );
});
