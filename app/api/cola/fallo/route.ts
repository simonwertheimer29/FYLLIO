// app/api/cola/fallo/route.ts
//
// POST /api/cola/fallo — el «failure callback» de QStash: nos llama cuando un
// trabajo agotó sus reintentos. Es la COLA DE FALLOS VISIBLE que pedía el plan
// (MEJORAS 164): el trabajo queda en `incidencias` con su referencia, va a la
// campana siempre (un turno sin evaluar tras varios intentos no es ruido) y
// se ve en Ajustes › Incidencias. El mensaje del paciente sigue guardado y
// visible como «Sin evaluar»; el barrido (163) lo vuelve a intentar.
//
// Firmado por QStash igual que /api/cola/trabajo. Responde 200 siempre que la
// firma sea válida: un callback que falla se reintenta, y aquí no hay nada que
// reintentar.

import { NextResponse } from "next/server";
import { runWithCliente } from "../../../lib/airtable";
import { verificarFirmaQStash, parseTrabajo, RUTA_FALLO } from "../../../lib/cola/qstash";
import { registrarIncidencia } from "../../../lib/incidencias";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type FalloQStash = {
  status?: number;
  retried?: number;
  maxRetries?: number;
  sourceMessageId?: string;
  dlqId?: string;
  url?: string;
  /** Base64 del cuerpo que publicamos. */
  sourceBody?: string;
  /** Base64 de la última respuesta de nuestro endpoint. */
  body?: string;
};

function desdeBase64(s: string | undefined): string | null {
  if (!s) return null;
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!(await verificarFirmaQStash(req, body, RUTA_FALLO))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let aviso: FalloQStash;
  try {
    aviso = JSON.parse(body) as FalloQStash;
  } catch {
    console.error("[cola/fallo] callback malformado");
    return NextResponse.json({ ok: false, motivo: "malformado" });
  }
  const original = desdeBase64(aviso.sourceBody);
  const trabajo = original ? parseTrabajo(original) : null;
  if (!trabajo) {
    console.error("[cola/fallo] fallo sin trabajo reconocible", {
      status: aviso.status ?? null,
      qstashId: aviso.sourceMessageId ?? null,
      url: aviso.url ?? null,
    });
    return NextResponse.json({ ok: false, motivo: "sin_trabajo" });
  }
  const { cliente, entrada } = trabajo;
  await runWithCliente(cliente, () =>
    registrarIncidencia({
      tipo: "cola",
      motivo: "reintentos_agotados",
      origen: "cola/fallo",
      clinicaId: entrada.clinicaId ?? null,
      referencia: entrada.mensajeId,
      detalle: {
        status: aviso.status ?? null,
        intentos: (aviso.retried ?? 0) + 1,
        max_reintentos: aviso.maxRetries ?? null,
        qstash_id: aviso.sourceMessageId ?? null,
        dlq_id: aviso.dlqId ?? null,
      },
      reintentable: true,
      avisar: "siempre",
      aviso: {
        titulo: "Un turno del agente no se pudo evaluar tras varios intentos",
        mensaje:
          "El mensaje está guardado y visible en Mensajería (filtro «Sin evaluar»); el barrido lo volverá a intentar. Detalle en Ajustes › Incidencias.",
        link: "/ajustes/incidencias",
      },
    }),
  );
  return NextResponse.json({ ok: true });
}
