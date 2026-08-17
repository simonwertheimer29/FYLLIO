// app/api/automatizacion/semaforo/route.ts
//
// EL NÚMERO QUE SE MIRA (026). El semáforo es el único punto por el que el
// producto entero puede enmudecer, y lo haría en silencio — el tipo de fallo
// que más ha costado. Esta ruta lo hace consultable: cuántos hilos están en
// rojo, por qué motivo y causa, y la lista completa con su edad — que es la
// presión que sustituye a la caducidad descartada (nada expira solo, pero
// envejece a la vista). Si `enRojo` sube sin que suban las conversaciones,
// algo va mal.
//
// Solo lectura; el estado se deriva al leer, nunca se persiste.

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { censoSemaforo } from "../../../lib/automatizacion/semaforo";

export const dynamic = "force-dynamic";

export const GET = withPresupuestosAuth(async () => {
  try {
    const censo = await censoSemaforo();
    return NextResponse.json(censo);
  } catch (err) {
    // §10: un fallo aquí es un 500 real, jamás un censo vacío que se lea
    // como «todo en verde».
    console.error("[automatizacion/semaforo]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo calcular el censo del semáforo" }, { status: 500 });
  }
});
