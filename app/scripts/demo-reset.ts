// app/scripts/demo-reset.ts
//
// Reset COMPLETO de la base DEMO: vacía TODAS las tablas de negocio y siembra
// un dataset único y coherente que cubre todo lo demostrable del producto
// (cola Actuar hoy en 3 prioridades + esperando respuesta, kanban de leads y
// presupuestos en todos los estados, conversaciones WhatsApp clasificadas,
// KPIs cuadrados, automatizaciones con historial, cobros, citas).
//
// Se ejecuta ANTES de cada presentación: las fechas son relativas al momento
// de ejecución ("hace 2 días" siempre es hace 2 días), así la demo no envejece.
//
//   npm run demo:reset          # wipe total + seed
//   npm run demo:reset -- --dry # simula: cuenta lo que borraría/crearía
//
// SOLO toca la base DEMO (AIRTABLE_BASE_ID). Guardas fail-closed:
//   · aborta si AIRTABLE_BASE_ID coincide con RB / INDEP / CENTRAL
//   · todo corre bajo runWithCliente("DEMO")
//   · la identidad (base central: usuarios/clínicas Cliente=DEMO) NO se toca
//     (eso vive en demo-seed.ts y ya está sembrada)
//
// SEGURIDAD DE AUTOMATIZACIONES: las reglas se siembran con Modo_Test=true y
// un Paciente_Test_Id inexistente → el engine termina en `skipped_test` ANTES
// de ejecutar acciones (engine.ts:100). Los Eventos_Sistema se siembran con
// Procesado=true para que el cron no tenga nada que procesar. El historial de
// disparos se siembra como registros pasados, sin ejecutar nada.
//
// Los fallos NUNCA son silenciosos: cualquier error aborta con exit 1 y deja
// dicho qué tabla falló. Reejecutar es seguro: el wipe deja la base a cero.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runWithCliente, base, fetchAll } from "../lib/airtable";

// ⛔ CONGELADO (corte a Postgres, 2026-07-22): Airtable es el rollback de solo
// lectura este mes. Este script ESCRIBE en Airtable → deshabilitado para no
// tocar el rollback por accidente. El seed de DEMO vive ahora en
// scripts/db-seed-demo-rico.mjs (Postgres); `npm run demo:reset` apunta a él.
// Escape hatch consciente (bajo tu riesgo): PERMITIR_SEED_AIRTABLE=1.
if (process.env.PERMITIR_SEED_AIRTABLE !== "1") {
  console.error("⛔ demo-reset.ts DESHABILITADO: Airtable congelado como rollback tras el corte a Postgres.");
  console.error("   Usa `npm run demo:reset` (siembra DEMO en Postgres). Forzar Airtable: PERMITIR_SEED_AIRTABLE=1.");
  process.exit(1);
}

const DRY = process.argv.includes("--dry");

// ─── Guardas fail-closed ─────────────────────────────────────────────────────

function assertSoloBaseDemo(): void {
  const demo = process.env.AIRTABLE_BASE_ID;
  if (!process.env.AIRTABLE_API_KEY) throw new Error("Falta AIRTABLE_API_KEY.");
  if (!demo) throw new Error("Falta AIRTABLE_BASE_ID (base DEMO).");
  for (const v of ["AIRTABLE_BASE_RB", "AIRTABLE_BASE_INDEP", "AIRTABLE_BASE_CENTRAL"]) {
    if (process.env[v] && process.env[v] === demo) {
      throw new Error(`ABORTADO: AIRTABLE_BASE_ID coincide con ${v}. Este script solo puede correr contra la base DEMO.`);
    }
  }
}

// ─── Utilidades de tiempo (todo relativo a AHORA) ────────────────────────────

const NOW = Date.now();
const MS_DIA = 864e5;
const MS_HORA = 36e5;

/** ISO hace N días/horas/minutos. */
function hace(dias: number, horas = 0, min = 0): string {
  return new Date(NOW - dias * MS_DIA - horas * MS_HORA - min * 6e4).toISOString();
}
/** YYYY-MM-DD con offset de días (0 = hoy, 1 = mañana, -2 = hace dos días). */
function dia(offset: number): string {
  return new Date(NOW + offset * MS_DIA).toISOString().slice(0, 10);
}
/** dateTime local de un día a una hora "HH:MM" (Madrid, verano +02:00). */
function horaLocal(offsetDias: number, hhmm: string): string {
  return `${dia(offsetDias)}T${hhmm}:00+02:00`;
}
/** "YYYY-MM" con offset de meses (0 = mes actual). */
function mes(offset: number): string {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Escritura con lote + errores visibles ───────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let totalCreados = 0;

async function crear(
  tabla: string,
  rows: Array<Record<string, unknown>>,
): Promise<string[]> {
  if (DRY) {
    console.log(`  [dry] ${tabla}: crearía ${rows.length}`);
    return rows.map((_, i) => `dry_${tabla}_${i}`);
  }
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((fields) => ({ fields }));
    try {
      const created = await (base(tabla as any) as any).create(batch);
      ids.push(...created.map((r: any) => r.id));
    } catch (e) {
      throw new Error(`creando en ${tabla} (lote ${i / 10 + 1}): ${(e as Error).message}`);
    }
    await sleep(220);
  }
  totalCreados += ids.length;
  console.log(`  ✓ ${tabla}: ${ids.length}`);
  return ids;
}

// ─── WIPE: las 39 tablas de la base DEMO ─────────────────────────────────────
// Lista tomada del esquema real (metadata API, 2026-07-15). Si Airtable añade
// una tabla nueva, hay que añadirla aquí — preferimos lista explícita a magia.

const TABLAS_WIPE = [
  "Mensajes_WhatsApp", "Secuencias_Automaticas", "Cola_Envios", "Citas",
  "Acciones_Automatizacion", "Lista_de_espera", "Staff", "Tratamientos",
  "Historial_Acciones", "Plantillas_Mensaje", "Informes_Guardados",
  "Configuraciones_Clinica", "Acciones_Pago", "Pagos_Paciente",
  "Objetivos_Mensuales", "Usuarios", "Usuario_Clinicas", "Contactos_Presupuesto",
  "Notificaciones", "Plantillas_Lead", "Sillones", "Push_Subscriptions",
  "Reglas_Automatizacion", "Conversaciones_Copilot", "Eventos_Sistema",
  "Configuracion_WABA", "Configuracion_Recordatorios", "Acciones",
  "Configuracion_Automatizaciones", "Alertas_Enviadas", "Comunicaciones",
  "Eventos de cita", "Inconsistencias_Pagos", "Llamadas_Vapi",
  "Acciones_Lead", "Presupuestos", "Leads", "Pacientes", "Clínicas",
];

async function wipe(): Promise<void> {
  console.log("\n═══ WIPE base DEMO (39 tablas) ═══");
  let totalBorrados = 0;
  for (const t of TABLAS_WIPE) {
    let recs;
    try {
      recs = await fetchAll(base(t as any).select({ fields: [] }));
    } catch (e) {
      throw new Error(`listando ${t}: ${(e as Error).message}`);
    }
    if (recs.length === 0) continue;
    console.log(`  · ${t}: ${recs.length}${DRY ? " (dry, no borra)" : ""}`);
    totalBorrados += recs.length;
    if (DRY) continue;
    const ids = recs.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 10) {
      try {
        await (base(t as any) as any).destroy(ids.slice(i, i + 10));
      } catch (e) {
        throw new Error(`borrando en ${t}: ${(e as Error).message}`);
      }
      await sleep(220);
    }
  }
  console.log(`  ✓ wipe: ${totalBorrados} registros${DRY ? " (simulado)" : " borrados"}`);
}

// ═══ DATASET ═════════════════════════════════════════════════════════════════
// Nombres realistas, sin prefijos ni tags visibles: la base entera es demo,
// el reset es "vaciar todo + resembrar", no hace falta etiquetar nada.

const C_CENTRO = "Clínica Demo Centro";
const C_NORTE = "Clínica Demo Norte";
const C_SUR = "Clínica Demo Sur";
const C_ESTE = "Clínica Demo Este";
// Deben coincidir con las clínicas Cliente=DEMO de la base central (bridge por nombre).
const CLINICAS = [
  { nombre: C_CENTRO, ciudad: "Madrid" },
  { nombre: C_NORTE, ciudad: "Madrid" },
  { nombre: C_SUR, ciudad: "Toledo" },
  { nombre: C_ESTE, ciudad: "Guadalajara" },
];

const STAFF = [
  { nombre: "Dra. Lucía Ferrer", clinica: C_CENTRO, rol: "Dentista" },
  { nombre: "Dr. Andrés Molina", clinica: C_CENTRO, rol: "Dentista" },
  { nombre: "Dra. Paula Iglesias", clinica: C_NORTE, rol: "Dentista" },
  { nombre: "Dr. Sergio Camacho", clinica: C_NORTE, rol: "Dentista" },
  { nombre: "Dra. Marta Villalba", clinica: C_SUR, rol: "Dentista" },
  { nombre: "Dr. Iván Castaño", clinica: C_ESTE, rol: "Dentista" },
  { nombre: "Sara Robles", clinica: C_CENTRO, rol: "Higienista" },
  { nombre: "Noelia Pardo", clinica: C_NORTE, rol: "Higienista" },
];

