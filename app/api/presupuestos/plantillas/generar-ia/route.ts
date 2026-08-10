// app/api/presupuestos/plantillas/generar-ia/route.ts
// POST — genera el contenido de una plantilla con Claude Haiku.
//
// ─── Lo que estaba mal, y por qué importaba ─────────────────────────────────
//
// Los prompts le pedían al modelo que usara `{nombre}`, `{tratamiento}`,
// `{doctor}` y `{clinica}`: UNA llave, y dos nombres que no existen. El
// renderizador que se usa de verdad (`aplicarVariables`) **solo sustituye
// {{…}}**, y su vocabulario es `nombre_doctor` / `nombre_clinica`. O sea: toda
// plantilla generada con IA nacía rota, y se enviaba al paciente con las llaves
// puestas — «Hola {nombre}». Es MEJORAS 74, esta vez desde el otro lado.
//
// Se reescribe con el vocabulario real y se re-indexa por CATEGORÍA, que es la
// clasificación que queda viva tras unificar los dos editores (MEJORAS 13). El
// `tipo` seguía siendo el del editor viejo.
//
// Nota operativa: esto necesita ANTHROPIC_API_KEY y hoy los créditos están
// agotados (bloqueo declarado en ESTADO.md), así que el botón devuelve un error
// honesto hasta que se recarguen. Se prefiere eso a esconderlo: el día que haya
// créditos, funciona sin tocar nada.

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import type { PlantillaCategoria } from "../../../../lib/plantillas/plantillas";

/** Las únicas variables que el renderizador sabe sustituir. Si esta lista y la
 *  de `resolveValoresParaPaciente` se separan, el modelo escribe variables que
 *  llegan literales al paciente. */
const VARIABLES =
  "{{nombre}}, {{tratamiento}}, {{importe}}, {{pendiente}}, {{nombre_doctor}}, " +
  "{{nombre_clinica}}, {{fecha_aceptado}}, {{plazo_dias}}, {{dias_vencido}}";

const REGLAS = `
- Escribe en español, tuteando (decisión de producto, ver PLANTILLAS-WHATSAPP.md).
- Breve: 2 o 3 frases. Sin emojis.
- Nada coloquial y nada que pida perdón por escribir.
- Usa SOLO estas variables, con DOS llaves, tal cual: ${VARIABLES}
- No inventes otras variables: cualquier cosa entre llaves que no esté en esa
  lista llega al paciente con las llaves puestas.
- Devuelve únicamente el texto de la plantilla, sin comillas ni explicación.`;

const PROMPTS: Record<
  PlantillaCategoria,
  (ctx: { doctor?: string; tratamiento?: string; clinica?: string }) => string
> = {
  cobranza: (ctx) =>
    `Redacta una plantilla de WhatsApp para recordar un pago pendiente a un paciente de clínica dental${
      ctx.tratamiento ? ` con un tratamiento de ${ctx.tratamiento}` : ""
    }.
El mensaje debe dar por hecho que puede haber pagado ya y ofrecer comprobarlo antes de reclamar, para que un recordatorio no se convierta en una queja.${REGLAS}`,

  lead_seguimiento: (ctx) =>
    `Redacta una plantilla de WhatsApp de seguimiento para un paciente de clínica dental que recibió un presupuesto${
      ctx.tratamiento ? ` de ${ctx.tratamiento}` : ""
    }${ctx.doctor ? ` con ${ctx.doctor}` : ""} y todavía no ha respondido.
El mensaje debe ser amable y sin presión, y dejar claro que puede preguntar lo que quiera.${REGLAS}`,

  cita_recordatorio: (ctx) =>
    `Redacta una plantilla de WhatsApp para recordar una cita a un paciente de clínica dental${
      ctx.clinica ? ` en ${ctx.clinica}` : ""
    }.
El mensaje debe recordar la cita y ofrecer cambiarla sin fricción si no puede venir.${REGLAS}`,
};

export const POST = withPresupuestosAuth(async (session, req: Request) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { categoria, doctor, tratamiento, clinica } = body as {
      categoria: PlantillaCategoria;
      doctor?: string;
      tratamiento?: string;
      clinica?: string;
    };

    if (!categoria || !PROMPTS[categoria]) {
      return NextResponse.json(
        { error: `categoría inválida. Permitidas: ${Object.keys(PROMPTS).join(", ")}` },
        { status: 400 },
      );
    }

    const prompt = PROMPTS[categoria]({ doctor, tratamiento, clinica });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      // El motivo se RENDERIZA, no se concatena (§9): un 400 por créditos
      // agotados y un 500 del proveedor piden cosas distintas de quien lo lee.
      const detalle = await res.text().catch(() => "");
      console.error("[plantillas/generar-ia] API error:", res.status, detalle.slice(0, 300));
      return NextResponse.json(
        {
          error:
            res.status === 400 || res.status === 429
              ? "El servicio de IA no está disponible ahora mismo (puede ser saldo agotado). La plantilla se puede escribir a mano."
              : `El servicio de IA respondió ${res.status}`,
        },
        { status: 502 },
      );
    }

    const data = await res.json();
    const contenido = (data.content?.[0]?.text ?? "").trim();
    if (!contenido) {
      return NextResponse.json({ error: "La IA devolvió una plantilla vacía" }, { status: 502 });
    }

    return NextResponse.json({ contenido });
  } catch (err) {
    console.error("[plantillas/generar-ia] error:", err);
    return NextResponse.json({ error: "Error al generar plantilla" }, { status: 500 });
  }
});
