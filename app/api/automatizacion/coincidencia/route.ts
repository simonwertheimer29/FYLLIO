// app/api/automatizacion/coincidencia/route.ts
// GET — la tasa de coincidencia agente-humano, agregada.
//
// Responde a la pregunta que decide si el agente puede pasar a enviar solo:
// de los mensajes que preparó, ¿cuántos salieron tal cual?
//
// La agregación se hace con la función pura compartida (`resumirCoincidencia`),
// no en SQL: el umbral que separa «editado» de «reescrito» vive en un solo sitio
// y se puede recalibrar sin tocar la base ni perder histórico.

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { enviosMedidos, enviosSinSugerido } from "../../../lib/automatizacion/pg";
import { resumirCoincidencia } from "../../../lib/automatizacion/coincidencia";

export const dynamic = "force-dynamic";

/** Lunes de la semana de una fecha, en ISO corto — para agrupar la evolución. */
function semanaDe(iso: string): string {
  const d = new Date(iso);
  const dia = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

export const GET = withPresupuestosAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const dias = Math.min(365, Math.max(7, Number(url.searchParams.get("dias")) || 90));

  try {
    const [envios, sinSugerido] = await Promise.all([
      enviosMedidos(dias),
      enviosSinSugerido(dias),
    ]);

    const total = resumirCoincidencia(envios.map((e) => e.distancia));

    // ── Por intención ──
    // Los envíos sin intención NO se reparten ni se ocultan: van a su propia
    // fila («sin clasificar»). Repartirlos inventaría un desglose.
    const porIntencion = new Map<string, number[]>();
    for (const e of envios) {
      const k = e.intencion ?? "(sin clasificar)";
      if (!porIntencion.has(k)) porIntencion.set(k, []);
      porIntencion.get(k)!.push(e.distancia);
    }

    // ── Por dominio ──
    const porTipo = new Map<string, number[]>();
    for (const e of envios) {
      if (!porTipo.has(e.tipoCaso)) porTipo.set(e.tipoCaso, []);
      porTipo.get(e.tipoCaso)!.push(e.distancia);
    }

    // ── Evolución semanal ──
    const porSemana = new Map<string, number[]>();
    for (const e of envios) {
      const k = semanaDe(e.creadoAt);
      if (!porSemana.has(k)) porSemana.set(k, []);
      porSemana.get(k)!.push(e.distancia);
    }

    const aFilas = (m: Map<string, number[]>) =>
      [...m.entries()]
        .map(([clave, ds]) => ({ clave, ...resumirCoincidencia(ds) }))
        .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      dias,
      total,
      /** Envíos que NO entran en el denominador porque no hubo sugerido. Se
       *  devuelve SIEMPRE para que la pantalla pueda enseñar el denominador
       *  entero, que es la regla del producto. */
      sinSugerido,
      porIntencion: aFilas(porIntencion),
      porTipo: aFilas(porTipo),
      evolucion: [...porSemana.entries()]
        .map(([semana, ds]) => ({ semana, ...resumirCoincidencia(ds) }))
        .sort((a, b) => a.semana.localeCompare(b.semana)),
    });
  } catch (err) {
    // §4/§10 — un fallo devuelve error real. Nunca un cero, que aquí se leería
    // como «el agente no acierta nunca» en vez de «no se pudo preguntar».
    console.error("[automatizacion/coincidencia]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo cargar la coincidencia" }, { status: 500 });
  }
});