const TRATAMIENTOS = [
  { nombre: "Revisión general", cat: "Revisión", dur: 20 },
  { nombre: "Limpieza dental", cat: "Limpieza", dur: 30 },
  { nombre: "Blanqueamiento LED", cat: "Limpieza", dur: 45 },
  { nombre: "Empaste composite", cat: "Empaste", dur: 40 },
  { nombre: "Ortodoncia invisible", cat: "Ortodoncia", dur: 45 },
  { nombre: "Brackets metálicos", cat: "Ortodoncia", dur: 45 },
  { nombre: "Endodoncia molar", cat: "Endodoncia", dur: 60 },
  { nombre: "Implante unitario", cat: "Implante", dur: 90 },
  { nombre: "Corona sobre implante", cat: "Implante", dur: 60 },
  { nombre: "Extracción muela del juicio", cat: "Extracción", dur: 45 },
  { nombre: "Urgencia dental", cat: "Urgencia", dur: 30 },
  { nombre: "Férula de descarga", cat: "Revisión", dur: 30 },
];

const SILLONES = [
  { nombre: "Centro S1", clinica: C_CENTRO }, { nombre: "Centro S2", clinica: C_CENTRO },
  { nombre: "Norte S1", clinica: C_NORTE }, { nombre: "Norte S2", clinica: C_NORTE },
  { nombre: "Sur S1", clinica: C_SUR }, { nombre: "Este S1", clinica: C_ESTE },
];

// 25 pacientes. pago/pendiente cuadran con Pagos_Paciente (abajo).
type Pac = {
  nombre: string; clinica: string; tel: string; canal: string;
  trats: string[]; doctor?: string; creadoHaceDias: number;
  total?: number; aceptado?: "Si" | "No" | "Pendiente"; pagado?: number; pendiente?: number; financiado?: number;
};
const PACIENTES: Pac[] = [
  { nombre: "María González", clinica: C_CENTRO, tel: "+34 612 480 316", canal: "Instagram", trats: ["Implantología"], doctor: "Dra. Lucía Ferrer", creadoHaceDias: 45, total: 3480, aceptado: "Si", pagado: 1500, pendiente: 1980 },
  { nombre: "Javier Torres", clinica: C_CENTRO, tel: "+34 634 217 905", canal: "Google Ads", trats: ["Ortodoncia Invisible"], doctor: "Dr. Andrés Molina", creadoHaceDias: 38, total: 2950, aceptado: "Si", pagado: 2950, pendiente: 0 },
  { nombre: "Carmen Ortega", clinica: C_NORTE, tel: "+34 655 903 442", canal: "Referido", trats: ["Endodoncia"], doctor: "Dra. Paula Iglesias", creadoHaceDias: 30, total: 520, aceptado: "Si", pagado: 260, pendiente: 260 },
  { nombre: "Antonio Vidal", clinica: C_SUR, tel: "+34 622 118 764", canal: "Landing Page", trats: ["Corona cerámica"], doctor: "Dra. Marta Villalba", creadoHaceDias: 25, total: 890, aceptado: "Si", pagado: 890, pendiente: 0 },
  { nombre: "Lucía Prados", clinica: C_ESTE, tel: "+34 688 340 271", canal: "Instagram", trats: ["Blanqueamiento"], doctor: "Dr. Iván Castaño", creadoHaceDias: 20, total: 320, aceptado: "Si", pagado: 0, pendiente: 320 },
  { nombre: "Manuel Sáez", clinica: C_CENTRO, tel: "+34 617 552 830", canal: "Google Orgánico", trats: ["Implantología"], doctor: "Dra. Lucía Ferrer", creadoHaceDias: 18, total: 3480, aceptado: "Pendiente" },
  { nombre: "Isabel Marín", clinica: C_CENTRO, tel: "+34 645 209 118", canal: "WhatsApp", trats: ["Ortodoncia"], doctor: "Dr. Andrés Molina", creadoHaceDias: 15, total: 1850, aceptado: "Pendiente" },
  { nombre: "Álvaro Cano", clinica: C_NORTE, tel: "+34 699 874 023", canal: "Facebook", trats: ["Empaste"], doctor: "Dr. Sergio Camacho", creadoHaceDias: 14, total: 140, aceptado: "Pendiente" },
  { nombre: "Rosa Delgado", clinica: C_NORTE, tel: "+34 611 736 594", canal: "Referido", trats: ["Periodoncia"], doctor: "Dra. Paula Iglesias", creadoHaceDias: 12, total: 760, aceptado: "Pendiente" },
  { nombre: "Pablo Herrero", clinica: C_SUR, tel: "+34 636 481 207", canal: "Google Ads", trats: ["Ortodoncia Invisible"], doctor: "Dra. Marta Villalba", creadoHaceDias: 12, total: 2950, aceptado: "Pendiente" },
  { nombre: "Nuria Campos", clinica: C_CENTRO, tel: "+34 654 092 371", canal: "Instagram", trats: ["Revisión"], creadoHaceDias: 10 },
  { nombre: "Jorge Aranda", clinica: C_ESTE, tel: "+34 620 743 985", canal: "Visita directa", trats: ["Limpieza"], creadoHaceDias: 10 },
  { nombre: "Silvia Moya", clinica: C_CENTRO, tel: "+34 691 528 604", canal: "Landing Page", trats: ["Corona cerámica"], doctor: "Dra. Lucía Ferrer", creadoHaceDias: 9, total: 890, aceptado: "Pendiente" },
  { nombre: "Raúl Pastor", clinica: C_NORTE, tel: "+34 613 867 249", canal: "Google Orgánico", trats: ["Endodoncia"], doctor: "Dr. Sergio Camacho", creadoHaceDias: 8, total: 520, aceptado: "Pendiente" },
  { nombre: "Cristina Bosch", clinica: C_SUR, tel: "+34 648 315 972", canal: "Instagram", trats: ["Blanqueamiento"], creadoHaceDias: 7, total: 320, aceptado: "No" },
  { nombre: "Óscar Lara", clinica: C_CENTRO, tel: "+34 675 190 438", canal: "Facebook", trats: ["Implantología"], doctor: "Dra. Lucía Ferrer", creadoHaceDias: 7, total: 3480, aceptado: "Pendiente" },
  { nombre: "Beatriz Solano", clinica: C_ESTE, tel: "+34 626 904 517", canal: "Referido", trats: ["Ortodoncia"], doctor: "Dr. Iván Castaño", creadoHaceDias: 6, total: 1850, aceptado: "No" },
  { nombre: "Fernando Rey", clinica: C_NORTE, tel: "+34 657 231 840", canal: "WhatsApp", trats: ["Empaste"], creadoHaceDias: 5 },
  { nombre: "Alicia Vera", clinica: C_CENTRO, tel: "+34 619 405 762", canal: "Google Ads", trats: ["Ortodoncia Invisible"], doctor: "Dr. Andrés Molina", creadoHaceDias: 5, total: 2950, aceptado: "Pendiente" },
  { nombre: "Hugo Salas", clinica: C_SUR, tel: "+34 684 072 359", canal: "Landing Page", trats: ["Revisión"], creadoHaceDias: 4 },
  { nombre: "Marina Cuevas", clinica: C_CENTRO, tel: "+34 631 856 490", canal: "Instagram", trats: ["Corona cerámica"], doctor: "Dra. Lucía Ferrer", creadoHaceDias: 3, total: 890, aceptado: "Si", pagado: 890, pendiente: 0 },
  { nombre: "Diego Peña", clinica: C_NORTE, tel: "+34 660 394 128", canal: "Google Orgánico", trats: ["Limpieza"], doctor: "Dra. Paula Iglesias", creadoHaceDias: 2 },
  { nombre: "Teresa Galán", clinica: C_ESTE, tel: "+34 645 781 036", canal: "Referido", trats: ["Periodoncia"], creadoHaceDias: 2 },
  { nombre: "Adrián Cobo", clinica: C_CENTRO, tel: "+34 692 615 873", canal: "WhatsApp", trats: ["Otro"], creadoHaceDias: 1 },
  { nombre: "Eva Redondo", clinica: C_SUR, tel: "+34 638 249 501", canal: "Facebook", trats: ["Revisión"], creadoHaceDias: 1 },
];

