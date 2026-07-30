// app/api/portal/[token]/route.ts
// GET — devuelve los datos públicos del presupuesto para el portal del paciente
// Ruta pública (sin auth del CRM)

import { NextResponse } from "next/server";
import { kv } from "../../../lib/kv";
import { runWithCliente } from "../../../lib/airtable";
import type { PortalData } from "../../presupuestos/[id]/generar-portal/route";
import { sendPushToClinica } from "../../../lib/push/sender";
import { registrarAccion } from "../../../lib/historial/registrar";
import { eur } from "../../../lib/dinero";

const KV_PREFIX = "portal:";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "Token requerido" }, { status: 400 });

  let data: PortalData | null;
  try {
    data = await kv.get<PortalData>(KV_PREFIX + token);
  } catch (err) {
    // KV caído no es "este enlace no existe": para el paciente son cosas
    // opuestas (una se reintenta, la otra se pide de nuevo a la clínica).
    console.error("[portal] KV inaccesible:", err);
    return NextResponse.json({ error: "no_disponible" }, { status: 503 });
  }

  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (new Date(data.expiresAt) < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Marcar como visto si es la primera vez
  if (!data.visto) {
    const d = data;
    await kv.set(KV_PREFIX + token, {
      ...d,
      visto: true,
      vistoAt: new Date().toISOString(),
    } as PortalData, {
      // `Math.max(…, 1)`: dentro del último segundo de vida el TTL salía 0, que
      // para KV significa "sin expiración" — el token habría vivido para siempre.
      ex: Math.max(Math.floor((new Date(d.expiresAt).getTime() - Date.now()) / 1000), 1),
    });

    // Aviso al equipo + rastro en el historial. Los DOS necesitan contexto de
    // cliente y esta ruta no lo fijaba nunca: `base()` sin contexto lanza (§3) y
    // el `.catch(() => {})` se lo comía, así que "portal visto" NO se registraba
    // jamás y el aviso no salía. El cliente sale del token, igual que en
    // `responder`. Sigue siendo best-effort —el paciente no debe ver un error
    // porque falle un aviso interno— pero ahora el fallo se ve (§9).
    if (d.cliente) {
      void runWithCliente(d.cliente, async () => {
        await sendPushToClinica(d.clinica ?? "", {
          title: "Portal abierto",
          body: `${d.patientName} acaba de abrir su presupuesto${d.amount != null ? ` de ${eur(d.amount)}` : ""}`,
          url: "/presupuestos",
          tag: `portal-${token}`,
        }).catch((err) => console.error("[portal] aviso de portal abierto falló:", err));
        await registrarAccion({
          presupuestoId: d.presupuestoId,
          tipo: "portal_visto",
          descripcion: `${d.patientName} abrió el portal`,
          clinica: d.clinica ?? "",
        }).catch((err) => console.error("[portal] registro de portal visto falló:", err));
      });
    } else {
      console.error("[portal] token sin cliente: no se registra la apertura", token);
    }
  }

  // Solo datos públicos: ni ids internos ni el cliente que viaja en el token.
  return NextResponse.json({
    patientName: data.patientName,
    treatments: data.treatments,
    amount: data.amount,
    clinica: data.clinica,
    clinicaTelefono: data.clinicaTelefono,
    doctor: data.doctor,
    tipoPaciente: data.tipoPaciente,
    tieneAseguradora: data.tieneAseguradora ?? false,
    descripcionHumanizada: data.descripcionHumanizada,
    expiresAt: data.expiresAt,
    respondido: data.respondido,
    respuesta: data.respuesta,
  });
}
