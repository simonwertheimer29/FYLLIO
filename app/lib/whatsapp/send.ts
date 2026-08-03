// app/lib/whatsapp/send.ts
// Envío saliente de WhatsApp por la API REST de Twilio (sin paquete npm).
//
// §1 — un envío que falla NUNCA vuelve como éxito. Esta función LANZA.
//
// Antes devolvía `Promise<void>` y se tragaba los dos fallos posibles (falta de
// configuración y error HTTP de Twilio): logueaba y volvía normalmente. Sus cinco
// callers ya tenían `try/catch` con su contador de errores, así que ese manejo
// llevaba meses MUERTO: `sent++` contaba mensajes que no salieron, `errors[]`
// salía siempre vacío, y el motor de no-shows emitía `mensaje_enviado` y consumía
// el cooldown por un mensaje que nadie recibió. Es el mismo patrón que el Sprint A
// mató en las escrituras (`7399c55`), sobreviviendo en los envíos — la única capa
// donde no se había mirado. Censado el 2026-08-03 y arreglado en frío: los envíos
// Twilio están apagados hoy (`CRON_TWILIO_WHATSAPP`).

/** Fallo de envío. `entregaRechazada` distingue los dos casos que el caller trata distinto. */
export class EnvioWhatsAppError extends Error {
  /**
   * `true`  → sabemos con certeza que el mensaje NO salió (falta configuración, o
   *           Twilio respondió con un status de error). Es seguro compensar:
   *           liberar una clave de dedup, no consumir un cooldown, reintentar.
   * `false` → no lo sabemos (la petición falló antes de tener respuesta: red,
   *           timeout, DNS). Pudo haber salido igualmente. §2 — NO se reintenta a
   *           ciegas ni se libera un dedup, porque eso duplica el mensaje al paciente.
   */
  readonly entregaRechazada: boolean;
  readonly status?: number;
  readonly codigoTwilio?: number;

  constructor(
    message: string,
    opts: { entregaRechazada: boolean; status?: number; codigoTwilio?: number },
  ) {
    super(message);
    this.name = "EnvioWhatsAppError";
    this.entregaRechazada = opts.entregaRechazada;
    this.status = opts.status;
    this.codigoTwilio = opts.codigoTwilio;
  }
}

/**
 * Extrae de la respuesta de error de Twilio lo que sirve para actuar (`code` y
 * `message` — p. ej. 21211 "Invalid 'To' Phone Number") sin volcar el cuerpo
 * entero: §9 pide que el error se RENDERICE, no que se concatene.
 */
function detalleTwilio(texto: string): { codigo?: number; detalle: string } {
  try {
    const j = JSON.parse(texto) as { code?: number; message?: string };
    if (j && typeof j.message === "string") {
      return {
        codigo: typeof j.code === "number" ? j.code : undefined,
        detalle: j.message.slice(0, 200),
      };
    }
  } catch {
    /* cuerpo no-JSON: cae al genérico */
  }
  return { detalle: "sin detalle legible en la respuesta" };
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // p. ej. "whatsapp:+14155238886"

  // §3 — sin secreto no se sigue. Y esto no es transitorio: si falta una env var
  // fallan TODOS los envíos, así que tiene que verse en el primero y no enterrarse
  // en un warn que nadie lee (§9).
  if (!accountSid || !authToken || !from) {
    const faltan = [
      !accountSid && "TWILIO_ACCOUNT_SID",
      !authToken && "TWILIO_AUTH_TOKEN",
      !from && "TWILIO_WHATSAPP_FROM",
    ]
      .filter(Boolean)
      .join(", ");
    throw new EnvioWhatsAppError(
      `WhatsApp no enviado: faltan variables de entorno (${faltan})`,
      { entregaRechazada: true },
    );
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({ From: from, To: to, Body: body });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (err) {
    // La petición no llegó a tener respuesta. Twilio pudo aceptarla igualmente:
    // `entregaRechazada: false` para que nadie compense por nosotros.
    throw new EnvioWhatsAppError(
      `WhatsApp no confirmado: la petición a Twilio falló sin respuesta (${err instanceof Error ? err.message : String(err)})`,
      { entregaRechazada: false },
    );
  }

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    const { codigo, detalle } = detalleTwilio(texto);
    throw new EnvioWhatsAppError(
      `WhatsApp no enviado: Twilio HTTP ${res.status}${codigo ? ` (code ${codigo})` : ""} — ${detalle}`,
      { entregaRechazada: true, status: res.status, codigoTwilio: codigo },
    );
  }
}