// 24 presupuestos: todos los estados, edades escalonadas, cola con contenido.
type Pre = {
  id: string; paciente: string; trat: string; importe: number; estado: string;
  fechaHaceDias: number; doctor: string; clinica: string; origen: string;
  tipoPaciente?: string; contactos?: number; fase?: string;
  intencion?: string; urgencia?: string; respuesta?: string; respuestaHaceHoras?: number;
  accionSugerida?: string; mensajeSugerido?: string;
  motivoPerdida?: string; fechaAceptadoHaceDias?: number;
};
const PRESUPUESTOS: Pre[] = [
  // INTERESADO (4)
  { id: "PR-1041", paciente: "Manuel Sáez", trat: "Implante unitario", importe: 3480, estado: "INTERESADO", fechaHaceDias: 1, doctor: "Dra. Lucía Ferrer", clinica: C_CENTRO, origen: "google_ads", contactos: 0, fase: "Inicial" },
  { id: "PR-1042", paciente: "Álvaro Cano", trat: "Empaste composite", importe: 140, estado: "INTERESADO", fechaHaceDias: 2, doctor: "Dr. Sergio Camacho", clinica: C_NORTE, origen: "redes_sociales", contactos: 0, fase: "Inicial" },
  { id: "PR-1043", paciente: "Hugo Salas", trat: "Revisión general", importe: 60, estado: "INTERESADO", fechaHaceDias: 3, doctor: "Dra. Marta Villalba", clinica: C_SUR, origen: "walk_in", contactos: 1, fase: "Inicial" },
  { id: "PR-1044", paciente: "Teresa Galán", trat: "Endodoncia molar", importe: 520, estado: "INTERESADO", fechaHaceDias: 4, doctor: "Dr. Iván Castaño", clinica: C_ESTE, origen: "referido_paciente", contactos: 1, fase: "Inicial" },
  // PRESENTADO (8) — edades escalonadas; mezcla de con/sin respuesta
  { id: "PR-1031", paciente: "Isabel Marín", trat: "Brackets metálicos", importe: 1850, estado: "PRESENTADO", fechaHaceDias: 0, doctor: "Dr. Andrés Molina", clinica: C_CENTRO, origen: "otro", contactos: 1, fase: "Inicial" },
  { id: "PR-1032", paciente: "Rosa Delgado", trat: "Endodoncia molar", importe: 760, estado: "PRESENTADO", fechaHaceDias: 2, doctor: "Dra. Paula Iglesias", clinica: C_NORTE, origen: "referido_paciente", contactos: 1, fase: "Recordatorio 3d", urgencia: "MEDIO", accionSugerida: "Recordatorio suave a los 3 días" },
  { id: "PR-1033", paciente: "Pablo Herrero", trat: "Ortodoncia invisible", importe: 2950, estado: "PRESENTADO", fechaHaceDias: 2, doctor: "Dra. Marta Villalba", clinica: C_SUR, origen: "google_ads", contactos: 2, fase: "En intervención", intencion: "Tiene duda sobre tratamiento", urgencia: "ALTO", respuesta: "¿La ortodoncia invisible duele los primeros días? Me da un poco de respeto.", respuestaHaceHoras: 5, accionSugerida: "Resolver la duda hoy — respuesta reciente", mensajeSugerido: "Hola Pablo, es normal notar presión los 2-3 primeros días, pero no dolor como tal. Si quieres, la Dra. Villalba te lo explica en una llamada de 5 minutos. ¿Te viene bien esta tarde?" },
  { id: "PR-1034", paciente: "Silvia Moya", trat: "Corona sobre implante", importe: 890, estado: "PRESENTADO", fechaHaceDias: 5, doctor: "Dra. Lucía Ferrer", clinica: C_CENTRO, origen: "seo_organico", contactos: 1, fase: "Recordatorio 7d", urgencia: "MEDIO" },
  { id: "PR-1035", paciente: "Raúl Pastor", trat: "Endodoncia molar", importe: 520, estado: "PRESENTADO", fechaHaceDias: 5, doctor: "Dr. Sergio Camacho", clinica: C_NORTE, origen: "seo_organico", contactos: 0, fase: "Recordatorio 7d", urgencia: "MEDIO", accionSugerida: "Presentado hace 5 días sin ningún contacto" },
  { id: "PR-1036", paciente: "Óscar Lara", trat: "Implante unitario", importe: 3480, estado: "PRESENTADO", fechaHaceDias: 7, doctor: "Dra. Lucía Ferrer", clinica: C_CENTRO, origen: "redes_sociales", contactos: 2, fase: "Esperando respuesta", urgencia: "ALTO", accionSugerida: "Importe alto parado una semana — llamar" },
  { id: "PR-1037", paciente: "Nuria Campos", trat: "Férula de descarga", importe: 220, estado: "PRESENTADO", fechaHaceDias: 12, doctor: "Dr. Andrés Molina", clinica: C_CENTRO, origen: "redes_sociales", contactos: 3, fase: "Recordatorio 10d", urgencia: "BAJO" },
  { id: "PR-1038", paciente: "Jorge Aranda", trat: "Limpieza dental", importe: 90, estado: "PRESENTADO", fechaHaceDias: 15, doctor: "Dr. Iván Castaño", clinica: C_ESTE, origen: "walk_in", contactos: 2, fase: "Recordatorio 10d", urgencia: "BAJO" },
  // EN_NEGOCIACION (4)
  { id: "PR-1021", paciente: "Alicia Vera", trat: "Ortodoncia invisible", importe: 2950, estado: "EN_NEGOCIACION", fechaHaceDias: 3, doctor: "Dr. Andrés Molina", clinica: C_CENTRO, origen: "google_ads", contactos: 3, fase: "En intervención", intencion: "Acepta pero pregunta pago", urgencia: "CRÍTICO", respuesta: "Me interesa, pero ¿puedo pagarlo en cuotas? De golpe no llego.", respuestaHaceHoras: 3, accionSugerida: "Cerrar hoy con plan de financiación", mensajeSugerido: "¡Claro, Alicia! Tenemos financiación en 12 o 24 meses sin intereses. En 24 meses te quedaría en unos 123 €/mes. ¿Te preparo la simulación?" },
  { id: "PR-1022", paciente: "Manuel Sáez", trat: "Corona sobre implante", importe: 890, estado: "EN_NEGOCIACION", fechaHaceDias: 6, doctor: "Dra. Lucía Ferrer", clinica: C_CENTRO, origen: "google_ads", contactos: 2, fase: "En intervención", intencion: "Pide oferta/descuento", urgencia: "ALTO", respuesta: "¿Es el mejor precio que me podéis hacer? En otra clínica me dan algo menos.", respuestaHaceHoras: 22, accionSugerida: "Responder a la comparativa de precio" },
  { id: "PR-1023", paciente: "Rosa Delgado", trat: "Blanqueamiento LED", importe: 320, estado: "EN_NEGOCIACION", fechaHaceDias: 8, doctor: "Dra. Paula Iglesias", clinica: C_NORTE, origen: "referido_paciente", contactos: 2, fase: "Esperando respuesta", intencion: "Quiere pensarlo", urgencia: "MEDIO", respuesta: "Déjame pensarlo el fin de semana y te digo, ¿vale?", respuestaHaceHoras: 50 },
  { id: "PR-1024", paciente: "Isabel Marín", trat: "Blanqueamiento LED", importe: 320, estado: "EN_NEGOCIACION", fechaHaceDias: 10, doctor: "Dr. Andrés Molina", clinica: C_CENTRO, origen: "otro", contactos: 3, fase: "Esperando respuesta", intencion: "Quiere pensarlo", urgencia: "MEDIO" },
  // ACEPTADO (5)
  { id: "PR-1011", paciente: "María González", trat: "Implante unitario", importe: 3480, estado: "ACEPTADO", fechaHaceDias: 14, fechaAceptadoHaceDias: 9, doctor: "Dra. Lucía Ferrer", clinica: C_CENTRO, origen: "redes_sociales", contactos: 3, fase: "Cerrado", intencion: "Acepta sin condiciones" },
  { id: "PR-1012", paciente: "Javier Torres", trat: "Ortodoncia invisible", importe: 2950, estado: "ACEPTADO", fechaHaceDias: 20, fechaAceptadoHaceDias: 15, doctor: "Dr. Andrés Molina", clinica: C_CENTRO, origen: "google_ads", contactos: 2, fase: "Cerrado" },
  { id: "PR-1013", paciente: "Carmen Ortega", trat: "Endodoncia molar", importe: 520, estado: "ACEPTADO", fechaHaceDias: 10, fechaAceptadoHaceDias: 6, doctor: "Dra. Paula Iglesias", clinica: C_NORTE, origen: "referido_paciente", contactos: 1, fase: "Cerrado" },
  { id: "PR-1014", paciente: "Antonio Vidal", trat: "Corona sobre implante", importe: 890, estado: "ACEPTADO", fechaHaceDias: 8, fechaAceptadoHaceDias: 4, doctor: "Dra. Marta Villalba", clinica: C_SUR, origen: "otro", contactos: 2, fase: "Cerrado" },
  { id: "PR-1015", paciente: "Marina Cuevas", trat: "Corona sobre implante", importe: 890, estado: "ACEPTADO", fechaHaceDias: 3, fechaAceptadoHaceDias: 1, doctor: "Dra. Lucía Ferrer", clinica: C_CENTRO, origen: "redes_sociales", contactos: 1, fase: "Cerrado", intencion: "Acepta sin condiciones" },
  // PERDIDO (3) — con motivo
  { id: "PR-1001", paciente: "Cristina Bosch", trat: "Blanqueamiento LED", importe: 320, estado: "PERDIDO", fechaHaceDias: 12, doctor: "Dra. Marta Villalba", clinica: C_SUR, origen: "redes_sociales", contactos: 3, fase: "Cerrado", motivoPerdida: "precio_alto" },
  { id: "PR-1002", paciente: "Beatriz Solano", trat: "Brackets metálicos", importe: 1850, estado: "PERDIDO", fechaHaceDias: 16, doctor: "Dr. Iván Castaño", clinica: C_ESTE, origen: "referido_paciente", contactos: 2, fase: "Cerrado", motivoPerdida: "otra_clinica" },
  { id: "PR-1003", paciente: "Eva Redondo", trat: "Revisión general", importe: 60, estado: "PERDIDO", fechaHaceDias: 18, doctor: "Dra. Marta Villalba", clinica: C_SUR, origen: "walk_in", contactos: 4, fase: "Cerrado", motivoPerdida: "no_responde" },
];

