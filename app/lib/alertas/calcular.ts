// app/lib/alertas/calcular.ts
// Sprint 8 D.7 — cálculo de situaciones por clínica y tipo.
// Se ejecuta en cada GET /api/alertas. No cron (Sprint 9).

import { selectClinicasCentralRaw } from "../auth/users";
import { selectColaEnviosFetchAllRaw } from "../presupuestos/cola-envios-repo";
import { selectPresupuestosRaw } from "../presupuestos/repo";
import { listAllOpciones } from "../configuraciones/configuraciones";
import { listLeads } from "../leads/leads";
import { listPacientes } from "../pacientes/pacientes";
import { listPagosResumen } from "../pagos";
import type { TipoAlerta } from "./templates";
import { hoyISO } from "../time";
import { calcularCobrosPorPaciente } from "../cobros";
import { agendasExternasRotas } from "../agenda/agenda-externa";

export type AlertaClinica = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<TipoAlerta, number>;
  /** € en juego por tipo. Solo los tipos de cobro lo tienen; el resto, ausente
   *  — que no es lo mismo que cero. */
  importes: Partial<Record<TipoAlerta, number>>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function calcularAlertas(): Promise<AlertaClinica[]> {
  const [clinicas, leads, presupuestos, colaEnvios, pagos, pacientes, opciones] =
    await Promise.all([
      selectClinicasCentralRaw({ filterByFormula: "{Activa}" }),
      // FASE 1 migración: leads via repo del dominio (tipo Lead, no records).
      listLeads(),
      selectPresupuestosRaw(),
      selectColaEnviosFetchAllRaw({ filterByFormula: "{Estado}='Fallido'" }),
      // Sprint 14b Bloque 3 — pagos all-time + pacientes + plazos config
      // para los 3 triggers de cobros.
      listPagosResumen(),
      // FASE 1 migración: pacientes via repo del dominio (tipo Paciente).
      listPacientes(),
      listAllOpciones(),
    ]);

  const clinicaById = new Map<string, { nombre: string }>();
  for (const c of clinicas) {
    clinicaById.set(c.id, { nombre: String(c.fields?.["Nombre"] ?? "") });
  }

  // Mapas temporales
  const result = new Map<string, Record<TipoAlerta, number>>();
  // € en juego por (clínica, tipo). Solo lo tienen los tipos de cobro: un
  // "lead sin gestionar" no tiene importe todavía, y **inventarle uno sería
  // peor que no tenerlo** — la pantalla dice "—" y ordena por lo que sabe.
  const importes = new Map<string, Partial<Record<TipoAlerta, number>>>();
  function add(clinicaId: string, tipo: TipoAlerta, n = 1, importe?: number): void {
    if (!clinicaId || !clinicaById.has(clinicaId)) return;
    if (importe != null) {
      if (!importes.has(clinicaId)) importes.set(clinicaId, {});
      const m = importes.get(clinicaId)!;
      m[tipo] = (m[tipo] ?? 0) + importe;
    }
    if (!result.has(clinicaId)) {
      result.set(clinicaId, {
        leads: 0,
        presupuestos: 0,
        citados: 0,
        asistencias: 0,
        automatizaciones: 0,
        cobro_vence_3d: 0,
        cobro_vencido_7d: 0,
        pendiente_alto_estancado: 0,
        agenda_externa: 0,
      });
    }
    result.get(clinicaId)![tipo] += n;
  }

  const now = Date.now();
  const today = hoyISO();

  // 1. LEADS sin gestionar: Estado=Nuevo + Fecha_Creacion >24h + Llamado=false + WhatsApp_Enviados=0
  for (const l of leads) {
    if (l.estado !== "Nuevo") continue;
    if (l.llamado) continue;
    if (l.whatsappEnviados > 0) continue;
    const created = l.createdAt ? new Date(l.createdAt).getTime() : 0;
    if (!created || now - created < DAY_MS) continue;
    if (l.clinicaId) add(l.clinicaId, "leads");
  }

  // 2. ASISTENCIAS sin cerrar (Sprint 9 G.6) — leads con cita pasada o de hoy
  //    en estado Citado/Citados Hoy, sin marcar Asistido ni transicionar a
  //    No Interesado/Convertido. Incluye "Citado" porque en Sprint 9 G.7
  //    "Citados Hoy" deja de ser un estado real (solo filtro visual); los
  //    nuevos leads quedan en "Citado" con Fecha_Cita.
  for (const l of leads) {
    if (l.estado !== "Citado" && l.estado !== "Citados Hoy") continue;
    if (!l.fechaCita || l.fechaCita > today) continue; // futuras no aplican
    if (l.asistido) continue;
    if (l.clinicaId) add(l.clinicaId, "asistencias");
  }

  // 3. PRESUPUESTOS sin seguimiento: Estado ∈ {PRESENTADO, INTERESADO, EN_DUDA}
  //    + Ultima_accion_registrada vacío o <now-48h. Clínica por nombre (field text).
  const clinicaByNombre = new Map<string, string>(); // nombre → id
  for (const [id, info] of clinicaById) clinicaByNombre.set(info.nombre, id);
  const THRESHOLD_48H = now - 2 * DAY_MS;

  for (const r of presupuestos) {
    const f = r.fields ?? {};
    const estado = String(f["Estado"] ?? "");
    if (estado !== "PRESENTADO" && estado !== "INTERESADO" && estado !== "EN_DUDA") continue;
    const last = f["Ultima_accion_registrada"] ? new Date(String(f["Ultima_accion_registrada"])).getTime() : 0;
    if (last && last >= THRESHOLD_48H) continue;
    const clinicaNombre = String(f["Clinica"] ?? "");
    const clinicaId = clinicaByNombre.get(clinicaNombre);
    if (clinicaId) add(clinicaId, "presupuestos");
  }

  // 4. AUTOMATIZACIONES con error: Cola_Envios con Estado=Fallido.
  //    El presupuesto linkea por ID (text). Buscamos su clínica.
  const presupAirtableIdToClinica = new Map<string, string>();
  for (const r of presupuestos) {
    const nombreClinica = String(r.fields?.["Clinica"] ?? "");
    const cid = clinicaByNombre.get(nombreClinica);
    if (cid) presupAirtableIdToClinica.set(r.id, cid);
  }
  // También permitimos que 'Presupuesto' en Cola_Envios sea el 'Presupuesto ID' string.
  const presupBusinessIdToClinica = new Map<string, string>();
  for (const r of presupuestos) {
    const pid = String(r.fields?.["Presupuesto ID"] ?? "");
    const nombreClinica = String(r.fields?.["Clinica"] ?? "");
    const cid = clinicaByNombre.get(nombreClinica);
    if (pid && cid) presupBusinessIdToClinica.set(pid, cid);
  }
  for (const r of colaEnvios) {
    const presupRef = String(r.fields?.["Presupuesto"] ?? "");
    if (!presupRef) continue;
    const cid =
      presupAirtableIdToClinica.get(presupRef) ?? presupBusinessIdToClinica.get(presupRef);
    if (cid) add(cid, "automatizaciones");
  }

  // ── Sprint 14b Bloque 3 — triggers de cobros ──────────────────────
  //
  // 5. cobro_vence_3d:        Aceptado=Si + (Fecha_Aceptado + plazo) entre
  //                            hoy y hoy+3d, sin pago tipo Liquidacion.
  // 6. cobro_vencido_7d:      Aceptado=Si + (Fecha_Aceptado + plazo + 7d) <
  //                            hoy, sin pago tipo Liquidacion.
  // 7. pendiente_alto_estancado: presupuesto > 2000€ + Aceptado hace >30d +
  //                            sin pago registrado de ningún tipo.
  //
  // LOS TRES TRIGGERS DE COBROS SALEN DE LA FUNCIÓN COMPARTIDA (2026-08-01).
  //
  // Aquí vivía una reimplementación a mano de la regla de vencimiento —plazo
  // por clínica, `venceMs = aceptadoMs + plazo*DAY_MS`, tieneLiquidacion,
  // >2.000 €, >30 días—, es decir un segundo cálculo del mismo concepto que ya
  // resuelven `/cobros` y `/red` con `calcularCobrosPorPaciente`. Coincidían
  // (8 y 8 vencidos, 5 y 5 estancados, medido), pero por suerte y no por
  // construcción: al anclar el plazo al día de la clínica ese mismo día, esta
  // copia se quedó en milisegundos rodantes y las dos pantallas empezaron a
  // cruzar el umbral en instantes distintos. Es el olor §6 en su forma cara.
  //
  // Y al unificar entra gratis lo que la pantalla necesitaba: el DINERO. La
  // función devuelve el pendiente por paciente, así que cada alerta de cobro
  // puede decir cuánto hay en juego sin una consulta nueva — los datos que
  // necesita (pacientes, presupuestos, pagos, opciones) ya estaban cargados
  // aquí arriba para el cálculo viejo.
  const cobros = calcularCobrosPorPaciente({
    pacientes,
    presupuestos: presupuestos as ReadonlyArray<{ id: string; fields: Record<string, unknown> }>,
    pagos,
    opciones,
  });
  // Se derivan de los CAMPOS, no del bucket `urgencia`, y es deliberado por
  // dos razones que cambiarían los números en silencio si se ignoraran:
  //   · `urgencia` es un ÚNICO valor con precedencia (vencido > por vencer >
  //     estancado), porque la cola de Cobros pinta un paciente en una sola
  //     fila. Aquí son HECHOS INDEPENDIENTES: un paciente puede estar vencido
  //     y además ser un estancado alto, y las dos cosas hay que avisarlas.
  //   · el bucket "por vencer" de la cola son 7 días; esta alerta dice "vence
  //     en los próximos 3 días" y se queda en 3. La ventana es más estrecha a
  //     propósito — lo que se comparte es el RELOJ y la derivación, no el
  //     umbral de cada pantalla.
  const ESTANCADO_IMPORTE_MIN = 2000;
  for (const c of cobros) {
    if (!c.clinicaId || !clinicaById.has(c.clinicaId)) continue;
    if (c.pendiente <= 0) continue;
    if (c.diasVencido != null && c.diasVencido > 7 && !c.tieneLiquidacion) {
      add(c.clinicaId, "cobro_vencido_7d", 1, c.pendiente);
    }
    if (c.diasParaVencer != null && c.diasParaVencer <= 3 && !c.tieneLiquidacion) {
      add(c.clinicaId, "cobro_vence_3d", 1, c.pendiente);
    }
    if (
      c.firmado > ESTANCADO_IMPORTE_MIN &&
      c.diasDesdeAceptacion != null &&
      c.diasDesdeAceptacion > 30 &&
      c.numPagos === 0
    ) {
      add(c.clinicaId, "pendiente_alto_estancado", 1, c.pendiente);
    }
  }

  // 8. Nivel 2 — AGENDA EXTERNA rota: el sync de un doctor no puede leer y
  //    los huecos se calculan sobre una lectura rancia (dictado: pantalla Y
  //    campana). La clínica llega por NOMBRE (el mismo puente que 3 y 4).
  try {
    for (const rota of await agendasExternasRotas()) {
      const cid = rota.clinicaNombre ? clinicaByNombre.get(rota.clinicaNombre) : undefined;
      if (cid) add(cid, "agenda_externa");
    }
  } catch (e) {
    // caída-declarada: la campana sigue con el resto de tipos; el fallo del
    // propio cálculo queda en el log (y la agenda YA enseña el error en pantalla).
    console.error("[alertas] agendasExternasRotas:", e instanceof Error ? e.message : e);
  }

  const totalOf = (c: Record<TipoAlerta, number>) =>
    c.leads +
    c.presupuestos +
    c.citados +
    c.asistencias +
    c.automatizaciones +
    c.cobro_vence_3d +
    c.cobro_vencido_7d +
    c.pendiente_alto_estancado +
    c.agenda_externa;

  const out: AlertaClinica[] = [];
  for (const [clinicaId, counts] of result) {
    if (totalOf(counts) === 0) continue;
    out.push({
      clinicaId,
      clinicaNombre: clinicaById.get(clinicaId)?.nombre ?? "",
      counts,
      importes: importes.get(clinicaId) ?? {},
    });
  }
  out.sort((a, b) => totalOf(b.counts) - totalOf(a.counts));
  return out;
}
