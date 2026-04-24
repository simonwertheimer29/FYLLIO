// app/lib/alertas/templates.ts
// Sprint 8 D.7 — plantillas de mensaje por tipo de alerta.

// Sprint 9 G.6: añadido "asistencias" (sustituye la semántica previa de
// "citados" ahora que Citados Hoy deja de ser un estado real en el
// pipeline de Leads). "citados" se mantiene en el enum solo por
// compatibilidad con registros históricos en Airtable.
export type TipoAlerta =
  | "leads"
  | "presupuestos"
  | "citados"
  | "asistencias"
  | "automatizaciones";

const TEMPLATES: Record<TipoAlerta, string> = {
  leads:
    "Hola {nombre}, en {clinica} hay {n} leads nuevos sin gestionar. Por favor, revisa Fyllio cuando puedas.",
  presupuestos:
    "Hola {nombre}, en {clinica} hay {n} presupuestos sin seguimiento desde hace más de 48 horas. Necesitan atención.",
  citados:
    "Hola {nombre}, quedaron {n} pacientes citados hoy sin marcar como asistidos. Por favor actualiza el estado.",
  asistencias:
    "Hola {nombre}, en {clinica} quedan {n} asistencias sin cerrar (citas pasadas sin marcar como asistido ni como no-asistió). Revisa Leads cuando puedas.",
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