// 22 leads calibrados contra priorityForLead + esperaLead (ActuarHoyView).
// createdTime no es escribible → todos "nacen" al sembrar: ALTO se consigue
// vía cita-hoy y caliente-sin-acción; MEDIO = Nuevo (<24h); BAJO = resto.
type Ld = {
  nombre: string; clinica: string; tel: string; canal: string; trat: string; estado: string;
  fechaCitaOffset?: number; horaCita?: string; intencion?: string;
  whatsappEnviados?: number; llamado?: boolean;
  salienteHaceHoras?: number; salienteTipo?: "WhatsApp_Saliente" | "Llamada";
  entranteHaceHoras?: number; // posterior a saliente → vuelve a la cola
  motivoNoInteres?: string; convertidoA?: string;
  mensajeSugerido?: string; accionSugerida?: string; ultimaAccion?: string;
};
const LEADS: Ld[] = [
  // ALTO — cita hoy sin asistir (bucket "citados")
  { nombre: "Carla Núñez", clinica: C_CENTRO, tel: "+34 616 842 097", canal: "Instagram", trat: "Ortodoncia Invisible", estado: "Citado", fechaCitaOffset: 0, horaCita: "16:30", ultimaAccion: "Cita confirmada por WhatsApp" },
  { nombre: "Roberto Casas", clinica: C_NORTE, tel: "+34 643 570 218", canal: "Landing Page", trat: "Implantología", estado: "Citado", fechaCitaOffset: 0, horaCita: "12:00", ultimaAccion: "Cita agendada por teléfono" },
  // ALTO — caliente sin acción (pendientes)
  { nombre: "Sonia Ibáñez", clinica: C_CENTRO, tel: "+34 671 308 465", canal: "Instagram", trat: "Ortodoncia", estado: "Contactado", intencion: "Pregunta precio", whatsappEnviados: 0, llamado: false, entranteHaceHoras: 4, accionSugerida: "Responder con el precio y proponer valoración gratuita", mensajeSugerido: "Hola Sonia, la ortodoncia con brackets parte de 1.850 € con revisiones incluidas. Si quieres, te reservo una valoración gratuita esta semana y te lo explicamos sin compromiso. ¿Qué día te viene bien?" },
  { nombre: "Íker Fuentes", clinica: C_CENTRO, tel: "+34 689 154 730", canal: "WhatsApp", trat: "Implantología", estado: "Contactado", intencion: "Pide cita", whatsappEnviados: 0, llamado: false, entranteHaceHoras: 2, accionSugerida: "Quiere cita — proponer 2 huecos concretos hoy", mensajeSugerido: "¡Hola Íker! Claro que sí. Tengo hueco mañana a las 10:30 o el jueves a las 17:00 para la primera valoración del implante. ¿Cuál te encaja mejor?" },
  // ALTO — caliente con saliente >12h (y <48h → además "esperando respuesta")
  { nombre: "Lorena Sáenz", clinica: C_NORTE, tel: "+34 624 907 351", canal: "Google Ads", trat: "Blanqueamiento", estado: "Contactado", intencion: "Interesado", whatsappEnviados: 1, salienteHaceHoras: 26, salienteTipo: "WhatsApp_Saliente", ultimaAccion: "WhatsApp con info y precios enviado" },
  { nombre: "David Baena", clinica: C_SUR, tel: "+34 656 782 419", canal: "Referido", trat: "Endodoncia", estado: "Contactado", intencion: "Pregunta precio", llamado: true, salienteHaceHoras: 15, salienteTipo: "Llamada", ultimaAccion: "Llamada: pidió pensárselo, reenviar precio" },
  // MEDIO — nuevos de hoy
  { nombre: "Patricia Lemos", clinica: C_CENTRO, tel: "+34 618 493 275", canal: "Instagram", trat: "Blanqueamiento", estado: "Nuevo", intencion: "Pide más info", entranteHaceHoras: 1 },
  { nombre: "Guillermo Arjona", clinica: C_NORTE, tel: "+34 647 820 916", canal: "Google Orgánico", trat: "Revisión", estado: "Nuevo" },
  { nombre: "Rocío Cepeda", clinica: C_SUR, tel: "+34 675 341 208", canal: "Landing Page", trat: "Ortodoncia Invisible", estado: "Nuevo", intencion: "Pregunta precio", entranteHaceHoras: 3 },
  { nombre: "Mario Quintana", clinica: C_ESTE, tel: "+34 622 958 470", canal: "Facebook", trat: "Implantología", estado: "Nuevo" },
  { nombre: "Ainhoa Beltrán", clinica: C_CENTRO, tel: "+34 693 106 584", canal: "WhatsApp", trat: "Limpieza", estado: "Contactado", entranteHaceHoras: 2, intencion: "Pide cita", whatsappEnviados: 1, ultimaAccion: "Cita propuesta, esperando confirmación" },
  { nombre: "Samuel Cortés", clinica: C_NORTE, tel: "+34 638 275 941", canal: "Google Ads", trat: "Empaste", estado: "Nuevo" },
  // BAJO — contactados templados / citas futuras / esperando reciente
  { nombre: "Elsa Montoro", clinica: C_CENTRO, tel: "+34 615 730 682", canal: "Instagram", trat: "Revisión", estado: "Contactado", intencion: "Pide más info", whatsappEnviados: 1, salienteHaceHoras: 3, salienteTipo: "WhatsApp_Saliente", ultimaAccion: "Enviada info de la primera visita" },
  { nombre: "Tomás Ruano", clinica: C_SUR, tel: "+34 662 408 197", canal: "Google Orgánico", trat: "Limpieza", estado: "Contactado", intencion: "Sin clasificar", whatsappEnviados: 1, salienteHaceHoras: 6, salienteTipo: "WhatsApp_Saliente" },
  { nombre: "Nerea Ponte", clinica: C_NORTE, tel: "+34 648 921 375", canal: "Referido", trat: "Ortodoncia", estado: "Citado", fechaCitaOffset: 1, horaCita: "10:30", ultimaAccion: "Cita mañana confirmada" },
  { nombre: "Víctor Peral", clinica: C_ESTE, tel: "+34 671 584 209", canal: "Landing Page", trat: "Corona cerámica", estado: "Contactado", intencion: "Sin clasificar", whatsappEnviados: 2, salienteHaceHoras: 50, salienteTipo: "WhatsApp_Saliente", ultimaAccion: "2 mensajes sin respuesta — valorar llamada" },
  { nombre: "Aurora Lillo", clinica: C_CENTRO, tel: "+34 629 473 815", canal: "Facebook", trat: "Blanqueamiento", estado: "Citado", fechaCitaOffset: 2, horaCita: "17:00" },
  { nombre: "Bruno Talavera", clinica: C_SUR, tel: "+34 654 812 930", canal: "Visita directa", trat: "Revisión", estado: "Contactado", llamado: true, salienteHaceHoras: 8, salienteTipo: "Llamada" },
  // No interesado (2, con motivo) y convertidos (2, cierran el círculo lead→paciente)
  { nombre: "Olga Ramírez", clinica: C_NORTE, tel: "+34 611 209 748", canal: "Facebook", trat: "Ortodoncia", estado: "No Interesado", motivoNoInteres: "Rechazo_Producto" },
  { nombre: "Andrés Cueto", clinica: C_ESTE, tel: "+34 635 947 160", canal: "Google Ads", trat: "Implantología", estado: "No Interesado", motivoNoInteres: "No_Asistio" },
  { nombre: "Marina Cuevas", clinica: C_CENTRO, tel: "+34 631 856 490", canal: "Instagram", trat: "Corona cerámica", estado: "Convertido", convertidoA: "Marina Cuevas" },
  { nombre: "Diego Peña", clinica: C_NORTE, tel: "+34 660 394 128", canal: "Google Orgánico", trat: "Limpieza", estado: "Convertido", convertidoA: "Diego Peña" },
];

