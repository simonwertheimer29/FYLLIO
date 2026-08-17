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

function sustituirVariables(
  contenido: string,
  datos: { nombre: string; tratamiento: string; importe?: number; doctor?: string; clinica?: string },
): string {
  return contenido
    .replace(/\{nombre\}/g, datos.nombre)
    .replace(/\{tratamiento\}/g, datos.tratamiento)
    .replace(/\{importe\}/g, datos.importe != null ? `${datos.importe.toLocaleString("es-ES")}€` : "")
    .replace(/\{doctor\}/g, datos.doctor ?? "")
    .replace(/\{clinica\}/g, datos.clinica ?? "");
}

function seleccionarPlantilla(
  plantillas: PlantillaMensaje[],
  tipo: TipoPlantilla,
  doctor: string,
  tratamiento: string,
  clinica: string,
): PlantillaMensaje | null {
  const activas = plantillas.filter((p) => p.activa && p.tipo === tipo);
  if (activas.length === 0) return null;

  const scorePlantilla = (p: PlantillaMensaje): number => {
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

  let best: PlantillaMensaje | null = null;
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

async function generarMensajeIA(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data.content?.[0]?.text ?? "").trim();
  } catch {
    return "";
  }
}

// La regla dura del §6 del plan, en TODOS los prompts que redactan hacia un
// paciente: el agente informa de lo decidido, jamás compromete condiciones
// nuevas (arreglado 2026-08-13; historia completa en la ruta original).
const REGLA_NO_COMPROMETER =
  " NO nombres precios, descuentos, plazos, porcentajes ni condiciones de pago concretas: no las conoces, y lo que digas lo tendría que sostener la clínica. Si toca hablar de pago, di que un asesor se lo explica.";

const IA_PROMPTS: Record<TipoPlantilla, (ctx: { nombre: string; tratamiento: string; doctor?: string }) => string> = {
  "Primer contacto": (ctx) =>
    `Redacta un mensaje de WhatsApp breve (2-3 frases) y profesional para hacer primer contacto con ${ctx.nombre}, paciente de clínica dental que recibió presupuesto de ${ctx.tratamiento}${ctx.doctor ? ` con ${ctx.doctor}` : ""}. Invita a resolver dudas. Sin emojis excesivos. En español.${REGLA_NO_COMPROMETER}`,
  "Recordatorio": (ctx) =>
    `Redacta un mensaje de WhatsApp breve (2-3 frases), amable y sin presión, de recordatorio para ${ctx.nombre}, que recibió presupuesto de ${ctx.tratamiento} y no ha respondido. En español.${REGLA_NO_COMPROMETER}`,
  "Detalles de pago": (ctx) =>
    `Redacta un mensaje de WhatsApp breve y profesional para ${ctx.nombre}, que aceptó su presupuesto de ${ctx.tratamiento}. Dile que existen opciones de pago y que un asesor de la clínica se las explicará enseguida. En español.${REGLA_NO_COMPROMETER}`,
  "Reactivacion": (ctx) =>
    `Redacta un mensaje de WhatsApp de reactivación breve y cálido para ${ctx.nombre}, que mostró interés en ${ctx.tratamiento} pero no aceptó. Sin presión. En español.${REGLA_NO_COMPROMETER}`,
};

// ─── Candidato ──────────────────────────────────────────────────────────────

type EnvioCandidate = {
  recId: string;
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
  const plantillas: PlantillaMensaje[] = plantillaRecs.map((r) => {
    const f = r.fields as any;
    return {
      id: r.id,
      nombre: String(f["Nombre"] ?? ""),
      tipo: f["Tipo"] ?? "Primer contacto",
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
      "Paciente_nombre", "Paciente_Telefono", "Teléfono",
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

    candidatos.push({
      recId: rec.id,
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
  for (const cand of filtrados) {
    const plantilla = seleccionarPlantilla(
      plantillas, cand.tipoPlantilla, cand.doctor, cand.tratamiento, cand.clinica,
    );

    let contenido: string;
    let plantillaUsada: string;

    if (plantilla) {
      contenido = sustituirVariables(plantilla.contenido, {
        nombre: cand.patientName,
        tratamiento: cand.tratamiento,
        importe: cand.importe,
        doctor: cand.doctor,
        clinica: cand.clinica,
      });
      plantillaUsada = plantilla.nombre;
    } else {
      const prompt = IA_PROMPTS[cand.tipoPlantilla]({
        nombre: cand.patientName,
        tratamiento: cand.tratamiento,
        doctor: cand.doctor,
      });
      contenido = await generarMensajeIA(prompt);
      plantillaUsada = "Generado por IA";
      if (!contenido) {
        errores++;
        continue;
      }
    }

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

  return { generados, omitidos, errores, limitados, enSemaforoRojo: enRojo };
}
