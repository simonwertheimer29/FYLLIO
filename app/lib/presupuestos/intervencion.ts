// app/lib/presupuestos/intervencion.ts
// Utilidades compartidas para la Cola de Intervención:
// clasificación IA de respuestas de pacientes y persistencia en Airtable.

import { base, TABLES } from "../airtable";
import { registrarAccion } from "../historial/registrar";
import { construirMapaAnonimizacion, anonimizarTexto, desanonimizarTexto } from "../anonimizacion";
import { DateTime } from "luxon";
import type {
  ClasificacionIA,
  IntencionDetectada,
  UrgenciaIntervencion,
  PresupuestoEstado,
} from "./types";

const ZONE = "Europe/Madrid";

const SYSTEM_PROMPT_CLASIFICAR = `Eres un asistente de una clínica dental española. Analizas respuestas de pacientes sobre presupuestos de tratamiento dental.

Tu tarea es:
1. Clasificar la intención del paciente en UNA de estas opciones:
   - "Acepta sin condiciones"
   - "Acepta pero pregunta pago"
   - "Tiene duda sobre tratamiento"
   - "Pide oferta/descuento"
   - "Quiere pensarlo"
   - "Rechaza"
   - "Sin clasificar"

2. Asignar urgencia de intervención:
   - "CRÍTICO": acepta o pregunta pago → cerrar venta ya
   - "ALTO": duda concreta sobre tratamiento o pide oferta
   - "MEDIO": quiere pensarlo, sin respuesta clara
   - "BAJO": rechazo definitivo o sin información suficiente

3. Sugerir una acción específica y breve (3-6 palabras)

4. Redactar un mensaje de respuesta por WhatsApp (máximo 3 frases, tono cálido y profesional, sin emojis, firmado por la clínica, usa solo el primer nombre del paciente)

RESPONDE EXCLUSIVAMENTE con un JSON válido con estos campos exactos:
{
  "intencion": "...",
  "urgencia": "...",
  "accionSugerida": "...",
  "mensajeSugerido": "..."
}

NO añadas texto fuera del JSON.`;

const VALID_INTENCIONES: IntencionDetectada[] = [
  "Acepta sin condiciones",
  "Acepta pero pregunta pago",
  "Tiene duda sobre tratamiento",
  "Pide oferta/descuento",
  "Quiere pensarlo",
  "Rechaza",
  "Sin clasificar",
];

const VALID_URGENCIAS: UrgenciaIntervencion[] = ["CRÍTICO", "ALTO", "MEDIO", "BAJO", "NINGUNO"];

/**
 * Llama a Claude Haiku para clasificar la respuesta de un paciente.
 * Devuelve la clasificación o un fallback seguro si falla el parsing.
 */
export async function clasificarRespuesta(args: {
  respuestaPaciente: string;
  patientName: string;
  treatments: string[];
  estado: PresupuestoEstado;
  amount?: number;
  clinica?: string;
}): Promise<ClasificacionIA> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return {
      intencion: "Sin clasificar",
      urgencia: "MEDIO",
      accionSugerida: "Revisar manualmente",
      mensajeSugerido: "",
    };
  }

  const firstName = args.patientName.split(" ")[0];

  // Anonimizar clínica si existe
  const clinicas = args.clinica ? [args.clinica] : [];
  const mapa = construirMapaAnonimizacion(clinicas);

  const userPrompt = anonimizarTexto(
    [
      `Paciente: ${firstName}`,
      `Tratamiento: ${args.treatments.join(", ")}`,
      `Importe: ${args.amount != null ? "€" + args.amount.toLocaleString("es-ES") : "no especificado"}`,
      `Estado actual: ${args.estado}`,
      args.clinica ? `Clínica: ${args.clinica}` : null,
      ``,
      `Respuesta del paciente:`,
      `"${args.respuestaPaciente}"`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    mapa
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
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
        system: SYSTEM_PROMPT_CLASIFICAR,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[intervencion] Claude API error:", res.status, await res.text());
      return fallbackClasificacion();
    }

    const data = await res.json();
    const text: string = data.content?.[0]?.text?.trim() ?? "";

    // Intentar parsear JSON (Claude puede envolver en ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[intervencion] No JSON found in response:", text);
      return fallbackClasificacion();
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const intencion = VALID_INTENCIONES.includes(parsed.intencion)
      ? (parsed.intencion as IntencionDetectada)
      : "Sin clasificar";

    const urgencia = VALID_URGENCIAS.includes(parsed.urgencia)
      ? (parsed.urgencia as UrgenciaIntervencion)
      : "MEDIO";

    // Desanonimizar el mensaje sugerido
    const mensajeSugerido = desanonimizarTexto(
      String(parsed.mensajeSugerido ?? ""),
      mapa
    );

    return {
      intencion,
      urgencia,
      accionSugerida: String(parsed.accionSugerida ?? "Revisar manualmente").slice(0, 100),
      mensajeSugerido,
    };
  } catch (err) {
    console.error("[intervencion] clasificarRespuesta error:", err);
    return fallbackClasificacion();
  } finally {
    clearTimeout(timeoutId);
  }
}