// Conversaciones WhatsApp de presupuesto (bidireccionales, clasificadas).
type Msg = { dir: "Saliente" | "Entrante"; texto: string; haceHoras: number; intencion?: string; fuente?: string };
const CONVERSACIONES_PRESUPUESTO: Array<{ prId: string; msgs: Msg[] }> = [
  {
    prId: "PR-1033",
    msgs: [
      { dir: "Saliente", texto: "Hola Pablo, te comparto el presupuesto de la ortodoncia invisible que vimos con la Dra. Villalba: 2.950 € con todas las revisiones incluidas. Cualquier duda me dices 😊", haceHoras: 50, fuente: "Modo_A_manual" },
      { dir: "Entrante", texto: "Gracias! Lo estoy mirando con mi pareja", haceHoras: 47, intencion: "Quiere pensarlo" },
      { dir: "Saliente", texto: "¡Genial! Sin prisa. Si os surge cualquier pregunta sobre el tratamiento o el pago, aquí estoy.", haceHoras: 46, fuente: "Modo_A_manual" },
      { dir: "Entrante", texto: "¿La ortodoncia invisible duele los primeros días? Me da un poco de respeto.", haceHoras: 5, intencion: "Tiene duda sobre tratamiento" },
    ],
  },
  {
    prId: "PR-1021",
    msgs: [
      { dir: "Saliente", texto: "Hola Alicia, aquí tienes el presupuesto de la ortodoncia invisible: 2.950 €. Incluye el estudio 3D, todos los alineadores y las revisiones.", haceHoras: 70, fuente: "Modo_A_manual" },
      { dir: "Entrante", texto: "Me interesa, pero ¿puedo pagarlo en cuotas? De golpe no llego.", haceHoras: 3, intencion: "Acepta pero pregunta pago" },
    ],
  },
  {
    prId: "PR-1022",
    msgs: [
      { dir: "Saliente", texto: "Buenos días Manuel, te paso el presupuesto de la corona sobre tu implante: 890 €. Te reservo hueco cuando me digas.", haceHoras: 96, fuente: "Modo_A_manual" },
      { dir: "Entrante", texto: "¿Es el mejor precio que me podéis hacer? En otra clínica me dan algo menos.", haceHoras: 22, intencion: "Pide oferta/descuento" },
    ],
  },
  {
    prId: "PR-1023",
    msgs: [
      { dir: "Saliente", texto: "Hola Rosa, ¿qué te pareció el presupuesto del blanqueamiento? Si quieres lo repasamos por teléfono.", haceHoras: 74, fuente: "Plantilla_automatica" },
      { dir: "Entrante", texto: "Déjame pensarlo el fin de semana y te digo, ¿vale?", haceHoras: 50, intencion: "Quiere pensarlo" },
      { dir: "Saliente", texto: "¡Por supuesto! Te escribo el lunes y me cuentas. Buen fin de semana 😊", haceHoras: 49, fuente: "Modo_A_manual" },
    ],
  },
  {
    prId: "PR-1011",
    msgs: [
      { dir: "Saliente", texto: "Hola María, te envío el presupuesto del implante que valoramos con la Dra. Ferrer: 3.480 €, con corona incluida.", haceHoras: 14 * 24, fuente: "Modo_A_manual" },
      { dir: "Entrante", texto: "Ok! Me parece bien, ¿cuándo podríamos empezar?", haceHoras: 9 * 24, intencion: "Acepta sin condiciones" },
      { dir: "Saliente", texto: "¡Qué bien, María! Te llamo ahora y dejamos la primera cita cerrada.", haceHoras: 9 * 24 - 1, fuente: "Modo_A_manual" },
    ],
  },
  {
    prId: "PR-1036",
    msgs: [
      { dir: "Saliente", texto: "Hola Óscar, ¿pudiste revisar el presupuesto del implante? Si te encaja, este mes podemos reservarte el estudio 3D sin coste.", haceHoras: 30, fuente: "Plantilla_automatica" },
    ],
  },
];

// Conversaciones de lead (van con Lead_Link).
const CONVERSACIONES_LEAD: Array<{ lead: string; msgs: Msg[] }> = [
  {
    lead: "Sonia Ibáñez",
    msgs: [
      { dir: "Entrante", texto: "Hola! Vi vuestro post de ortodoncia en Instagram. ¿Cuánto cuesta más o menos?", haceHoras: 4 },
    ],
  },
  {
    lead: "Íker Fuentes",
    msgs: [
      { dir: "Entrante", texto: "Buenas, me falta una muela desde hace tiempo y quiero ponerme un implante. ¿Puedo pedir cita para que me lo miréis?", haceHoras: 2 },
    ],
  },
  {
    lead: "Patricia Lemos",
    msgs: [
      { dir: "Entrante", texto: "Hola, ¿me podéis pasar info del blanqueamiento? Gracias!", haceHoras: 1 },
    ],
  },
  {
    lead: "Lorena Sáenz",
    msgs: [
      { dir: "Entrante", texto: "Hola, quería información del blanqueamiento LED que anunciáis", haceHoras: 28 },
      { dir: "Saliente", texto: "¡Hola Lorena! Claro: son 320 € e incluye la limpieza previa. El resultado se ve en una sola sesión de 45 minutos. ¿Quieres que te reserve una valoración gratuita?", haceHoras: 26, fuente: "Modo_A_manual" },
    ],
  },
  {
    lead: "Elsa Montoro",
    msgs: [
      { dir: "Entrante", texto: "Hola, ¿hacéis revisiones generales? Hace años que no voy al dentista 🙈", haceHoras: 5 },
      { dir: "Saliente", texto: "¡Hola Elsa! Sí, la primera revisión con radiografía es gratuita. Te cuento cómo funciona y si quieres te doy cita esta misma semana.", haceHoras: 3, fuente: "Modo_A_manual" },
    ],
  },
];

// Citas de pacientes (hoy / mañana / pasado) — para agenda y Copilot.
const CITAS = [
  { paciente: "María González", clinica: C_CENTRO, trat: "Implante unitario", prof: "Dra. Lucía Ferrer", sillon: "Centro S1", dia: 0, hora: "10:00", dur: 90, estado: "Confirmado", origen: "Recepción" },
  { paciente: "Adrián Cobo", clinica: C_CENTRO, trat: "Urgencia dental", prof: "Dr. Andrés Molina", sillon: "Centro S2", dia: 0, hora: "12:30", dur: 30, estado: "Confirmado", origen: "WhatsApp" },
  { paciente: "Carmen Ortega", clinica: C_NORTE, trat: "Endodoncia molar", prof: "Dra. Paula Iglesias", sillon: "Norte S1", dia: 0, hora: "16:30", dur: 60, estado: "Agendado", origen: "Recepción" },
  { paciente: "Javier Torres", clinica: C_CENTRO, trat: "Ortodoncia invisible", prof: "Dr. Andrés Molina", sillon: "Centro S1", dia: 1, hora: "09:30", dur: 45, estado: "Confirmado", origen: "Recepción" },
  { paciente: "Antonio Vidal", clinica: C_SUR, trat: "Corona sobre implante", prof: "Dra. Marta Villalba", sillon: "Sur S1", dia: 1, hora: "11:00", dur: 60, estado: "Agendado", origen: "Recepción" },
  { paciente: "Lucía Prados", clinica: C_ESTE, trat: "Blanqueamiento LED", prof: "Dr. Iván Castaño", sillon: "Este S1", dia: 1, hora: "17:00", dur: 45, estado: "Agendado", origen: "WhatsApp" },
  { paciente: "Marina Cuevas", clinica: C_CENTRO, trat: "Corona sobre implante", prof: "Dra. Lucía Ferrer", sillon: "Centro S1", dia: 2, hora: "10:30", dur: 60, estado: "Agendado", origen: "Recepción" },
  { paciente: "Rosa Delgado", clinica: C_NORTE, trat: "Revisión general", prof: "Dr. Sergio Camacho", sillon: "Norte S2", dia: 3, hora: "12:00", dur: 20, estado: "Agendado", origen: "Recepción" },
];

// Pagos (cuadran con Pacientes.Pagado/Pendiente y presupuestos ACEPTADOS).
const PAGOS = [
  { paciente: "María González", resumen: "Señal implante", importe: 500, haceDias: 9, metodo: "Tarjeta", tipo: "Senal" },
  { paciente: "María González", resumen: "Primer pago plan implante", importe: 1000, haceDias: 4, metodo: "Financiacion", tipo: "Primer_Pago_Plan" },
  { paciente: "Javier Torres", resumen: "Pago único ortodoncia invisible", importe: 2950, haceDias: 14, metodo: "Transferencia", tipo: "Pago_Unico" },
  { paciente: "Carmen Ortega", resumen: "Señal endodoncia", importe: 260, haceDias: 6, metodo: "Bizum", tipo: "Senal" },
  { paciente: "Antonio Vidal", resumen: "Liquidación corona", importe: 890, haceDias: 3, metodo: "Tarjeta", tipo: "Liquidacion" },
  { paciente: "Marina Cuevas", resumen: "Pago único corona", importe: 890, haceDias: 1, metodo: "Tarjeta", tipo: "Pago_Unico" },
];

// Objetivos mensuales (mes actual + 2 anteriores, por clínica).
const OBJETIVOS = CLINICAS.flatMap((c, ci) =>
  [0, -1, -2].map((m) => ({
    clinica: c.nombre,
    mes: mes(m),
    objetivo: [9, 7, 6, 5][ci] + (m === 0 ? 1 : 0),
  })),
);

