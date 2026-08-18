// app/lib/presupuestos/generar-cola.ts
//
// LA CADENCIA DE SEGUIMIENTO, extraída de la ruta a una lib invocable
// (fase B, 2026-08-17). Es el paso previo del punto 6 de la lista: la
// generación vivía DENTRO de una ruta con sesión y nada la llamaba — ni
// pantalla ni cron. Como lib la pueden invocar la ruta (con su scope de
// clínicas), un cron futuro (scope null = todas) y el QA de recorridos.
//
// El instante se INYECTA (§14): `hoy` mueve «días sin respuesta», el día
// programado y el semáforo. Sin él, medio flujo del producto no es medible
// (un recordatorio a los 7 días solo se podría probar esperando 7 días).
//
// Two-pass como siempre: candidatos → prioridad + tope por clínica →
// contenido + alta en cola. El SEMÁFORO (026) se consulta antes de aceptar
// un candidato: un hilo con asunto en manos de una persona, asumido o en
// espera no recibe toques. Los recordatorios de CITA no pasan por aquí y
// están exentos por criterio (PLAN §3).

import { listConfigRecordatorios } from "./recordatorios-config";
import { selectPlantillasMensajeRaw } from "../plantillas/plantillas";
import { selectColaEnviosRaw, createColaEnvioRaw } from "./cola-envios-repo";
import { selectPresupuestosRaw } from "./repo";
import { DateTime } from "luxon";
import type { PlantillaMensaje, ConfigRecordatorios, TipoPlantilla, TipoEnvio } from "./types";
import { permiteClinica } from "./clinica-scope";
import { semaforosParaCadencia } from "../automatizacion/semaforo";
import { hoyISO } from "../time";

const ZONE = "Europe/Madrid";

const MAX_ENVIOS_POR_CLINICA_DIA = 30;

const PRIORIDAD_ENVIO: Record<TipoEnvio, number> = {
  "Detalles de pago": 1,
  "Recordatorio 3": 2,
  "Primer contacto": 3,
  "Recordatorio 2": 4,
  "Recordatorio 1": 5,
  "Reactivacion": 6,
};

const CONFIG_DEFAULTS: Omit<ConfigRecordatorios, "clinica"> = {
  secuenciaDias: [3, 7, 10],
  recordatorioMax: 3,
  horaEnvio: "09:00",
  diasRechazoAuto: 30,
  activa: true,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sustituye las llaves DOBLES ({{nombre}}), que es el único vocabulario que
 * existe desde la 017 — la versión anterior sustituía {nombre} y a un paciente
 * le habría llegado «Hola {Ana}».
 *
 * No se reutiliza `aplicarVariables` de lib/plantillas a propósito (§16): allí
 * {{importe}} significa «Σ presupuestos ACEPTADOS del paciente» (es la pregunta
 * de cobros); aquí significa «el importe de ESTE presupuesto». Mismo nombre de
 * variable, otra pregunta — cada caller declara la suya.
 *
 * Devuelve también las llaves que NO pudo resolver (sin dato, o variable que
 * este contexto no conoce): una plantilla con huecos no se envía a nadie —
 * el caller la descarta y la CUENTA, no la manda rota.
 */
export function sustituirVariables(
  contenido: string,
  datos: { nombre: string; tratamiento: string; importe?: number; doctor?: string; clinica?: string },
): { texto: string; sinResolver: string[] } {
  const valores: Record<string, string> = {
    nombre: datos.nombre,
    tratamiento: datos.tratamiento,
    importe: datos.importe != null ? `${datos.importe.toLocaleString("es-ES")}€` : "",
    nombre_doctor: datos.doctor ?? "",
    nombre_clinica: datos.clinica ?? "",
  };
  const sinResolver: string[] = [];
  const texto = contenido.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (todo, clave: string) => {
    const v = valores[clave];
    if (v == null || v === "") {
      sinResolver.push(clave);
      return todo;
    }
    return v;
  });
  // Cualquier llave que sobreviva —{{desconocida}} ya contada, o una llave
  // SIMPLE {nombre} de una plantilla mal escrita— invalida el texto: al
  // paciente no le llega ni una llave, ni simple ni doble.
  for (const m of texto.matchAll(/\{+\s*([a-z_]+)\s*\}+/g)) {
    if (!sinResolver.includes(m[1])) sinResolver.push(m[1]);
  }
  return { texto, sinResolver };
}