function fallbackClasificacion(): ClasificacionIA {
  return {
    intencion: "Sin clasificar",
    urgencia: "MEDIO",
    accionSugerida: "Revisar manualmente",
    mensajeSugerido: "",
  };
}

/**
 * Persiste la clasificación y la respuesta del paciente en Airtable.
 */
export async function guardarClasificacion(args: {
  presupuestoId: string;
  respuestaPaciente: string;
  clasificacion: ClasificacionIA;
  registradoPor?: string;
}): Promise<void> {
  const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

  try {
    await base(TABLES.presupuestos as any).update(args.presupuestoId, {
      Ultima_respuesta_paciente: args.respuestaPaciente,
      Fecha_ultima_respuesta: now,
      Intencion_detectada: args.clasificacion.intencion,
      Urgencia_intervencion: args.clasificacion.urgencia,
      Accion_sugerida: args.clasificacion.accionSugerida,
      Mensaje_sugerido: args.clasificacion.mensajeSugerido,
      Fase_seguimiento: "En intervención",
    } as any);
  } catch (err) {
    console.error("[intervencion] guardarClasificacion Airtable error:", err);
  }

  await registrarAccion({
    presupuestoId: args.presupuestoId,
    tipo: "contacto",
    descripcion: `Respuesta clasificada: ${args.clasificacion.intencion} (${args.clasificacion.urgencia})`,
    metadata: {
      intencion: args.clasificacion.intencion,
      urgencia: args.clasificacion.urgencia,
      accionSugerida: args.clasificacion.accionSugerida,
      respuestaPaciente: args.respuestaPaciente.slice(0, 200),
    },
    registradoPor: args.registradoPor,
  });
}

/**
 * Genera un mensaje sugerido IA para un presupuesto sin usar clasificación.
 * Útil para pre-cargar mensajes en la cola.
 */
export async function generarMensajeSugerido(args: {
  patientName: string;
  treatments: string[];
  estado: PresupuestoEstado;
  amount?: number;
  intencion?: IntencionDetectada;
  clinica?: string;
}): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return "";

  const firstName = args.patientName.split(" ")[0];
  const clinicas = args.clinica ? [args.clinica] : [];
  const mapa = construirMapaAnonimizacion(clinicas);

  const userPrompt = anonimizarTexto(
    [
      `Genera un mensaje de WhatsApp para retomar contacto con ${firstName}.`,
      `Tratamiento: ${args.treatments.join(", ")}`,
      `Importe: ${args.amount != null ? "€" + args.amount.toLocaleString("es-ES") : "no especificado"}`,
      args.intencion ? `Intención detectada: ${args.intencion}` : null,
      args.clinica ? `Clínica: ${args.clinica}` : null,
      `Escribe 2-3 frases, tono cálido y profesional, sin emojis. Solo español.`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    mapa
  );

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: "Eres un coordinador de ventas de una clínica dental en España. Escribe UN mensaje de WhatsApp breve (2-3 frases), en español, sin emojis, tono cálido y profesional.",
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) return "";

    const data = await res.json();
    const mensaje = desanonimizarTexto(
      data.content?.[0]?.text?.trim() ?? "",
      mapa
    );
    return mensaje;
  } catch {
    return "";
  }
}
