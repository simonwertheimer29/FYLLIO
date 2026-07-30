// app/api/portal/[token]/responder/route.ts
// POST — el paciente acepta o rechaza su presupuesto desde el portal público
//
// Body: { accion: 'aceptar'|'rechazar', motivo?, firmaTexto? }

import { NextResponse } from "next/server";
import { updatePresupuestoRaw } from "../../../../lib/presupuestos/repo";
import { kv } from "../../../../lib/kv";
import { runWithCliente } from "../../../../lib/airtable";
import type { PortalData } from "../../../presupuestos/[id]/generar-portal/route";
import { registrarAccion } from "../../../../lib/historial/registrar";

const KV_PREFIX = "portal:";

// El cliente sale del TOKEN, no de una constante. Antes esto envolvía todo en
// `runWithCliente(PILOT_CLIENTE)` = RB: como RB está vacío y los presupuestos
// vivos son de otros clientes, el UPDATE caía fuera de lo que RLS deja ver y
// afectaba a cero filas sin lanzar nada. El paciente leía "gracias por
// aceptar" y el kanban no cambiaba. Ahora el token dice de quién es
// (`PortalData.cliente`) y `actualizarUna` afirma que la fila se escribió.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: "Token requerido" }, { status: 400 });

  let data: PortalData | null;
  try {
    data = await kv.get<PortalData>(KV_PREFIX + token);
  } catch (err) {
    // KV caído no es "el enlace no existe": son cosas opuestas para el paciente.
    console.error("[portal responder] KV inaccesible:", err);
    return NextResponse.json({ error: "no_disponible" }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!data.cliente) {
    // Fail-closed (§3): sin cliente en el token no se puede saber en qué base
    // escribir, y adivinarlo es exactamente el bug que esto arregla.
    console.error("[portal responder] token sin cliente:", token);
    return NextResponse.json({ error: "enlace_caducado_regenerar" }, { status: 409 });
  }

  return runWithCliente(data.cliente, () => responderPortal(req, token, data!));
}

async function responderPortal(
  req: Request,
  token: string,
  data: PortalData,
): Promise<NextResponse> {
  try {
    if (new Date(data.expiresAt) < new Date()) {
      return NextResponse.json({ error: "expired" }, { status: 410 });
    }
    if (data.respondido) {
      return NextResponse.json({ error: "ya_respondido" }, { status: 409 });
    }

    const body = await req.json() as {
      accion: "aceptar" | "rechazar";
      motivo?: string;
      firmaTexto?: string;
    };

    if (!body.accion || !["aceptar", "rechazar"].includes(body.accion)) {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // ORDEN (mandamiento §1: persistir antes de confirmar): primero se
    // escribe el presupuesto; solo si se guardó se marca el token como
    // respondido. Antes era al revés con el fallo tragado: el paciente veía
    // "gracias por aceptar" y el kanban no se enteraba nunca. Si el update
    // falla, 500 honesto y el token queda vivo → el paciente puede reintentar
    // (el update es idempotente: mismo estado y notas re-escritas).
    // Cierre completo, igual que el PATCH del kanban: Fecha_Aceptado alimenta
    // los KPIs de cobros; Fase_seguimiento "Cerrado" saca el presupuesto de
    // la cola. El pago NO se registra aquí: el paciente aceptó online,
    // cobrar es un paso de la clínica.
    if (body.accion === "aceptar") {
      // `Notas` NO se toca. Antes se escribía ahí la firma, y `Notas` es un
      // campo de texto ÚNICO: aceptar desde el portal borraba lo que la
      // coordinadora hubiera escrito sobre el caso. La firma vive en el
      // historial, que es su sitio (abajo, y esperada).
      await updatePresupuestoRaw(data.presupuestoId, {
        Estado: "ACEPTADO",
        Fecha_Aceptado: now.slice(0, 10),
        Fase_seguimiento: "Cerrado",
      } as any);
    } else {
      await updatePresupuestoRaw(data.presupuestoId, {
        Estado: "PERDIDO",
        Fase_seguimiento: "Cerrado",
        MotivoPerdida: body.motivo ?? "otro",
        // Lenguaje de coordinadora, no un marcador con corchetes: quien lea la
        // card tiene que entender de un vistazo que lo rechazó el paciente.
        MotivoPerdidaTexto: `Rechazado por el paciente desde el portal${body.motivo ? `: ${body.motivo}` : ""}`,
      } as any);
    }

    // La firma y el motivo se PERSISTEN antes de confirmar (§1): son el rastro
    // de que el paciente aceptó, no telemetría — y no hay columna donde vivan.
    // `obligatorio` porque registrarAccion por defecto se traga su propio fallo:
    // sin esto, un `await` daba una falsa sensación de garantía. Si falla, 500
    // honesto y el token sigue vivo para reintentar; un reintento puede dejar dos
    // entradas en el historial (log append-only), preferible a perder la firma.
    await registrarAccion({
      obligatorio: true,
      presupuestoId: data.presupuestoId,
      tipo: body.accion === "aceptar" ? "portal_aceptado" : "portal_rechazado",
      descripcion:
        body.accion === "aceptar"
          ? `Paciente aceptó el presupuesto desde el portal${body.firmaTexto ? ` · firma: ${body.firmaTexto}` : ""}`
          : "Paciente rechazó el presupuesto desde el portal",
      metadata: { motivo: body.motivo, firmaTexto: body.firmaTexto },
      clinica: data.clinica ?? "",
    });

    const updated: PortalData = {
      ...data,
      respondido: true,
      respuesta: body.accion === "aceptar" ? "aceptado" : "rechazado",
      respondidoAt: now,
      motivo: body.motivo,
      firmaTexto: body.firmaTexto,
    };
    const remainingSeconds = Math.max(
      Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
      1
    );
    await kv.set(KV_PREFIX + token, updated, { ex: remainingSeconds });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
