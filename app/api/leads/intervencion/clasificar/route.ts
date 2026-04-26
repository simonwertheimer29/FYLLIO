// app/api/leads/intervencion/clasificar/route.ts
//
// Sprint 10 B — clasifica la respuesta de un lead usando Anthropic Haiku.
// Devuelve { intencion, accionSugerida, mensajeSugerido }, persiste los
// 3 campos en la tabla Leads y deja log en Acciones_Lead.
//
// Categorías (cerradas con Simon, distintas de presupuestos):
// Interesado / Pide más info / Pregunta precio / Pide cita / No interesado /
// Sin clasificar.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getLead, updateLead, type LeadIntencion } from "../../../../lib/leads/leads";
import { logAccionLead } from "../../../../lib/leads/acciones";

export const dynamic = "force-dynamic";

const INTENCIONES_LEAD: LeadIntencion[] = [
  "Interesado",
  "Pide más info",
  "Pregunta precio",
  "Pide cita",
  "No interesado",
  "Sin clasificar",
];

const SYSTEM_PROMPT = `Eres un coordinador de ventas de una clínica dental en España.
Acabas de recibir un mensaje de WhatsApp de un lead (potencial paciente que aún
no tiene presupuesto). Clasifica su respuesta y sugiere cómo responder.

Reglas de clasificación (devolver EXACTAMENTE una de estas etiquetas):
- "Interesado": el lead muestra interés general sin preguntas concretas.
- "Pide más info": pregunta detalles del tratamiento, duración, técnica, materiales.
- "Pregunta precio": pregunta importe, financiación o coste.
- "Pide cita": pide hueco/horario/día concreto para venir a la clínica.
- "No interesado": rechaza, dice que ya no le interesa o pide que no le contacten.
- "Sin clasificar": no encaja claramente en ninguna anterior.

Salida estricta — devuelve SOLO un JSON con esta forma exacta:
{
  "intencion": "Interesado" | "Pide más info" | "Pregunta precio" | "Pide cita" | "No interesado" | "Sin clasificar",
  "accionSugerida": "frase corta (≤80 chars) en español describiendo qué hacer ahora",
  "mensajeSugerido": "respuesta WA al lead, 2-3 frases en español, tono cordial, sin Estimado/a, sin emojis al inicio"
}
Sin texto adicional fuera del JSON.`;

type ClasificacionLead = {
  intencion: LeadIntencion;
  accionSugerida: string;
  mensajeSugerido: string;
};

async function clasificarConIA(args: {
  leadNombre: string;
  tratamiento: string | null;
  canal: string | null;
  estadoPipeline: string;
  ultimoMensaje: string;
}): Promise<ClasificacionLead | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return null;

  const firstName = args.leadNombre.split(" ")[0] ?? args.leadNombre;
  const userPrompt = [
    `Lead: ${firstName}`,
    args.tratamiento ? `Tratamiento de interés: ${args.tratamiento}` : null,
    args.canal ? `Canal de captación: ${args.canal}` : null,
    `Estado pipeline: ${args.estadoPipeline}`,
    `Último mensaje del lead: """${args.ultimoMensaje}"""`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    console.error("[leads/clasificar] Anthropic", res.status);
    return null;
  }
  const data = await res.json();
  const raw: string = data.content?.[0]?.text?.trim() ?? "";
  // El modelo a veces envuelve en ```json ...```. Limpiamos.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as ClasificacionLead;
    if (!INTENCIONES_LEAD.includes(parsed.intencion)) {
      parsed.intencion = "Sin clasificar";
    }
    return parsed;
  } catch {
    console.error("[leads/clasificar] JSON parse fallido:", cleaned.slice(0, 200));
    return null;
  }
}

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => null);
  const leadId = body?.leadId as string | undefined;
  const respuestaPaciente = body?.respuestaPaciente as string | undefined;
  if (!leadId || !respuestaPaciente?.trim()) {
    return NextResponse.json({ error: "leadId y respuestaPaciente requeridos" }, { status: 400 });
  }

  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const clasificacion = await clasificarConIA({
    leadNombre: lead.nombre,
    tratamiento: lead.tratamiento,
    canal: lead.canal,
    estadoPipeline: lead.estado,
    ultimoMensaje: respuestaPaciente.trim(),
  });

  if (!clasificacion) {
    return NextResponse.json(
      { error: "No se pudo clasificar (IA no disponible o respuesta inválida)" },
      { status: 502 },
    );
  }

  // Cachear en la tabla Leads.
  const updated = await updateLead(leadId, {
    intencionDetectada: clasificacion.intencion,
    mensajeSugerido: clasificacion.mensajeSugerido,
    accionSugerida: clasificacion.accionSugerida,
  });

  // Log estructurado.
  logAccionLead({
    leadId,
    tipo: "Nota",
    usuarioId: session.userId,
    detalles: `Clasificación IA: ${clasificacion.intencion} — ${clasificacion.accionSugerida}`,
  }).catch(() => {});

  return NextResponse.json({ ok: true, clasificacion, lead: updated });
});