// Reglas de automatización — SIEMPRE Modo_Test=true + paciente test inexistente.
const PACIENTE_TEST_INEXISTENTE = "recDEMOSOLOTEST00";
const REGLAS = [
  { codigo: "K4M2P1", nombre: "Avisar si un lead nuevo se queda sin gestionar", desc: "Cuando entra un lead nuevo y nadie lo atiende en 2 horas, avisa a coordinación para que no se enfríe.", trigger: "lead_creado", acciones: [{ tipo: "crear_alerta_coordinadora", params: { mensaje: "Lead nuevo sin gestionar desde hace 2 horas" } }], disparos: 6, ultimaHaceHoras: 5 },
  { codigo: "Q7R3T9", nombre: "Recordar la cita al paciente el día antes", desc: "El día antes de cada cita confirmada, envía un recordatorio por WhatsApp para reducir ausencias.", trigger: "cita_confirmada_24h_antes", acciones: [{ tipo: "enviar_whatsapp_template", params: { plantilla: "recordatorio_cita_24h" } }], disparos: 16, ultimaHaceHoras: 20 },
  { codigo: "W2X8Z4", nombre: "Reactivar presupuestos parados más de una semana", desc: "Si un presupuesto presentado lleva 7 días sin respuesta, envía un recordatorio amable con la oferta.", trigger: "presupuesto_estancado_7d", acciones: [{ tipo: "enviar_whatsapp_template", params: { plantilla: "recordatorio_presupuesto_7d" } }], disparos: 5, ultimaHaceHoras: 30 },
  { codigo: "J5N1V6", nombre: "Marcar como no interesado tras 30 días sin respuesta", desc: "Un lead inactivo 30 días pasa a No Interesado para mantener la cola limpia (siempre reversible).", trigger: "lead_inactivo_n_dias", acciones: [{ tipo: "actualizar_estado_lead", params: { estado: "No Interesado" } }], disparos: 1, ultimaHaceHoras: 60 },
];

