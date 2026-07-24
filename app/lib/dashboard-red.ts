// Dashboard de manager (Bloque 2, 2026-07-23) — cálculo ÚNICO y derivado.
//
// Responde en orden: ¿dónde pierdo dinero ahora? ¿cómo va el negocio?
// ¿qué clínica sube y cuál baja? ¿progresamos?
//
// TODO deriva de los registros reales (presupuestos, pagos, leads, hilo,
// historial) por las MISMAS funciones de las colas:
//   - reactivables → conversacionDePresupuesto (la de la cola de intervención)
//   - vencidos     → calcularCobrosPorPaciente (la de la cola de cobros)
//   - sin contacto → estadoConversacion sobre hilo+acciones (la de Actuar hoy)
//   - perdidos/mes → historial cambio_estado→PERDIDO (decisión 2026-07-23;
//                    los antiguos sin historial se cuentan aparte, honesto)
// Cero cachés nuevas y cero lecturas de las columnas en deprecación (nº 28).
//
// Server-only. Corre dentro del contexto de cliente (runWithCliente) del
// caller — el tenant lo garantiza RLS como en todos los repos.

import { listLeads } from "./leads/leads";
import { listPacientes } from "./pacientes/pacientes";
import { listClinicas } from "./auth/users";
import { currentCliente } from "./airtable";
import { selectPresupuestosRaw } from "./presupuestos/repo";
import { listPagosResumen } from "./pagos";
import { listAllOpciones } from "./configuraciones/configuraciones";
import { ultimosMensajesPorConversacion } from "./presupuestos/mensajeria";
import { ultimasAccionesDireccionPorLead } from "./leads/acciones";
import { conversacionDePresupuesto } from "./presupuestos/conversacion-presupuesto";
import {
  estadoConversacion,
  UMBRAL_REACTIVACION_MS,
} from "./presupuestos/estado-conversacion";
import { calcularCobrosPorPaciente } from "./cobros";
import { fechasPerdidaPorPresupuesto } from "./historial/registrar";
import { esLeadActivo } from "./leads/pipeline";

export type CifraDelta = { valor: number; previo: number };
export type PctDelta = { pct: number | null; pctPrevio: number | null };

export type RiesgoItem = {
  tipo: "reactivables" | "vencidos" | "sin_contacto" | "cierre_sin_accion";
  n: number;
  /** Σ € en juego (null para conteos sin importe). */
  importe: number | null;
  label: string;
  href: string;
};

/** "Qué está funcionando" — SOLO agregados con umbral de materialidad;
 *  el logro anecdótico de un presupuesto suelto está prohibido (revisión
 *  2026-07-23). Números verificables, cero causalidad. */
export type ExitoItem = {
  tipo: "conversion" | "aceptado_semana" | "mejor_clinica" | "mejor_tratamiento";
  dato: string;
  label: string;
};

export type ClinicaFila = {
  id: string;
  nombre: string;
  conversionPct: number | null;
  /** Conversión del mes anterior (para el Δ en puntos). */
  conversionPctPrevio: number | null;
  aceptadoMes: number;
  aceptadoMesPrevio: number;
  /** Σ pendiente VENCIDO de la clínica (regla de cobros compartida). */
  vencido: number;
  /** Δ% € aceptado vs mes anterior; null si el previo es 0. */
  tendenciaPct: number | null;
};

export type DashboardRed = {
  hoy: { riesgo: RiesgoItem[]; exitos: ExitoItem[] };
  negocio: {
    leads: {
      nuevosMes: CifraDelta;
      enSeguimiento: number;
      citadosMes: CifraDelta;
      conversionMes: PctDelta;
    };
    presupuestos: {
      presentadosMes: CifraDelta;
      presentadosImporteMes: CifraDelta;
      aceptadosMes: CifraDelta;
      aceptadosImporteMes: CifraDelta;
      perdidosMes: CifraDelta;
      perdidosImporteMes: CifraDelta;
      /** Perdidos históricos sin entrada de historial (sin mes atribuible). */
      perdidosSinFecha: number;
      conversionMes: PctDelta;
    };
    cobros: {
      cobradoMes: CifraDelta;
      pendiente: number;
      vencido: number;
    };
  };
  clinicas: ClinicaFila[];
  /** Series mensuales, últimos 6 meses (viejo → nuevo), huecos a 0:
   *  total = € aceptado · leads = nuevos · presupuestos = presentados ·
   *  cobros = € cobrado. Mismos orígenes que el resto del dashboard. */
  progreso: Array<{ mes: string; total: number; leads: number; presupuestos: number; cobros: number }>;
};

const mesKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const mesDeIso = (iso: string) => iso.slice(0, 7);

export async function calcularDashboardRed(opts: {
  /** null = todas las clínicas del cliente (admin). */
  clinicaIds: string[] | null;
  ahora?: Date;
}): Promise<DashboardRed> {
  const ahora = opts.ahora ?? new Date();
  const mesActual = mesKey(ahora);
  const mesPrevio = mesKey(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));

  const [clinicasAll, pacientes, presus, pagos, leadsAll, opciones, ultimos, accionesLead, perdidaPorPresupuesto] =
    await Promise.all([
      // Tenant: clinicas es tabla de identidad CENTRAL — sin el cliente
      // devolvería las clínicas de TODOS los clientes (lo cazó el QA de RLS).
      listClinicas({ onlyActivas: true, cliente: currentCliente() ?? undefined }),
      listPacientes({ clinicaIds: opts.clinicaIds ?? undefined }),
      selectPresupuestosRaw({
        fields: [
          "Paciente", "Estado", "Importe", "FechaAlta", "Fecha_Aceptado",
          "Tratamiento_nombre", "Intencion_detectada", "Fecha_ultima_respuesta",
          "Ultima_accion_registrada", "Tipo_ultima_accion",
        ],
      }),
      listPagosResumen(),
      listLeads(),
      listAllOpciones(),
      ultimosMensajesPorConversacion(),
      ultimasAccionesDireccionPorLead(),
      fechasPerdidaPorPresupuesto(),
    ]);

  const clinicas = opts.clinicaIds
    ? clinicasAll.filter((c) => opts.clinicaIds!.includes(c.id))
    : clinicasAll;
  const clinicaIdsSet = new Set(clinicas.map((c) => c.id));

  // Scope: pacientes ya vienen filtrados por el repo; presupuestos y pagos se
  // atribuyen a clínica VÍA su paciente (misma atribución que la cola de
  // cobros). Un presupuesto cuyo paciente no está en scope, fuera.
  const pacPorId = new Map(pacientes.map((p) => [p.id, p]));
  const presusScope = presus.filter((r) => {
    const links = ((r.fields as any)["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    return pid ? pacPorId.has(pid) : opts.clinicaIds === null;
  });
  const pagosScope = pagos.filter((p) => p.pacienteRecordId && pacPorId.has(p.pacienteRecordId));
  const leads = leadsAll.filter(
    (l) => !opts.clinicaIds || (l.clinicaId && clinicaIdsSet.has(l.clinicaId)),
  );

  const pacDe = (r: { fields: Record<string, unknown> }) => {
    const links = (r.fields["Paciente"] ?? []) as string[];
    const pid = Array.isArray(links) ? links[0] : undefined;
    return pid ? pacPorId.get(pid) : undefined;
  };
  const abierto = (estado: string) => estado !== "ACEPTADO" && estado !== "PERDIDO";

  // ── Sección 1 · riesgo ───────────────────────────────────────────────
  let reactivablesN = 0;
  let reactivablesImporte = 0;
  // Próximos a cierre sin acción: intención de cierre detectada y la pelota
  // es NUESTRA (pendiente_responder) — misma clasificación compartida.
  const INTENCIONES_CIERRE = new Set(["Acepta sin condiciones", "Acepta pero pregunta pago"]);
  let cierreN = 0;
  let cierreImporte = 0;
  for (const r of presusScope) {
    const f = r.fields as any;
    if (!abierto(String(f["Estado"] ?? ""))) continue;
    const conv = conversacionDePresupuesto(
      {
        fechaUltimaRespuesta: f["Fecha_ultima_respuesta"] ? String(f["Fecha_ultima_respuesta"]) : null,
        ultimaAccionRegistrada: f["Ultima_accion_registrada"] ? String(f["Ultima_accion_registrada"]) : null,
        tipoUltimaAccion: f["Tipo_ultima_accion"] ? String(f["Tipo_ultima_accion"]) : null,
      },
      ultimos.porPresupuesto.get(r.id),
    );
    const importe = Number(f["Importe"] ?? 0) || 0;
    if (conv.estado === "reactivable") {
      reactivablesN++;
      reactivablesImporte += importe;
    }
    if (
      conv.estado === "pendiente_responder" &&
      INTENCIONES_CIERRE.has(String(f["Intencion_detectada"] ?? ""))
    ) {
      cierreN++;
      cierreImporte += importe;
    }
  }

  const cobros = calcularCobrosPorPaciente({
    pacientes,
    presupuestos: presusScope as any,
    pagos: pagosScope,
    opciones,
  });
  let vencidosN = 0;
  let vencidosImporte = 0;
  let pendienteTotal = 0;
  for (const c of cobros) {
    pendienteTotal += c.pendiente;
    if (c.urgencia === "vencido") {
      vencidosN++;
      vencidosImporte += c.pendiente;
    }
  }

  let sinContactoN = 0;
  const max = (a?: string | null, b?: string | null) => (!a ? (b ?? null) : !b || a > b ? a : b);
  for (const l of leads) {
    if (l.convertido || !esLeadActivo(l.estado)) continue;
    const hilo = ultimos.porLead.get(l.id);
    const conv = estadoConversacion(
      {
        ultimoEntranteAt: max(accionesLead.entrantePorLead[l.id], hilo?.entranteAt),
        ultimoSalienteAt: max(accionesLead.salientePorLead[l.id], hilo?.salienteAt),
      },
      UMBRAL_REACTIVACION_MS.lead,
    );
    if (conv.estado === "sin_conversacion") sinContactoN++;
  }

  const riesgo: RiesgoItem[] = [];
  // Copy (revisión 2026-07-23): cada card es una FRASE completa de negocio —
  // qué pasó, de qué, por qué importa. Sin taquigrafía ni jerga; hechos
  // verificables, cero afirmaciones de causalidad.
  const s = (n: number) => (n === 1 ? "" : "s");
  if (reactivablesN > 0) {
    riesgo.push({
      tipo: "reactivables",
      n: reactivablesN,
      importe: reactivablesImporte,
      label: `está${reactivablesN === 1 ? "" : "n"} parado${s(reactivablesN)} en ${reactivablesN} presupuesto${s(reactivablesN)} a los que se escribió, no respondieron y nadie ha vuelto a insistir.`,
      href: "/actuar-hoy?vista=presupuestos",
    });
  }
  if (vencidosN > 0) {
    riesgo.push({
      tipo: "vencidos",
      n: vencidosN,
      importe: vencidosImporte,
      label: `siguen sin cobrarse a ${vencidosN} paciente${s(vencidosN)} que ya superó${vencidosN === 1 ? "" : "aron"} su plazo de pago.`,
      href: "/pacientes?tab=cobros&urgencia=vencido",
    });
  }
  if (cierreN > 0) {
    riesgo.push({
      tipo: "cierre_sin_accion",
      n: cierreN,
      importe: cierreImporte,
      label: `de ${cierreN} paciente${s(cierreN)} que ya ${cierreN === 1 ? "dijo que quiere aceptar y espera" : "dijeron que quieren aceptar y esperan"} tu respuesta para cerrar.`,
      href: "/actuar-hoy?vista=presupuestos",
    });
  }
  if (sinContactoN > 0) {
    riesgo.push({
      tipo: "sin_contacto",
      n: sinContactoN,
      importe: null,
      label: `lead${s(sinContactoN)} nuevo${s(sinContactoN)} que todavía no ${sinContactoN === 1 ? "ha" : "han"} recibido ni un mensaje ni una llamada.`,
      href: "/actuar-hoy?vista=leads&filtro=sin-contactar",
    });
  }

  // ── Sección 2 · el negocio ───────────────────────────────────────────
  const enMes = (iso: string | null | undefined, mes: string) => !!iso && mesDeIso(iso) === mes;

  // Leads
  const creados = (mes: string) => leads.filter((l) => enMes(l.createdAt, mes));
  const nuevosAct = creados(mesActual);
  const nuevosPrev = creados(mesPrevio);
  const convPct = (arr: typeof leads) =>
    arr.length ? Math.round((arr.filter((l) => l.convertido).length / arr.length) * 100) : null;
  const citadosEnMes = (mes: string) => leads.filter((l) => enMes(l.fechaCita, mes)).length;

  // Presupuestos
  const presentados = (mes: string) =>
    presusScope.filter((r) => enMes(String((r.fields as any)["FechaAlta"] ?? "") || null, mes));
  const aceptados = (mes: string) =>
    presusScope.filter(
      (r) =>
        String((r.fields as any)["Estado"] ?? "") === "ACEPTADO" &&
        enMes(String((r.fields as any)["Fecha_Aceptado"] ?? "") || null, mes),
    );
  const importeDe = (rs: ReadonlyArray<{ fields: Record<string, unknown> }>) =>
    rs.reduce((s, r) => s + (Number((r.fields as any)["Importe"] ?? 0) || 0), 0);
  const perdidosDe = (mes: string) =>
    presusScope.filter((r) => {
      if (String((r.fields as any)["Estado"] ?? "") !== "PERDIDO") return false;
      const fecha = perdidaPorPresupuesto.get(r.id);
      return !!fecha && mesDeIso(fecha) === mes;
    });
  const perdidosSinFecha = presusScope.filter(
    (r) => String((r.fields as any)["Estado"] ?? "") === "PERDIDO" && !perdidaPorPresupuesto.get(r.id),
  ).length;

  const presAct = presentados(mesActual);
  const presPrev = presentados(mesPrevio);
  const acepAct = aceptados(mesActual);
  const acepPrev = aceptados(mesPrevio);
  const perdAct = perdidosDe(mesActual);
  const perdPrev = perdidosDe(mesPrevio);
  const convPres = (pres: number, acep: number) =>
    pres > 0 ? Math.round((acep / pres) * 100) : null;

  // Cobros
  const cobradoEn = (mes: string) =>
    pagosScope.filter((p) => enMes(p.fechaPago, mes)).reduce((s, p) => s + p.importe, 0);

  // ── "Qué está funcionando" — agregados con umbral de materialidad ────
  const eurTxt = (n: number) => `${n.toLocaleString("es-ES")} €`;
  const exitos: ExitoItem[] = [];
  const convAct = convPres(presAct.length, acepAct.length);
  const convPrev = convPres(presPrev.length, acepPrev.length);
  if (convAct != null && convPrev != null && convAct > convPrev) {
    exitos.push({
      tipo: "conversion",
      dato: `${convAct}%`,
      label: `de los presupuestos presentados este mes acabaron aceptados — el mes pasado fue el ${convPrev}%.`,
    });
  }
  // Semana actual (7 días) vs anterior (7-14), sobre fecha_aceptado.
  const diaIso = (d: number) => new Date(ahora.getTime() - d * 24 * 3600_000).toISOString().slice(0, 10);
  const hace7d = diaIso(7);
  const hace14d = diaIso(14);
  const aceptadosDesde = (desde: string, hasta?: string) =>
    presusScope.filter((r) => {
      const f = r.fields as any;
      if (String(f["Estado"] ?? "") !== "ACEPTADO") return false;
      const fecha = String(f["Fecha_Aceptado"] ?? "").slice(0, 10);
      return !!fecha && fecha >= desde && (!hasta || fecha < hasta);
    });
  const semanaRs = aceptadosDesde(hace7d);
  const semana = importeDe(semanaRs);
  const semanaPrev = importeDe(aceptadosDesde(hace14d, hace7d));
  if (semana > semanaPrev && semana > 0) {
    exitos.push({
      tipo: "aceptado_semana",
      dato: eurTxt(semana),
      label:
        semanaPrev > 0
          ? `en presupuestos aceptados esta semana, ${eurTxt(semana - semanaPrev)} más que la semana anterior.`
          : `en presupuestos aceptados esta semana; la semana anterior no se firmó ninguno.`,
    });
  }
  // Mejor clínica de la semana (solo con red multi-clínica y con dato real).
  if (clinicas.length > 1) {
    const porClinica = new Map<string, number>();
    for (const r of semanaRs) {
      const cid = pacDe(r)?.clinicaId;
      if (!cid) continue;
      porClinica.set(cid, (porClinica.get(cid) ?? 0) + (Number((r.fields as any)["Importe"] ?? 0) || 0));
    }
    const mejor = [...porClinica.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mejor && mejor[1] > 0) {
      const nombre = clinicas.find((c) => c.id === mejor[0])?.nombre ?? "—";
      exitos.push({
        tipo: "mejor_clinica",
        dato: eurTxt(mejor[1]),
        label: `firmó ${nombre} esta semana — la clínica que más presupuesto aceptado consiguió de la red.`,
      });
    }
  }
  // Mejor tratamiento de la semana.
  {
    const porTrat = new Map<string, number>();
    for (const r of semanaRs) {
      const t = String((r.fields as any)["Tratamiento_nombre"] ?? "").trim();
      if (!t) continue;
      porTrat.set(t, (porTrat.get(t) ?? 0) + (Number((r.fields as any)["Importe"] ?? 0) || 0));
    }
    const mejor = [...porTrat.entries()].sort((a, b) => b[1] - a[1])[0];
    if (mejor && mejor[1] > 0) {
      exitos.push({
        tipo: "mejor_tratamiento",
        dato: eurTxt(mejor[1]),
        label: `se firmaron en ${mejor[0]} esta semana — el tratamiento que más dinero aceptado sumó.`,
      });
    }
  }

  // ── Sección 3 · clínicas ─────────────────────────────────────────────
  const filas: ClinicaFila[] = clinicas.map((c) => {
    const deClinica = (rs: ReadonlyArray<{ fields: Record<string, unknown> }>) =>
      rs.filter((r) => pacDe(r)?.clinicaId === c.id);
    const presMes = deClinica(presAct).length;
    const presMesPrevio = deClinica(presPrev).length;
    const acepMesRs = deClinica(acepAct);
    const acepPrevRs = deClinica(acepPrev);
    const aceptadoMes = importeDe(acepMesRs);
    const aceptadoMesPrevio = importeDe(acepPrevRs);
    const vencido = cobros
      .filter((x) => x.clinicaId === c.id && x.urgencia === "vencido")
      .reduce((s, x) => s + x.pendiente, 0);
    return {
      id: c.id,
      nombre: c.nombre,
      conversionPct: convPres(presMes, acepMesRs.length),
      conversionPctPrevio: convPres(presMesPrevio, acepPrevRs.length),
      aceptadoMes,
      aceptadoMesPrevio,
      vencido,
      tendenciaPct:
        aceptadoMesPrevio > 0
          ? Math.round(((aceptadoMes - aceptadoMesPrevio) / aceptadoMesPrevio) * 100)
          : null,
    };
  });
  // Orden por defecto: mayor caída arriba (tendencia más negativa primero;
  // sin tendencia al final).
  filas.sort((a, b) => (a.tendenciaPct ?? Infinity) - (b.tendenciaPct ?? Infinity));

  // ── Sección 4 · progreso (6 meses, 4 series) ─────────────────────────
  const progreso: Array<{ mes: string; total: number; leads: number; presupuestos: number; cobros: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const mes = mesKey(new Date(ahora.getFullYear(), ahora.getMonth() - i, 1));
    progreso.push({
      mes,
      total: importeDe(aceptados(mes)),
      leads: creados(mes).length,
      presupuestos: presentados(mes).length,
      cobros: cobradoEn(mes),
    });
  }

  return {
    hoy: { riesgo: riesgo.slice(0, 4), exitos: exitos.slice(0, 3) },
    negocio: {
      leads: {
        nuevosMes: { valor: nuevosAct.length, previo: nuevosPrev.length },
        enSeguimiento: leads.filter((l) => l.estado === "Contactado" && !l.convertido).length,
        citadosMes: { valor: citadosEnMes(mesActual), previo: citadosEnMes(mesPrevio) },
        conversionMes: { pct: convPct(nuevosAct), pctPrevio: convPct(nuevosPrev) },
      },
      presupuestos: {
        presentadosMes: { valor: presAct.length, previo: presPrev.length },
        presentadosImporteMes: { valor: importeDe(presAct), previo: importeDe(presPrev) },
        aceptadosMes: { valor: acepAct.length, previo: acepPrev.length },
        aceptadosImporteMes: { valor: importeDe(acepAct), previo: importeDe(acepPrev) },
        perdidosMes: { valor: perdAct.length, previo: perdPrev.length },
        perdidosImporteMes: { valor: importeDe(perdAct), previo: importeDe(perdPrev) },
        perdidosSinFecha,
        conversionMes: { pct: convAct, pctPrevio: convPrev },
      },
      cobros: {
        cobradoMes: { valor: cobradoEn(mesActual), previo: cobradoEn(mesPrevio) },
        pendiente: pendienteTotal,
        vencido: vencidosImporte,
      },
    },
    clinicas: filas,
    progreso,
  };
}