/**
 * El vocabulario REAL de `plantillas_mensaje.tipo` tras la 017. La versión
 * anterior filtraba por el vocabulario nominal de la cola ('Primer contacto',
 * 'Recordatorio'…) que casi ninguna fila tiene — resultado: no encajaba nada
 * y TODO caía a la redacción con IA. La correspondencia se declara aquí, no
 * se deduce (§16); el orden es de preferencia (primero el nombre exacto, por
 * si una clínica crea plantillas con el nombre nominal).
 */
const TIPOS_REALES_POR_PLANTILLA: Record<TipoPlantilla, string[]> = {
  "Primer contacto": ["Primer contacto", "Seguimiento"],
  "Recordatorio": ["Recordatorio", "Seguimiento"],
  "Detalles de pago": ["Detalles de pago"],
  "Reactivacion": ["Reactivacion"],
};

/** Fila real de plantilla: `tipo` es texto libre de la base, no el union nominal. */
export type PlantillaFila = Omit<PlantillaMensaje, "tipo"> & { tipo: string };

export function seleccionarPlantilla(
  plantillas: PlantillaFila[],
  tipo: TipoPlantilla,
  doctor: string,
  tratamiento: string,
  clinica: string,
): PlantillaFila | null {
  const tiposValidos = TIPOS_REALES_POR_PLANTILLA[tipo];
  const activas = plantillas
    .filter((p) => p.activa && tiposValidos.includes(p.tipo))
    .sort((a, b) => tiposValidos.indexOf(a.tipo) - tiposValidos.indexOf(b.tipo));
  if (activas.length === 0) return null;

  const scorePlantilla = (p: PlantillaFila): number => {
    let score = 0;
    const clinicaMatch = p.clinica === clinica || p.clinica === "Todas" || p.clinica === "";
    if (!clinicaMatch) return -1;
    if (p.doctor && p.doctor === doctor) score += 2;
    if (p.tratamiento && p.tratamiento === tratamiento) score += 2;
    if (p.doctor && p.doctor !== doctor) return -1;
    if (p.tratamiento && p.tratamiento !== tratamiento) return -1;
    if (p.clinica === clinica) score += 1;
    return score;
  };

  let best: PlantillaFila | null = null;
  let bestScore = -1;
  for (const p of activas) {
    const s = scorePlantilla(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

// (Aquí vivía la redacción con IA para candidatos sin plantilla. RETIRADA por
// decisión del 18-08, opción (b): un mensaje que sale sin que nadie lo mire
// tiene que ser una plantilla revisada — y fuera de la ventana de 24 h Meta
// solo permite plantillas aprobadas de todos modos, así que el texto libre ni
// siquiera era enviable en el caso real de la cola. Sin plantilla que encaje,
// el candidato NO se genera y se CUENTA (`sinPlantilla`), para que la pantalla
// diga «faltan plantillas de X» en vez de inventar el mensaje cada noche.)

/**
 * Opt-out RGPD del paciente, fail-closed: sin ficha, sin id o consulta fallida
 * → NO se genera la fila. Mismo criterio que el motor de reglas — la fila con
 * contenido ya es un contacto preparado, y el corte va antes de que exista.
 */
async function optoutBloquea(pacienteId: string | null): Promise<boolean> {
  if (!pacienteId) return true;
  try {
    const { getPaciente } = await import("../pacientes/pacientes");
    const p = await getPaciente(pacienteId);
    if (p == null) return true;
    return p.optoutAutomatizaciones;
  } catch (err) {
    console.error("[generar-cola] opt-out NO comprobable — candidato bloqueado (RGPD fail-closed):", err instanceof Error ? err.message : err);
    return true;
  }
}

// ─── Candidato ──────────────────────────────────────────────────────────────

type EnvioCandidate = {
  recId: string;
  pacienteId: string | null;
  patientName: string;
  phone: string;
  tratamiento: string;
  doctor: string;
  importe: number | undefined;
  clinica: string;
  tipoEnvio: TipoEnvio;
  tipoPlantilla: TipoPlantilla;
  daysSincePresupuesto: number;
  horaEnvio: string;
};

export type ResultadoGenerarCola = {
  generados: number;
  omitidos: number;
  errores: number;
  limitados: number;
  enSemaforoRojo: number;
  /** Candidatos bloqueados por opt-out del paciente (o no comprobable — RGPD fail-closed). */
  bloqueadosOptout: number;
  /** Candidatos sin plantilla que encaje (opción b: no se genera, se cuenta). Por tipo. */
  sinPlantilla: Partial<Record<TipoPlantilla, number>>;
  /** Plantillas descartadas por llaves sin resolver ({{var}} sin dato): plantilla → llaves. */
  llavesSinResolver: Record<string, string[]>;
};

/**
 * Genera la cola de envíos del día.
 *
 * `clinicasPermitidas`: el scope del caller — la ruta pasa las de la sesión
 * (null = admin, todas); un cron pasará null explícito; el QA, las suyas.
 * `hoy`: día de clínica inyectado; default el real.
 */
export async function generarColaDelDia(opts: {
  clinicasPermitidas: ReadonlySet<string> | null;
  hoy?: string;
}): Promise<ResultadoGenerarCola> {
  const todayStr = opts.hoy ?? hoyISO();
  const hoyDT = DateTime.fromISO(todayStr, { zone: ZONE });
  const daysSince = (dateStr: string): number => {
    const d = DateTime.fromISO(dateStr, { zone: ZONE });
    if (!d.isValid) return 0;
    return Math.floor(hoyDT.diff(d, "days").days);
  };

  // 1. Configuraciones de recordatorios
  const configRecs = await listConfigRecordatorios();
  const configMap = new Map<string, Omit<ConfigRecordatorios, "clinica">>();
  for (const cfg of configRecs) {
    if (!cfg.clinica) continue;
    configMap.set(cfg.clinica, {
      secuenciaDias: cfg.secuenciaDias,
      recordatorioMax: cfg.recordatorioMax,
      horaEnvio: cfg.horaEnvio,
      diasRechazoAuto: cfg.diasRechazoAuto,
      activa: cfg.activa,
    });
  }

  // 2. Plantillas activas
  const plantillaRecs = await selectPlantillasMensajeRaw({
    fields: ["Nombre", "Tipo", "Clinica", "Doctor", "Tratamiento", "Contenido", "Activa"],
    filterByFormula: `{Activa}=TRUE()`,
  });
  const plantillas: PlantillaFila[] = plantillaRecs.map((r) => {
    const f = r.fields as any;
    return {
      id: r.id,
      nombre: String(f["Nombre"] ?? ""),
      // Texto real de la base, SIN castear al union nominal (§12): el filtro
      // de selección declara la correspondencia, no este mapeo.
      tipo: String(f["Tipo"] ?? ""),
      clinica: String(f["Clinica"] ?? "Todas"),
      doctor: String(f["Doctor"] ?? ""),
      tratamiento: String(f["Tratamiento"] ?? ""),
      contenido: String(f["Contenido"] ?? ""),
      activa: true,
      fechaCreacion: "",
    };
  });

  // 3. Presupuestos activos + PERDIDO con Reactivacion
  const presRecs = await selectPresupuestosRaw({
    fields: [
      "Paciente", "Paciente_nombre", "Paciente_Telefono", "Teléfono",
      "Tratamiento_nombre", "Estado", "Fecha", "Clinica",
      "ContactCount", "Reactivacion", "Importe", "Doctor",
      "Intencion_detectada",
    ],
    maxRecords: 2000,
  });

  // 4. Envíos existentes de hoy, para dedupe
  const enviosHoyRecs = await selectColaEnviosRaw({
    fields: ["Presupuesto", "Tipo"],
    filterByFormula: `IS_SAME({Programado_para},'${todayStr}','day')`,
    maxRecords: 5000,
  });
  const enviosExistentes = new Set(
    enviosHoyRecs.map((r) => {
      const f = r.fields as any;
      return `${f["Presupuesto"] ?? ""}::${f["Tipo"] ?? ""}`;
    }),
  );

  // ── PASS 1: candidatos ────────────────────────────────────────────────
  const candidatos: EnvioCandidate[] = [];
  let omitidos = 0;
  // EL SEMÁFORO (026): un hilo con asunto derivado con una persona, asumido
  // o en espera no recibe toques de cadencia. Contador visible: nada de
  // recortes silenciosos.
  const semaforoDe = await semaforosParaCadencia({ hoy: todayStr });
  let enRojo = 0;
  let bloqueadosOptout = 0;
  const ACTIVOS = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION"];

  for (const rec of presRecs) {
    const f = rec.fields as any;
    const estado = String(f["Estado"] ?? "PRESENTADO");
    const clinica = Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? "");
    if (opts.clinicasPermitidas && !permiteClinica(opts.clinicasPermitidas as Set<string>, clinica)) {
      omitidos++;
      continue;
    }
    const config = configMap.get(clinica) ?? CONFIG_DEFAULTS;
    if (!config.activa) {
      omitidos++;
      continue;
    }

    const pacienteId = Array.isArray(f["Paciente"])
      ? (f["Paciente"][0] ? String(f["Paciente"][0]) : null)
      : (f["Paciente"] ? String(f["Paciente"]) : null);
    const patientName = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "Paciente")
      : String(f["Paciente_nombre"] ?? "Paciente");
    const phone = f["Paciente_Telefono"]
      ? String(f["Paciente_Telefono"])
      : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
        ? String(f["Teléfono"][0])
        : "";
    const tratamientoRaw = String(f["Tratamiento_nombre"] ?? "tratamiento");
    const tratamiento = tratamientoRaw.split(/[,+]/)[0].trim() || "tratamiento";
    const doctor = Array.isArray(f["Doctor"]) ? String(f["Doctor"][0] ?? "") : String(f["Doctor"] ?? "");
    const importe = f["Importe"] != null ? Number(f["Importe"]) : undefined;
    const contactCount = Number(f["ContactCount"] ?? 0);
    const reactivacion = f["Reactivacion"] === true;
    const intencion = String(f["Intencion_detectada"] ?? "");
    const fechaRaw = String(f["Fecha"] ?? "").slice(0, 10);
    const ds = fechaRaw ? daysSince(fechaRaw) : 0;

    if (!phone) {
      omitidos++;
      continue;
    }

    let tipoEnvio: TipoEnvio | null = null;
    let tipoPlantilla: TipoPlantilla | null = null;

    if (ACTIVOS.includes(estado)) {
      if (intencion === "Acepta pero pregunta pago") {
        const dedupeKey = `${rec.id}::Detalles de pago`;
        if (!enviosExistentes.has(dedupeKey)) {
          tipoEnvio = "Detalles de pago";
          tipoPlantilla = "Detalles de pago";
        }
      }

      if (!tipoEnvio) {
        if (contactCount === 0) {
          const dedupeKey = `${rec.id}::Primer contacto`;
          if (!enviosExistentes.has(dedupeKey)) {
            tipoEnvio = "Primer contacto";
            tipoPlantilla = "Primer contacto";
          }
        } else {
          const { secuenciaDias, recordatorioMax } = config;
          for (let i = 0; i < Math.min(secuenciaDias.length, recordatorioMax); i++) {
            if (ds >= secuenciaDias[i]) {
              const reminderNum = i + 1;
              const reminderTipo: TipoEnvio = `Recordatorio ${reminderNum}` as TipoEnvio;
              const dedupeKey = `${rec.id}::${reminderTipo}`;
              if (!enviosExistentes.has(dedupeKey)) {
                tipoEnvio = reminderTipo;
                tipoPlantilla = "Recordatorio";
                break;
              }
            }
          }
        }
      }

      if (!tipoEnvio && ds >= config.diasRechazoAuto) {
        omitidos++;
        continue;
      }
    } else if (estado === "PERDIDO" && reactivacion && ds >= 90) {
      const dedupeKey = `${rec.id}::Reactivacion`;
      if (!enviosExistentes.has(dedupeKey)) {
        tipoEnvio = "Reactivacion";
        tipoPlantilla = "Reactivacion";
      }
    }

    if (!tipoEnvio || !tipoPlantilla) {
      omitidos++;
      continue;
    }

    const sem = await semaforoDe(phone);
    if (!sem.verde) {
      enRojo++;
      omitidos++;
      continue;
    }

    // Opt-out RGPD, fail-closed — el corte va ANTES de que la fila exista.
    if (await optoutBloquea(pacienteId)) {
      bloqueadosOptout++;
      omitidos++;
      continue;
    }

    candidatos.push({
      recId: rec.id,
      pacienteId,
      patientName,
      phone,
      tratamiento,
      doctor,
      importe,
      clinica,
      tipoEnvio,
      tipoPlantilla,
      daysSincePresupuesto: ds,
      horaEnvio: config.horaEnvio || "09:00",
    });
  }

  // ── PASS 2: prioridad + tope por clínica ──────────────────────────────
  const porClinica = new Map<string, EnvioCandidate[]>();
  for (const c of candidatos) {
    const arr = porClinica.get(c.clinica) || [];
    arr.push(c);
    porClinica.set(c.clinica, arr);
  }

  const filtrados: EnvioCandidate[] = [];
  let limitados = 0;
  for (const [, items] of porClinica) {
    items.sort((a, b) => {
      const prioA = PRIORIDAD_ENVIO[a.tipoEnvio] ?? 99;
      const prioB = PRIORIDAD_ENVIO[b.tipoEnvio] ?? 99;
      if (prioA !== prioB) return prioA - prioB;
      return b.daysSincePresupuesto - a.daysSincePresupuesto;
    });
    if (items.length > MAX_ENVIOS_POR_CLINICA_DIA) {
      limitados += items.length - MAX_ENVIOS_POR_CLINICA_DIA;
      filtrados.push(...items.slice(0, MAX_ENVIOS_POR_CLINICA_DIA));
    } else {
      filtrados.push(...items);
    }
  }

  // ── PASS 3: contenido + alta ──────────────────────────────────────────
  let generados = 0;
  let errores = 0;
  const sinPlantilla: Partial<Record<TipoPlantilla, number>> = {};
  const llavesSinResolver: Record<string, string[]> = {};
  for (const cand of filtrados) {
    const plantilla = seleccionarPlantilla(
      plantillas, cand.tipoPlantilla, cand.doctor, cand.tratamiento, cand.clinica,
    );

    // Opción (b), 18-08: sin plantilla no se genera — la pantalla dirá qué
    // tipo se quedó sin plantilla en vez de redactar con IA cada noche.
    if (!plantilla) {
      sinPlantilla[cand.tipoPlantilla] = (sinPlantilla[cand.tipoPlantilla] ?? 0) + 1;
      continue;
    }

    const { texto: contenido, sinResolver } = sustituirVariables(plantilla.contenido, {
      nombre: cand.patientName,
      tratamiento: cand.tratamiento,
      importe: cand.importe,
      doctor: cand.doctor,
      clinica: cand.clinica,
    });
    // Una plantilla con huecos no se manda rota («Hola {{pendiente}}»): se
    // descarta y se cuenta con SUS llaves — es el dato para arreglarla.
    if (sinResolver.length > 0) {
      llavesSinResolver[plantilla.nombre] = [...new Set([...(llavesSinResolver[plantilla.nombre] ?? []), ...sinResolver])];
      continue;
    }
    const plantillaUsada = plantilla.nombre;

    const programadoPara = `${todayStr}T${cand.horaEnvio}:00`;

    try {
      await createColaEnvioRaw({
        Presupuesto: cand.recId,
        Paciente: cand.patientName,
        Telefono: cand.phone,
        Contenido: contenido,
        Tipo: cand.tipoEnvio,
        Estado: "Pendiente",
        Programado_para: programadoPara,
        Plantilla_usada: plantillaUsada,
        Tratamiento: cand.tratamiento,
        Importe: cand.importe,
        Doctor: cand.doctor,
      });
      enviosExistentes.add(`${cand.recId}::${cand.tipoEnvio}`);
      generados++;
    } catch (err) {
      console.error(`[generar-cola] Error creando envío para ${cand.recId}:`, err);
      errores++;
    }
  }

  return {
    generados,
    omitidos,
    errores,
    limitados,
    enSemaforoRojo: enRojo,
    bloqueadosOptout,
    sinPlantilla,
    llavesSinResolver,
  };
}
