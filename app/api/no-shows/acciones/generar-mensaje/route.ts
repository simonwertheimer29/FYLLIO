// app/api/no-shows/acciones/generar-mensaje/route.ts
// POST: genera mensaje WhatsApp personalizado con IA para un paciente
// Body: { patientName, treatmentName, riskScore?, riskLevel?, category, hora? }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch { return null; }
}

const SYSTEM_HIGH = `Eres un coordinador de pacientes de una clínica dental en España.
Escribe UN mensaje de WhatsApp urgente para confirmar una cita de riesgo alto de no-show.
REGLAS ESTRICTAS:
- Exactamente 2-3 frases. Nada más.
- Usa solo el primer nombre del paciente.
- Menciona el tratamiento y la hora si se proporcionan.
- Tono: urgente pero cordial, nunca agresivo.
- Solo español. Sin "Estimado/a". Sin emojis al inicio.
- Termina con pregunta directa de confirmación.`;

const SYSTEM_MEDIUM = `Eres un coordinador de pacientes de una clínica dental en España.
Escribe UN recordatorio WhatsApp amable para una cita.
REGLAS ESTRICTAS:
- Exactamente 2-3 frases. Nada más.
- Usa solo el primer nombre del paciente.
- Menciona el tratamiento y la hora si se proporcionan.
- Tono: cordial y cercano.
- Solo español. Sin "Estimado/a". Sin emojis al inicio.
- Termina pidiendo confirmación.`;

const SYSTEM_RECALL = `Eres un coordinador de pacientes de una clínica dental en España.
Escribe UN mensaje WhatsApp para reconectar con un paciente en tratamiento activo que lleva tiempo sin agendar.
REGLAS ESTRICTAS:
- Exactamente 2-3 frases. Nada más.
- Usa solo el primer nombre del paciente.
- Menciona el tratamiento en curso.
- Tono: motivacional, cálido, sin presión.
- Solo español. Sin "Estimado/a". Sin emojis al inicio.
- Termina con propuesta de agendar.`;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const { patientName, treatmentName, riskScore, riskLevel, category, hora } =
      await req.json();

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return NextResponse.json({ mensaje: "", error: "ANTHROPIC_API_KEY no configurada" });
    }

    const firstName = ((patientName ?? "Paciente") as string).split(" ")[0];

    const systemPrompt =
      category === "RECALL"   ? SYSTEM_RECALL :
      riskLevel === "HIGH"    ? SYSTEM_HIGH   :
      SYSTEM_MEDIUM;

    const userPrompt = [
      `Paciente: ${firstName}`,
      `Tratamiento: ${treatmentName ?? "consulta"}`,
      riskScore != null ? `Score de riesgo: ${riskScore}/100` : null,
      hora          ? `Hora de la cita: ${hora}`               : null,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":          apiKey,
        "anthropic-version":  "2023-06-01",
        "content-type":       "application/json",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system:     systemPrompt,
        messages:   [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ mensaje: "", error: `API ${res.status}: ${errBody}` });
    }

    const data    = await res.json();
    const mensaje: string = data.content?.[0]?.text?.trim() ?? "";
    return NextResponse.json({ mensaje });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ mensaje: "", error: message });
  }
}
