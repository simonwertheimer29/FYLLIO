// app/api/presupuestos/[id]/generar-portal/route.ts
// POST — genera token de portal para que el paciente acepte/rechace su presupuesto
//
// Returns: { url, token, expiresAt }

import { NextResponse } from "next/server";
import { getPresupuestoPorIdRaw } from "../../../../lib/presupuestos/repo";
import { kv } from "../../../../lib/kv";
import { randomBytes } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { registrarAccion } from "../../../../lib/historial/registrar";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas, permiteClinica } from "../../../../lib/presupuestos/clinica-scope";
import { esAseguradora } from "../../../../lib/pacientes/tipos-paciente";
import { getPaciente } from "../../../../lib/pacientes/pacientes";
import type { Cliente } from "../../../../lib/airtable";

const TTL_DAYS = 90;

export interface PortalData {
  /** Cliente dueño del presupuesto, GUARDADO AL GENERAR. El portal es público
   *  y no tiene sesión de la que derivarlo: si no viaja aquí, quien responda no
   *  sabe en qué base escribir. Antes se resolvía a `PILOT_CLIENTE` (RB) para
   *  todo el mundo, así que aceptar un presupuesto de cualquier otro cliente
   *  escribía cero filas bajo RLS y el paciente leía "gracias por aceptar"
   *  mientras el kanban no se enteraba (mandamiento §6). */
  cliente: Cliente;
  presupuestoId: string;
  patientName: string;
  treatments: string[];
  amount?: number;
  clinica?: string;
  clinicaTelefono?: string;
  doctor?: string;
  tipoPaciente?: string;
  /** ¿Ese tipo es una ASEGURADORA? Se resuelve aquí, donde hay contexto de
   *  cliente, y viaja en el payload: el portal es público y no puede consultar
   *  el catálogo. Antes el portal comparaba `tipoPaciente === "Adeslas"`, así
   *  que un paciente de Sanitas habría dejado de ver su desglose de cobertura
   *  sin que nadie se enterara (spec 2026-07-29, punto 5). */
  tieneAseguradora?: boolean;
  descripcionHumanizada?: string;
  createdAt: string;
  expiresAt: string;
  visto: boolean;
  vistoAt?: string;
  respondido: boolean;
  respuesta?: "aceptado" | "rechazado";
  respondidoAt?: string;
  motivo?: string;
  firmaTexto?: string;
}

const KV_PREFIX = "portal:";

async function generarDescripcion(treatments: string[]): Promise<string> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return "";
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `Describe este tratamiento dental en 2-3 líneas en español cercano, sin jerga médica, como si se lo explicaras a un amigo. Tratamiento: ${treatments.join(", ")}. Incluye qué es, cómo funciona brevemente, y un beneficio concreto. Sin bullets, solo texto seguido.`,
      }],
    });
    return (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
  } catch {
    return "";
  }
}

export const POST = withPresupuestosAuth(
  async (session, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  // `withPresupuestosAuth` ya devuelve 401 sin cliente; se estrecha aquí porque
  // el token no puede nacer sin él (si naciera, nadie podría responderlo).
  const cliente = session.cliente;
  if (!cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    // Fetch presupuesto data from Airtable
    const rec0 = await getPresupuestoPorIdRaw(id);
    const recs = rec0 ? [rec0] : [];

    const token = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 86400 * 1000).toISOString();

    // Sprint B Fase 4 (IDOR): clínicas permitidas del usuario.
    const permitidas = await nombresClinicasPermitidas(session);

    if (recs.length === 0) {
      // 404 para TODOS, sin excepción de rol. Aquí vivía un "demo fallback"
      // (solo para roles sin restricción de clínica) que fabricaba un paciente
      // llamado "Paciente Demo" con una ortodoncia de 4.200 € en una "Clínica
      // Demo", lo guardaba en KV y devolvía un enlace que FUNCIONABA: un admin
      // podía mandarle a un paciente real un presupuesto inventado. La barrida
      // de datos demo del 2026-07-29 (MEJORAS 59) no lo cazó porque esta puerta
      // no la gobernaba una variable de entorno, sino `recs.length === 0`.
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const f = recs[0].fields as Record<string, unknown>;
    const patientName = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "Paciente")
      : "Paciente";
    const treatmentRaw = f["Tratamiento_nombre"] ? String(f["Tratamiento_nombre"]) : "";
    const treatments = treatmentRaw
      ? treatmentRaw.split(/[,+]/).map((t) => t.trim()).filter(Boolean)
      : [];
    const amount = f["Importe"] ? Number(f["Importe"]) : undefined;
    const clinica = f["Clinica"] ? String(f["Clinica"]) : undefined;
    // Sprint B Fase 4 (IDOR): el presupuesto debe ser de una clínica del usuario.
    if (!permiteClinica(permitidas, clinica ?? "")) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const doctor = f["Doctor"] ? String(f["Doctor"]) : undefined;

    // El tipo sale del PACIENTE, no de la copia del presupuesto.
    //
    // `presupuestos.tipo_paciente` es una instantánea que se HEREDA al crear y
    // que los KPIs históricos consumen, pero dejó de ser fuente el 2026-07-29:
    // el tipo es propiedad de la persona. Leyendo la copia, corregir la mutua de
    // un paciente no cambiaba lo que el paciente ve en su enlace — y el enlace
    // se genera DESPUÉS de cualquier corrección. Lo cazó `npm run qa:portal`
    // (comprobación 3 del espejo: poner "Privado" en la persona seguía
    // enseñándole el bloque de cobertura de su mutua anterior).
    // Si el presupuesto tiene paciente, MANDA el paciente — incluso si no tiene
    // tipo: "sin tipo" es una respuesta ("no hay mutua"), no un hueco que
    // rellenar con el valor viejo. La copia solo se usa para los presupuestos
    // huérfanos anteriores al alta por buscador, donde es lo único que hay.
    const pacienteId = Array.isArray(f["Paciente_Link"])
      ? String((f["Paciente_Link"] as string[])[0] ?? "")
      : "";
    const pac = pacienteId ? await getPaciente(pacienteId) : null;
    const tipoPaciente = pac
      ? (pac.tipoPaciente ?? undefined)
      : f["TipoPaciente"]
        ? String(f["TipoPaciente"])
        : undefined;
    // "¿tiene aseguradora?", no "¿se llama Adeslas?".
    const tieneAseguradora = await esAseguradora(tipoPaciente ?? null);

    // Generate humanized description in parallel with saving
    const descripcionHumanizada = await generarDescripcion(treatments);

    const data: PortalData = {
      cliente,
      presupuestoId: id,
      patientName,
      treatments,
      amount,
      clinica,
      clinicaTelefono: undefined,   // No clinic phone in Airtable yet
      doctor,
      tipoPaciente,
      tieneAseguradora,
      descripcionHumanizada,
      createdAt: now.toISOString(),
      expiresAt,
      visto: false,
      respondido: false,
    };

    await kv.set(KV_PREFIX + token, data, { ex: TTL_DAYS * 86400 });

    registrarAccion({
      presupuestoId: id,
      tipo: "portal_generado",
      descripcion: "Portal de presupuesto generado",
      metadata: { token },
      clinica: clinica ?? "",
    }).catch(() => {});

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return NextResponse.json({ url: `${appUrl}/presupuesto/${token}`, token, expiresAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
