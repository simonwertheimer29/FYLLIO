// app/api/presupuestos/kanban/[id]/route.ts
// PATCH: actualizar campos de un presupuesto

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { updatePresupuestoRaw, findPresupuestoRaw } from "../../../../lib/presupuestos/repo";
import { base, TABLES } from "../../../../lib/airtable";
import { sendPushToClinica } from "../../../../lib/push/sender";
import { registrarAccion } from "../../../../lib/historial/registrar";
import { crearNotificacion } from "../../../../lib/presupuestos/notificaciones";
import { crearPago } from "../../../../lib/pagos";
import { findUserByEmail } from "../../../../lib/auth/users";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { verificarPresupuestoPermitido } from "../../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

export const PATCH = withPresupuestosAuth(
  async (session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    // Sprint B Fase 4 (IDOR): solo se puede modificar un presupuesto de una
    // clínica del usuario (evita editar el pipeline de otra clínica por id).
    const permiso = await verificarPresupuestoPermitido(session, id);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const body = await req.json();

    // Pago del cierre («Aceptó y pagó»): opcional, solo acompaña a ACEPTADO.
    // Se valida ANTES de escribir nada para no dejar el cambio a medias.
    if (body.pago !== undefined) {
      if (body.estado !== "ACEPTADO") {
        return NextResponse.json(
          { error: "El pago solo puede registrarse al aceptar" },
          { status: 400 },
        );
      }
      const imp = body.pago?.importe;
      if (typeof imp !== "number" || !Number.isFinite(imp) || imp <= 0) {
        return NextResponse.json({ error: "Importe del pago debe ser > 0" }, { status: 400 });
      }
    }

    const fields: Record<string, unknown> = {};
    // Only write to fields that exist in the base Airtable schema
    if (body.estado !== undefined) fields["Estado"] = body.estado;
    if (body.faseSeguimiento !== undefined) fields["Fase_seguimiento"] = body.faseSeguimiento;
    if (body.fechaPresupuesto !== undefined) fields["Fecha"] = body.fechaPresupuesto;
    if (body.amount !== undefined) fields["Importe"] = Number(body.amount);
    if (body.treatments !== undefined) {
      fields["Tratamiento_nombre"] = Array.isArray(body.treatments)
        ? body.treatments.join(" + ")
        : body.treatments;
    }
    if (body.notes !== undefined) fields["Notas"] = body.notes;
    if (body.motivoPerdida !== undefined) fields["MotivoPerdida"] = body.motivoPerdida;
    if (body.motivoPerdidaTexto !== undefined) fields["MotivoPerdidaTexto"] = body.motivoPerdidaTexto;
    if (body.motivoDuda !== undefined) fields["MotivoDuda"] = body.motivoDuda;
    if (body.origenLead !== undefined) fields["OrigenLead"] = body.origenLead;
    if (body.reactivacion !== undefined) fields["Reactivacion"] = body.reactivacion === true;
    if (body.portalEnviado !== undefined) fields["PortalEnviado"] = body.portalEnviado === true;

    // Cierre completo en UNA escritura: aceptar/perder no es solo el Estado.
    // ACEPTADO estampa Fecha_Aceptado (si no la tenía — no se reescribe la
    // historia si ya estaba aceptado) y cierra el seguimiento; PERDIDO cierra
    // el seguimiento. Sin esto, los KPIs de cobros leían fecha vacía y la cola
    // seguía mostrando "Esperando respuesta" en presupuestos ya cerrados.
    let recPrevio: Awaited<ReturnType<typeof findPresupuestoRaw>> | null = null;
    if (body.estado === "ACEPTADO" || body.estado === "PERDIDO") {
      if (fields["Fase_seguimiento"] === undefined) fields["Fase_seguimiento"] = "Cerrado";
    }
    if (body.estado === "ACEPTADO") {
      recPrevio = await findPresupuestoRaw(id);
      const fPrev = (recPrevio as any).fields as Record<string, unknown>;
      if (!fPrev["Fecha_Aceptado"]) {
        fields["Fecha_Aceptado"] = DateTime.now().setZone(ZONE).toISODate();
      }
    }

    await updatePresupuestoRaw(id, fields);

    // Pago del cierre: DESPUÉS de persistir el estado. Si el pago falla, el
    // estado ya quedó guardado y se responde honesto (pagoRegistrado:false)
    // para que la UI avise — nunca un éxito falso ni un catch silencioso.
    let pagoRegistrado: boolean | undefined;
    if (body.estado === "ACEPTADO" && body.pago) {
      pagoRegistrado = false;
      try {
        const fPrev = (recPrevio as any).fields as Record<string, unknown>;
        const pacienteId = Array.isArray(fPrev["Paciente_Link"])
          ? String((fPrev["Paciente_Link"] as string[])[0] ?? "")
          : "";
        if (!pacienteId) throw new Error("presupuesto sin paciente vinculado");
        const total = typeof fPrev["Importe"] === "number" ? (fPrev["Importe"] as number) : null;
        // Auditoría de quién registró: la sesión legacy no lleva userId;
        // se resuelve por email (best-effort, el pago no depende de ello).
        const usuario = await findUserByEmail(session.email).catch(() => null);
        await crearPago({
          pacienteId,
          importe: body.pago.importe,
          metodo:
            typeof body.pago.metodo === "string" && body.pago.metodo.trim()
              ? body.pago.metodo
              : undefined,
          tipo: total != null && total > 0 && body.pago.importe < total ? "Senal" : "Liquidacion",
          nota: "Registrado al aceptar el presupuesto",
          usuarioCreadorId: usuario?.id,
        });
        pagoRegistrado = true;
      } catch (err) {
        console.error("[kanban PATCH] pago del cierre NO registrado:", err);
      }
    }

    // Registrar cambio de estado en historial
    if (body.estado !== undefined) {
      await registrarAccion({
        presupuestoId: id,
        tipo: "cambio_estado",
        descripcion: `Estado cambiado a ${body.estado}`,
        metadata: { estadoNuevo: body.estado },
        registradoPor: session.nombre || session.email,
      });

      // Sprint 16b Bloque 1 — emitir evento al motor de automatizaciones.
      // Disparamos en cualquier cambio de estado para que el trigger
      // presupuesto_presentado lo evalúe; las condiciones de la regla
      // filtran por estado=PRESENTADO.
      void (async () => {
        try {
          const { emitirEvento } = await import(
            "../../../../lib/automatizaciones/engine"
          );
          const rec = await findPresupuestoRaw(id);
          const f = (rec as any).fields as Record<string, unknown>;
          await emitirEvento({
            tipo: "presupuesto_actualizado",
            entidadTipo: "Presupuesto",
            entidadId: id,
            payload: {
              clinicaId: typeof f["Clinica"] === "string" ? f["Clinica"] : null,
              estado: body.estado,
              pacienteId: Array.isArray(f["Paciente_Link"])
                ? (f["Paciente_Link"] as string[])[0] ?? null
                : null,
              importe: typeof f["Importe"] === "number" ? f["Importe"] : null,
            },
          });
        } catch (err) {
          console.error("[automatizaciones updatePresupuesto] emit falló:", err);
        }
      })();
    }

    // Evento A: push + notificación cuando se acepta un presupuesto
    if (body.estado === "ACEPTADO") {
      try {
        const rec = recPrevio ?? (await findPresupuestoRaw(id));
        const f = (rec as any).fields as Record<string, unknown>;
        const patientName = Array.isArray(f["Paciente_nombre"])
          ? String((f["Paciente_nombre"] as unknown[])[0] ?? "Paciente")
          : "Paciente";
        const importe = f["Importe"] ? `€${Number(f["Importe"]).toLocaleString("es-ES")}` : "";
        const clinica = f["Clinica"] ? String(f["Clinica"]) : "";
        const result = await sendPushToClinica(clinica, {
          title: "✅ Presupuesto aceptado",
          body: `${patientName} aceptó su presupuesto${importe ? ` de ${importe}` : ""}${clinica ? ` — ${clinica}` : ""}`,
          url: "/presupuestos",
          tag: `aceptado-${id}`,
        });
        console.log("[kanban PATCH] push aceptado →", result);

        // Notificación in-app
        crearNotificacion({
          tipo: "Presupuesto_aceptado",
          titulo: `Presupuesto aceptado: ${patientName}`,
          mensaje: `${patientName} aceptó su presupuesto${importe ? ` de ${importe}` : ""}`,
        }).catch(() => {});
      } catch (pushErr) {
        console.error("[kanban PATCH] push error:", pushErr);
      }
    }

    return NextResponse.json({
      ok: true,
      ...(pagoRegistrado !== undefined ? { pagoRegistrado } : {}),
    });
  } catch (err) {
    // P0.6: una escritura fallida devuelve error real (500), nunca un {ok:true}
    // falso. Antes esto respondía "demo mode" con 200 y el cambio se perdía en
    // silencio (el cliente creía que se guardó). El cliente hace rollback ante !ok.
    console.error("[kanban PATCH] error:", err);
    return NextResponse.json({ error: "No se pudo actualizar el presupuesto" }, { status: 500 });
  }
});
