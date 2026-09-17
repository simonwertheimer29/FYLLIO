// app/api/agente/oferta/route.ts
//
// PROPONER HORAS AL PACIENTE (17-09, 060 — bucle ofrecer → elegir). POST
// { telefono, alternativas, tratamientoId, variante?, texto?, previsualizar? }.
// Con `previsualizar` devuelve solo el texto EXACTO que saldría (la
// coordinadora lo ve entero antes de pulsar); sin él, lo envía —y exige que
// `texto` coincida—. La lógica vive en lib/agenda/ofertas.ts: el QA de punta
// a punta recorre lo mismo que este clic. Mismo acceso que la ficha.
import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { fichaDeCaso } from "../../../lib/agente/ficha-caso";
import { puedeVerHiloSesion } from "../../../lib/agente/acceso-hilo-sesion";
import { crearOferta, textoDeOferta, MENSAJE_MOTIVO_OFERTA, MAX_ALTERNATIVAS, type VarianteOferta } from "../../../lib/agenda/ofertas";
import type { Alternativa } from "../../../lib/agenda/ofertas-textos";

export const dynamic = "force-dynamic";

const esAlternativa = (a: unknown): a is Alternativa => {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return typeof o["fecha"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o["fecha"]) && typeof o["hora"] === "string" && /^\d{2}:\d{2}$/.test(o["hora"]) && typeof o["doctorId"] === "string";
};

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const telefono = String(body?.["telefono"] ?? "").trim();
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  const alternativasRaw = Array.isArray(body?.["alternativas"]) ? body!["alternativas"] : [];
  if (!alternativasRaw.every(esAlternativa)) return NextResponse.json({ error: "Alternativas ilegibles" }, { status: 400 });
  const alternativas = alternativasRaw as Alternativa[];
  if (alternativas.length > MAX_ALTERNATIVAS) return NextResponse.json({ error: MENSAJE_MOTIVO_OFERTA["demasiadas"] }, { status: 400 });
  const tratamientoId = typeof body?.["tratamientoId"] === "string" && body["tratamientoId"] ? (body["tratamientoId"] as string) : null;
  const v = body?.["variante"] as Record<string, unknown> | undefined;
  const variante: VarianteOferta | undefined =
    v?.["tipo"] === "se_ocupo" && esAlternativa(v["ocupada"]) ? { tipo: "se_ocupo", ocupada: v["ocupada"] } : v?.["tipo"] === "todas_ocupadas" ? { tipo: "todas_ocupadas" } : undefined;
  const texto = typeof body?.["texto"] === "string" ? (body["texto"] as string) : undefined;
  const previsualizar = body?.["previsualizar"] === true;

  try {
    return await runWithCliente(session.cliente, async () => {
      if (!(await puedeVerHiloSesion(session, telefono))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      const ficha = await fichaDeCaso(telefono);
      if (!ficha.lead) return NextResponse.json({ error: "Este caso no tiene un lead abierto." }, { status: 409 });
      if (previsualizar) {
        const t = await textoDeOferta({ nombre: ficha.lead.nombre, alternativas, tratamientoId, variante });
        return NextResponse.json({ texto: t });
      }
      const r = await crearOferta({ telefono, leadId: ficha.lead.id, alternativas, tratamientoId, variante, texto });
      if (!r.ok) {
        return NextResponse.json(
          { error: MENSAJE_MOTIVO_OFERTA[r.motivo] ?? r.motivo, motivo: r.motivo, ocupadas: r.ocupadas ?? null, libres: r.libres ?? null, esperado: r.esperado ?? null },
          { status: r.motivo === "ocupadas" || r.motivo === "texto_no_coincide" ? 409 : r.motivo === "fallo_envio" ? 502 : 400 },
        );
      }
      return NextResponse.json({ ok: true, oferta: { id: r.oferta.id, caducaEnISO: r.oferta.caducaEn.toISOString() }, simulado: r.simulado, modo: r.modo });
    });
  } catch (err) {
    console.error("[agente/oferta]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo enviar la propuesta" }, { status: 500 });
  }
});
