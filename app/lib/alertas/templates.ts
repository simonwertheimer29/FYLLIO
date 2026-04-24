// app/lib/alertas/templates.ts
// Sprint 8 D.7 — plantillas de mensaje por tipo de alerta.

export type TipoAlerta = "leads" | "presupuestos" | "citados" | "automatizaciones";

const TEMPLATES: Record<TipoAlerta, string> = {
  leads:
    "Hola {nombre}, en {clinica} hay {n} leads nuevos sin gestionar. Por favor, revisa Fyllio cuando puedas.",
  presupuestos:
    "Hola {nombre}, en {clinica} hay {n} presupuestos sin seguimiento desde hace más de 48 horas. Necesitan atención.",
  citados:
    "Hola {nombre}, quedaron {n} pacientes citados hoy sin marcar como asistidos. Por favor actualiza el estado.",
  automatizaciones:
    "Hola {nombre}, hay {n} automatizaciones con error en {clinica}. Revísalas en la pestaña Automatizaciones.",
};

export function renderAlertaMessage(
  tipo: TipoAlerta,
  ctx: { nombre: string; clinica: string; n: number }
): string {
  return TEMPLATES[tipo]
    .replaceAll("{nombre}", ctx.nombre.split(" ")[0] ?? ctx.nombre)
    .replaceAll("{clinica}", ctx.clinica)
    .replaceAll("{n}", String(ctx.n));
}