// Historial de disparos: repartido en 2 semanas, con algún skip realista.
const HISTORIAL_AUTO: Array<{ regla: string; resultado: string; paciente?: string; lead?: string; presupuesto?: string; haceDias: number; hora: string; detalle: string }> = [
  { regla: "Q7R3T9", resultado: "success", paciente: "María González", haceDias: 0, hora: "09:05", detalle: "Recordatorio 24h enviado (cita de mañana 09:30 — Javier Torres reprogramada)" },
  { regla: "K4M2P1", resultado: "success", lead: "Guillermo Arjona", haceDias: 0, hora: "11:40", detalle: "Alerta creada: lead nuevo sin gestionar 2h" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Javier Torres", haceDias: 1, hora: "09:03", detalle: "Recordatorio 24h enviado" },
  { regla: "Q7R3T9", resultado: "skipped_horario", paciente: "Lucía Prados", haceDias: 1, hora: "21:15", detalle: "Fuera de horario laboral — reintentado a la mañana siguiente" },
  { regla: "W2X8Z4", resultado: "success", presupuesto: "PR-1036", haceDias: 1, hora: "10:12", detalle: "Recordatorio de presupuesto parado 7d enviado" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Antonio Vidal", haceDias: 2, hora: "09:04", detalle: "Recordatorio 24h enviado" },
  { regla: "K4M2P1", resultado: "success", lead: "Mario Quintana", haceDias: 2, hora: "13:22", detalle: "Alerta creada: lead nuevo sin gestionar 2h" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Carmen Ortega", haceDias: 3, hora: "09:06", detalle: "Recordatorio 24h enviado" },
  { regla: "W2X8Z4", resultado: "skipped_cooldown", presupuesto: "PR-1037", haceDias: 3, hora: "10:10", detalle: "Paciente ya contactado hoy — cooldown de 24h" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Rosa Delgado", haceDias: 4, hora: "09:02", detalle: "Recordatorio 24h enviado" },
  { regla: "K4M2P1", resultado: "success", lead: "Tomás Ruano", haceDias: 4, hora: "16:48", detalle: "Alerta creada: lead nuevo sin gestionar 2h" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Silvia Moya", haceDias: 5, hora: "09:07", detalle: "Recordatorio 24h enviado" },
  { regla: "W2X8Z4", resultado: "success", presupuesto: "PR-1037", haceDias: 6, hora: "10:15", detalle: "Recordatorio de presupuesto parado 7d enviado" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Óscar Lara", haceDias: 7, hora: "09:01", detalle: "Recordatorio 24h enviado" },
  { regla: "W2X8Z4", resultado: "success", presupuesto: "PR-1038", haceDias: 8, hora: "10:09", detalle: "Recordatorio de presupuesto parado 7d enviado" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Isabel Marín", haceDias: 9, hora: "09:05", detalle: "Recordatorio 24h enviado" },
  { regla: "K4M2P1", resultado: "success", lead: "Víctor Peral", haceDias: 10, hora: "12:30", detalle: "Alerta creada: lead nuevo sin gestionar 2h" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Nuria Campos", haceDias: 11, hora: "09:04", detalle: "Recordatorio 24h enviado" },
  { regla: "W2X8Z4", resultado: "success", presupuesto: "PR-1024", haceDias: 12, hora: "10:11", detalle: "Recordatorio de presupuesto parado 7d enviado" },
  { regla: "J5N1V6", resultado: "success", lead: "Andrés Cueto", haceDias: 13, hora: "08:30", detalle: "Lead inactivo 30 días → marcado No Interesado" },
  { regla: "Q7R3T9", resultado: "success", paciente: "Beatriz Solano", haceDias: 13, hora: "09:03", detalle: "Recordatorio 24h enviado" },
];

const PLANTILLAS_MENSAJE = [
  { nombre: "Primer contacto tras presupuesto", tipo: "Primer contacto", cat: "lead_seguimiento", contenido: "Hola {paciente}, te comparto el presupuesto de {tratamiento} que preparamos hoy: {importe} €. Cualquier duda que tengas, me escribes por aquí sin compromiso 😊" },
  { nombre: "Recordatorio suave · 3 días", tipo: "Recordatorio", cat: "lead_seguimiento", contenido: "Hola {paciente}, ¿pudiste revisar el presupuesto de {tratamiento}? Si te surge cualquier duda te la resuelvo por aquí o por teléfono, como prefieras." },
  { nombre: "Recordatorio con facilidades · 10 días", tipo: "Recordatorio", cat: "lead_seguimiento", contenido: "Hola {paciente}, seguimos teniendo tu hueco para {tratamiento}. Recuerda que puedes financiarlo hasta en 24 meses sin intereses. ¿Te preparo una simulación?" },
  { nombre: "Detalles de pago y financiación", tipo: "Detalles de pago", cat: "cobranza", contenido: "Hola {paciente}, te paso el detalle del pago de {tratamiento}: {importe} €. Puedes pagar con tarjeta, transferencia o financiación en cuotas. Dime qué te encaja mejor." },
  { nombre: "Recordatorio de cita · 24h antes", tipo: "Automatizacion", cat: "cita_recordatorio", contenido: "Hola {paciente}, te recordamos tu cita mañana a las {hora} en {clinica}. Si no puedes venir, responde a este mensaje y te la cambiamos sin problema." },
  { nombre: "Reactivación · te seguimos esperando", tipo: "Reactivacion", cat: "lead_seguimiento", contenido: "Hola {paciente}, hace tiempo hablamos de {tratamiento} y quedó pendiente. Si sigues interesado/a, esta semana tenemos huecos de valoración. ¿Te reservo uno?" },
];

const PLANTILLAS_LEAD = [
  { nombre: "Primer contacto · genérico", tipo: "Primer_Contacto", contenido: "¡Hola {nombre}! Gracias por escribirnos. Soy del equipo de {clinica}. Cuéntame qué necesitas y te ayudo a reservar tu primera valoración gratuita." },
  { nombre: "Recordatorio de cita", tipo: "Recordatorio_Cita", contenido: "Hola {nombre}, te esperamos {fecha} a las {hora}. Si te surge un imprevisto, dímelo por aquí y buscamos otro hueco." },
  { nombre: "Reactivación · no asistió", tipo: "Reactivacion_NoAsistio", contenido: "Hola {nombre}, ayer no pudimos verte en tu cita. ¿Quieres que te proponga un nuevo hueco esta semana?" },
  { nombre: "Seguimiento · sin respuesta", tipo: "Seguimiento_SinRespuesta", contenido: "Hola {nombre}, te escribí hace unos días sobre {tratamiento} y no quiero que se te pase. ¿Sigues interesado/a? Te leo por aquí 😊" },
];

const CONFIGS_CLINICA = [
  ...["Efectivo", "Tarjeta", "Transferencia", "Bizum", "Financiación externa"].map((v, i) => ({ cat: "Metodos_Pago", valor: v, orden: i + 1 })),
  { cat: "Plazos_Liquidacion", valor: "90", orden: 1 },
  ...["Precio", "Miedo al tratamiento", "Se va a otra clínica", "No contesta"].map((v, i) => ({ cat: "Razones_No_Interesado", valor: v, orden: i + 1 })),
];

// ═══ SEED ════════════════════════════════════════════════════════════════════

async function seed(): Promise<void> {
  console.log("\n═══ SEED base DEMO ═══");

  // 1. Catálogo
  const clinicaIds = await crear("Clínicas", CLINICAS.map((c) => ({ Nombre: c.nombre, Ciudad: c.ciudad, Activa: true })));
  const clinicaId = new Map(CLINICAS.map((c, i) => [c.nombre, clinicaIds[i]]));

  const staffIds = await crear("Staff", STAFF.map((s) => ({ Nombre: s.nombre, Rol: s.rol, Activo: true, "Clínica": [clinicaId.get(s.clinica)] })));
  const staffId = new Map(STAFF.map((s, i) => [s.nombre, staffIds[i]]));

  const tratIds = await crear("Tratamientos", TRATAMIENTOS.map((t) => ({ Nombre: t.nombre, Categoria: t.cat, "Duración": t.dur, "Clínica": clinicaIds })));
  const tratId = new Map(TRATAMIENTOS.map((t, i) => [t.nombre, tratIds[i]]));

  const sillonIds = await crear("Sillones", SILLONES.map((s) => ({ Nombre: s.nombre, "Clínica": [clinicaId.get(s.clinica)] })));
  const sillonId = new Map(SILLONES.map((s, i) => [s.nombre, sillonIds[i]]));

  // 2. Pacientes
  const pacIds = await crear("Pacientes", PACIENTES.map((p) => {
    const f: Record<string, unknown> = {
      Nombre: p.nombre, "Clínica": [clinicaId.get(p.clinica)], "Teléfono": p.tel,
      "Canal preferido": "Whatsapp", "Consentimiento Whatsapp": true, Activo: true,
      Canal_Origen: p.canal, Tratamientos: p.trats, CreatedAt: hace(p.creadoHaceDias),
    };
    if (p.doctor) f["Doctor_Link"] = [staffId.get(p.doctor)];
    if (p.total !== undefined) f["Presupuesto_Total"] = p.total;
    if (p.aceptado) f["Aceptado"] = p.aceptado;
    if (p.pagado !== undefined) f["Pagado"] = p.pagado;
    if (p.pendiente !== undefined) f["Pendiente"] = p.pendiente;
    if (p.financiado !== undefined) f["Financiado"] = p.financiado;
    return f;
  }));
  const pacId = new Map(PACIENTES.map((p, i) => [p.nombre, pacIds[i]]));

  // 3. Leads
  const leadIds = await crear("Leads", LEADS.map((l) => {
    const f: Record<string, unknown> = {
      Nombre: l.nombre, Telefono: l.tel, Canal_Captacion: l.canal,
      Tratamiento_Interes: l.trat, Estado: l.estado, Clinica: [clinicaId.get(l.clinica)],
    };
    if (l.fechaCitaOffset !== undefined) f["Fecha_Cita"] = dia(l.fechaCitaOffset);
    if (l.horaCita) f["Hora_Cita"] = l.horaCita;
    if (l.intencion) f["Intencion_Detectada"] = l.intencion;
    if (l.whatsappEnviados !== undefined) f["WhatsApp_Enviados"] = l.whatsappEnviados;
    if (l.llamado !== undefined) f["Llamado"] = l.llamado;
    if (l.motivoNoInteres) f["Motivo_No_Interes"] = l.motivoNoInteres;
    if (l.convertidoA) { f["Convertido_A_Paciente"] = true; f["Paciente_ID"] = [pacId.get(l.convertidoA)]; }
    if (l.mensajeSugerido) f["Mensaje_Sugerido"] = l.mensajeSugerido;
    if (l.accionSugerida) f["Accion_Sugerida"] = l.accionSugerida;
    if (l.ultimaAccion) f["Ultima_Accion"] = l.ultimaAccion;
    return f;
  }));
  const leadId = new Map(LEADS.map((l, i) => [l.nombre, leadIds[i]]));

  // 4. Presupuestos
  const preIds = await crear("Presupuestos", PRESUPUESTOS.map((pr) => {
    const f: Record<string, unknown> = {
      "Presupuesto ID": pr.id, Paciente: [pacId.get(pr.paciente)],
      Tratamiento_nombre: pr.trat, Importe: pr.importe, Estado: pr.estado,
      Fecha: dia(-pr.fechaHaceDias), FechaAlta: dia(-pr.fechaHaceDias),
      Doctor: pr.doctor, Clinica: pr.clinica, OrigenLead: pr.origen,
      TipoPaciente: pr.tipoPaciente ?? "Privado",
      TipoVisita: pr.contactos && pr.contactos > 1 ? "Paciente con Historia" : "Primera Visita",
      ContactCount: pr.contactos ?? 0,
    };
    if (pr.fase) f["Fase_seguimiento"] = pr.fase;
    if (pr.intencion) f["Intencion_detectada"] = pr.intencion;
    if (pr.urgencia) f["Urgencia_intervencion"] = pr.urgencia;
    if (pr.respuesta) {
      f["Ultima_respuesta_paciente"] = pr.respuesta;
      f["Fecha_ultima_respuesta"] = hace(0, pr.respuestaHaceHoras ?? 24);
    }
    if (pr.accionSugerida) f["Accion_sugerida"] = pr.accionSugerida;
    if (pr.mensajeSugerido) f["Mensaje_sugerido"] = pr.mensajeSugerido;
    if (pr.motivoPerdida) f["MotivoPerdida"] = pr.motivoPerdida;
    if (pr.fechaAceptadoHaceDias !== undefined) f["Fecha_Aceptado"] = dia(-pr.fechaAceptadoHaceDias);
    return f;
  }));
  const preRecId = new Map(PRESUPUESTOS.map((pr, i) => [pr.id, preIds[i]]));

  // 5. Citas
  await crear("Citas", CITAS.map((c) => {
    const ini = horaLocal(c.dia, c.hora);
    const fin = new Date(new Date(ini).getTime() + c.dur * 6e4).toISOString();
    return {
      Nombre: `${c.trat} · ${c.paciente}`, "Clínica": [clinicaId.get(c.clinica)],
      Paciente: [pacId.get(c.paciente)], Tratamiento: [tratId.get(c.trat)],
      Profesional: [staffId.get(c.prof)], "Sillón": [sillonId.get(c.sillon)],
      "Hora inicio": ini, "Hora final": fin, Estado: c.estado, Origen: c.origen,
    };
  }));

  // 6. Mensajes WhatsApp (presupuestos: por ID texto · leads: por link)
  const telDePaciente = new Map(PACIENTES.map((p) => [p.nombre, p.tel]));
  const prPorId = new Map(PRESUPUESTOS.map((p) => [p.id, p]));
  const msgsPre = CONVERSACIONES_PRESUPUESTO.flatMap(({ prId, msgs }) => {
    const pr = prPorId.get(prId)!;
    return msgs.map((m) => {
      const f: Record<string, unknown> = {
        Paciente: pr.paciente, Presupuesto: prId, Telefono: telDePaciente.get(pr.paciente),
        Direccion: m.dir, Contenido: m.texto, Timestamp: hace(0, m.haceHoras),
      };
      if (m.dir === "Saliente") f["Fuente"] = m.fuente ?? "Modo_A_manual";
      if (m.dir === "Entrante" && m.intencion) { f["Procesado_por_IA"] = true; f["Intencion_detectada"] = m.intencion; }
      return f;
    });
  });
  const telDeLead = new Map(LEADS.map((l) => [l.nombre, l.tel]));
  const msgsLead = CONVERSACIONES_LEAD.flatMap(({ lead, msgs }) =>
    msgs.map((m) => {
      const f: Record<string, unknown> = {
        Paciente: lead, Telefono: telDeLead.get(lead), Lead_Link: [leadId.get(lead)],
        Direccion: m.dir, Contenido: m.texto, Timestamp: hace(0, m.haceHoras),
      };
      if (m.dir === "Saliente") f["Fuente"] = m.fuente ?? "Modo_A_manual";
      if (m.dir === "Entrante") f["Procesado_por_IA"] = true;
      return f;
    }),
  );
  await crear("Mensajes_WhatsApp", [...msgsPre, ...msgsLead]);

  // 7. Acciones_Lead — motor de "esperando respuesta", prioridad y KPI de
  //    tiempo de respuesta. NUNCA seteamos Usuario (lección: links entre bases).
  const acciones: Array<Record<string, unknown>> = [];
  const accion = (lead: string, tipo: string, ts: string, detalles?: string) => {
    acciones.push({ Resumen: `${tipo} · ${ts.replace("T", " ").slice(0, 16)}`, Lead: [leadId.get(lead)], Tipo_Accion: tipo, Timestamp: ts, ...(detalles ? { Detalles: detalles } : {}) });
  };
  for (const l of LEADS) {
    if (l.entranteHaceHoras !== undefined) accion(l.nombre, "WhatsApp_Entrante", hace(0, l.entranteHaceHoras));
    if (l.salienteHaceHoras !== undefined) accion(l.nombre, l.salienteTipo ?? "WhatsApp_Saliente", hace(0, l.salienteHaceHoras));
  }
  // Pares WhatsApp_Entrante→WhatsApp_Saliente cerrados (KPI tiempo medio de
  // respuesta, con pares de hoy). Los salientes ya existen vía salienteHaceHoras;
  // aquí se añaden las patas que faltan de cada par.
  accion("Lorena Sáenz", "WhatsApp_Entrante", hace(0, 28)); // → saliente 26h (par 2h)
  accion("Elsa Montoro", "WhatsApp_Entrante", hace(0, 5)); // → saliente 3h (par 2h)
  accion("Tomás Ruano", "WhatsApp_Entrante", hace(0, 6, 30)); // → saliente 6h (par 30 min)
  accion("Ainhoa Beltrán", "WhatsApp_Saliente", hace(0, 1, 45)); // entrante 2h → par 15 min
  accion("Olga Ramírez", "Cambio_Estado", hace(6, 2), "Marcada No Interesado: rechaza el tratamiento");
  accion("Marina Cuevas", "Cambio_Estado", hace(3, 1), "Convertida a paciente");
  await crear("Acciones_Lead", acciones);

  // 8. Contactos e historial de presupuestos
  await crear("Contactos_Presupuesto", [
    { PresupuestoId: "PR-1033", TipoContacto: "WhatsApp", Resultado: "contestó", FechaHora: hace(0, 47), RegistradoPor: "Coordinación", MensajeIAUsado: true, TonoUsado: "cercano" },
    { PresupuestoId: "PR-1033", TipoContacto: "WhatsApp", Resultado: "contestó", FechaHora: hace(0, 5), RegistradoPor: "Coordinación" },
    { PresupuestoId: "PR-1021", TipoContacto: "WhatsApp", Resultado: "contestó", FechaHora: hace(0, 3), RegistradoPor: "Coordinación", MensajeIAUsado: true, TonoUsado: "cercano" },
    { PresupuestoId: "PR-1022", TipoContacto: "Llamada", Resultado: "contestó", FechaHora: hace(0, 22), RegistradoPor: "Coordinación" },
    { PresupuestoId: "PR-1023", TipoContacto: "WhatsApp", Resultado: "contestó", FechaHora: hace(0, 50), RegistradoPor: "Coordinación" },
    { PresupuestoId: "PR-1036", TipoContacto: "WhatsApp", Resultado: "sin respuesta", FechaHora: hace(0, 30), RegistradoPor: "Coordinación", MensajeIAUsado: true, TonoUsado: "formal" },
    { PresupuestoId: "PR-1036", TipoContacto: "Llamada", Resultado: "sin respuesta", FechaHora: hace(2, 4), RegistradoPor: "Coordinación" },
    { PresupuestoId: "PR-1011", TipoContacto: "Llamada", Resultado: "contestó", FechaHora: hace(9, 1), RegistradoPor: "Coordinación", Nota: "Acepta el implante, primera cita reservada" },
    { PresupuestoId: "PR-1037", TipoContacto: "WhatsApp", Resultado: "sin respuesta", FechaHora: hace(6, 0), RegistradoPor: "Coordinación" },
    { PresupuestoId: "PR-1003", TipoContacto: "Llamada", Resultado: "sin respuesta", FechaHora: hace(19, 0), RegistradoPor: "Coordinación", Nota: "4º intento sin respuesta — se marca perdido" },
  ]);
  await crear("Historial_Acciones", [
    { presupuesto_id: "PR-1011", tipo: "cambio_estado", descripcion: "PRESENTADO → ACEPTADO", registrado_por: "Coordinación", clinica: C_CENTRO, fecha: hace(9, 1) },
    { presupuesto_id: "PR-1015", tipo: "cambio_estado", descripcion: "PRESENTADO → ACEPTADO", registrado_por: "Coordinación", clinica: C_CENTRO, fecha: hace(1, 2) },
    { presupuesto_id: "PR-1001", tipo: "cambio_estado", descripcion: "EN_NEGOCIACION → PERDIDO (precio alto)", registrado_por: "Coordinación", clinica: C_SUR, fecha: hace(9, 0) },
    { presupuesto_id: "PR-1033", tipo: "whatsapp_enviado", descripcion: "Respuesta a duda sobre molestias", registrado_por: "Coordinación", clinica: C_SUR, fecha: hace(0, 46) },
    { presupuesto_id: "PR-1021", tipo: "nota", descripcion: "Pide financiación — preparar simulación 12/24 meses", registrado_por: "Coordinación", clinica: C_CENTRO, fecha: hace(0, 2) },
    { presupuesto_id: "PR-1036", tipo: "whatsapp_enviado", descripcion: "Recordatorio con estudio 3D sin coste", registrado_por: "Coordinación", clinica: C_CENTRO, fecha: hace(0, 30) },
  ]);

  // 9. Pagos + acciones de pago
  const pagoIds = await crear("Pagos_Paciente", PAGOS.map((p) => ({
    Resumen: `${p.resumen} · ${p.paciente}`, Paciente_Link: [pacId.get(p.paciente)],
    Paciente_RecordId: pacId.get(p.paciente), Fecha_Pago: dia(-p.haceDias),
    Importe: p.importe, Metodo: p.metodo, Tipo: p.tipo,
  })));
  await crear("Acciones_Pago", PAGOS.map((p, i) => ({
    Resumen: `Crear · ${p.resumen} · ${p.paciente}`, Pago_Link: [pagoIds[i]],
    Tipo: "Crear", Importe_Despues: p.importe, Fecha: hace(p.haceDias, -10),
  })));

  // 10. Objetivos
  await crear("Objetivos_Mensuales", OBJETIVOS.map((o) => ({
    clinica: o.clinica, mes: o.mes, objetivo_aceptados: o.objetivo,
    creado_por: "Administración", creado_en: hace(30),
  })));

  // 11. Plantillas y configuración
  await crear("Plantillas_Mensaje", PLANTILLAS_MENSAJE.map((p) => ({
    Nombre: p.nombre, Tipo: p.tipo, Categoria: p.cat, Contenido: p.contenido, Activa: true, Fecha_creacion: hace(40),
  })));
  await crear("Plantillas_Lead", PLANTILLAS_LEAD.map((p) => ({
    Nombre: p.nombre, Tipo: p.tipo, Contenido: p.contenido, Activa: true,
  })));
  await crear("Configuraciones_Clinica", CONFIGS_CLINICA.map((c) => ({
    Resumen: `${c.cat} · ${c.valor} · global`, Categoria: c.cat, Valor: c.valor, Activo: true, Orden: c.orden,
  })));
  await crear("Configuracion_Automatizaciones", CLINICAS.map((c) => ({
    clinica: c.nombre, activa: true, modo_whatsapp: "manual",
    dias_inactividad_alerta: 3, dias_portal_sin_respuesta: 2, dias_reactivacion: 90,
    creado_en: hace(40),
  })));
  await crear("Configuracion_Recordatorios", CLINICAS.map((c) => ({
    Clinica: c.nombre, Secuencia_dias: "3,7,10", Recordatorio_max: 3,
    Hora_envio: "10:00", Dias_rechazo_auto: 30, Activa: true,
  })));

  // 12. Automatizaciones: reglas (candado Modo_Test) + historial + eventos ya procesados
  const reglaIds = await crear("Reglas_Automatizacion", REGLAS.map((r) => ({
    Resumen: r.nombre, Codigo: r.codigo, Nombre: r.nombre, Descripcion: r.desc,
    Trigger_Tipo: r.trigger, Condiciones: "[]", Acciones: JSON.stringify(r.acciones),
    Activa: true, Modo_Test: true, Paciente_Test_Id: PACIENTE_TEST_INEXISTENTE,
    Veces_Disparada: r.disparos, Ultima_Disparada_At: hace(0, r.ultimaHaceHoras),
    Created_At: hace(45),
  })));
  const reglaId = new Map(REGLAS.map((r, i) => [r.codigo, reglaIds[i]]));
  await crear("Acciones_Automatizacion", HISTORIAL_AUTO.map((h) => {
    const f: Record<string, unknown> = {
      Resumen: `${REGLAS.find((r) => r.codigo === h.regla)!.nombre} · ${h.paciente ?? h.lead ?? h.presupuesto ?? ""}`,
      Regla_Link: [reglaId.get(h.regla)], Resultado: h.resultado,
      Detalle: h.detalle, Ejecutada_At: horaLocal(-h.haceDias, h.hora),
    };
    if (h.paciente) f["Paciente_Link"] = [pacId.get(h.paciente)];
    if (h.lead) f["Lead_Link"] = [leadId.get(h.lead)];
    if (h.presupuesto) f["Presupuesto_Link"] = [preRecId.get(h.presupuesto)];
    return f;
  }));
  await crear("Eventos_Sistema", [
    { Resumen: "lead_creado · Guillermo Arjona", Tipo: "lead_creado", Entidad_Tipo: "Lead", Entidad_Id: leadId.get("Guillermo Arjona") ?? "", Procesado: true, Created_At: hace(0, 4) },
    { Resumen: "lead_creado · Mario Quintana", Tipo: "lead_creado", Entidad_Tipo: "Lead", Entidad_Id: leadId.get("Mario Quintana") ?? "", Procesado: true, Created_At: hace(0, 6) },
    { Resumen: "presupuesto_creado · PR-1031", Tipo: "presupuesto_creado", Entidad_Tipo: "Presupuesto", Entidad_Id: "PR-1031", Procesado: true, Created_At: hace(0, 8) },
    { Resumen: "presupuesto_actualizado · PR-1015 aceptado", Tipo: "presupuesto_actualizado", Entidad_Tipo: "Presupuesto", Entidad_Id: "PR-1015", Procesado: true, Created_At: hace(1, 2) },
  ]);
}

// ═══ MAIN ════════════════════════════════════════════════════════════════════

async function main() {
  assertSoloBaseDemo();
  console.log(DRY ? "MODO DRY — no escribe ni borra nada" : "RESET DEMO — wipe total + seed");
  await runWithCliente("DEMO", async () => {
    await wipe();
    await seed();
  });
  console.log(`\nListo. ${DRY ? "(simulado) " : ""}${totalCreados} registros sembrados, fechas ancladas a ${new Date(NOW).toISOString().slice(0, 16)}.`);
  console.log("Reglas de automatización en Modo_Test con paciente inexistente: NO envían.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n✗ RESET FALLIDO:", e instanceof Error ? e.message : e);
    console.error("La base puede quedar a medias — reejecuta cuando esté corregido (el wipe la deja limpia).");
    process.exit(1);
  });
