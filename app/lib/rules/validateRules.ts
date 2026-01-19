// app/lib/rules/validateRules.ts
import type { RulesState } from "../types";

export type RulesValidation = {
  ready: boolean;
  errors: string[];
  warnings: string[];
};

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

function hhmmToMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return h * 60 + m;
}

export function validateRules(rules: RulesState): RulesValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- horario ----
  if (!isHHMM(rules.dayStartTime)) errors.push("Hora de inicio: formato inválido (HH:MM).");
  if (!isHHMM(rules.dayEndTime)) errors.push("Hora de fin: formato inválido (HH:MM).");

  if (isHHMM(rules.dayStartTime) && isHHMM(rules.dayEndTime)) {
    const a = hhmmToMin(rules.dayStartTime);
    const b = hhmmToMin(rules.dayEndTime);
    if (b <= a) errors.push("Horario: la hora de fin debe ser mayor que la de inicio.");
    if (b - a < 120) warnings.push("Horario muy corto (<2h).");
  }

  // ---- lunch (opcional) ----
  const lunchEnabled = !!rules.enableLunch;
  const lsOk = isHHMM(rules.lunchStartTime);
  const leOk = isHHMM(rules.lunchEndTime);

  if (lunchEnabled) {
    if (!lsOk || !leOk) {
      errors.push("Almuerzo: activa 'enableLunch' pero faltan horas (inicio/fin en HH:MM).");
    } else {
      const ls = hhmmToMin(rules.lunchStartTime!);
      const le = hhmmToMin(rules.lunchEndTime!);
      if (le <= ls) errors.push("Almuerzo: la hora de fin debe ser mayor que la de inicio.");

      if (isHHMM(rules.dayStartTime) && isHHMM(rules.dayEndTime)) {
        const ds = hhmmToMin(rules.dayStartTime);
        const de = hhmmToMin(rules.dayEndTime);
        if (ls < ds || le > de) errors.push("Almuerzo: debe estar dentro del horario de trabajo.");
      }
    }
  } else {
    // si está apagado, pero escribieron horas, warning suave
    if (lsOk || leOk) warnings.push("Almuerzo: hay horas definidas pero enableLunch está OFF.");
    // no lo marcamos error, porque puede ser “guardado” para luego
  }

  // ---- min bookable ----
  if (!isFiniteNum(rules.minBookableSlotMin) || rules.minBookableSlotMin < 10) {
    errors.push("Tiempo disponible mínimo: debe ser ≥ 10 min.");
  } else if (rules.minBookableSlotMin > 240) {
    warnings.push("Tiempo disponible mínimo muy alto (>240 min).");
  }

  // ---- chairs ----
  if (!isFiniteNum(rules.chairsCount) || rules.chairsCount < 1) {
    errors.push("Sillones: debe ser >= 1.");
  } else if (rules.chairsCount > 12) {
    warnings.push("Sillones muy alto (>12). La agenda se verá apretada.");
  }

  // ---- buffers ----
  if (typeof rules.enableBuffers !== "boolean") {
    errors.push("Buffers: enableBuffers inválido.");
  }

  if (!isFiniteNum(rules.bufferMin) || rules.bufferMin < 0) {
    errors.push("Buffer global: debe ser un número ≥ 0.");
  } else if (rules.bufferMin > 60) {
    warnings.push("Buffer global muy alto (>60).");
  }

  // ---- gaps ----
  if (!isFiniteNum(rules.longGapThreshold) || rules.longGapThreshold < 10) {
    errors.push("Umbral de hueco largo: debe ser ≥ 10 min.");
  } else if (isFiniteNum(rules.minBookableSlotMin)) {
    const diff = Math.abs(rules.longGapThreshold - rules.minBookableSlotMin);
    if (diff >= 20) warnings.push("Umbrales distintos: 'hueco largo' y 'tiempo disponible' difieren bastante.");
  }

  // ---- tratamientos ----
  const tr = Array.isArray((rules as any).treatments) ? (rules as any).treatments : [];
  if (!tr.length) errors.push("Tratamientos: agrega al menos 1 tratamiento con su duración.");

  for (const t of tr) {
    if (!t?.type || typeof t.type !== "string" || !t.type.trim()) {
      errors.push("Tratamientos: hay uno sin nombre.");
    }
    if (!isFiniteNum(t?.durationMin) || t.durationMin < 10) {
      errors.push(`Tratamiento "${t?.type ?? "?"}": duración debe ser ≥ 10 min.`);
    }
    if (t?.bufferMin != null && (!isFiniteNum(t.bufferMin) || t.bufferMin < 0)) {
      errors.push(`Tratamiento "${t?.type ?? "?"}": bufferMin debe ser ≥ 0.`);
    }

    // allowedWindows opcional
    if (Array.isArray(t?.allowedWindows)) {
      for (const w of t.allowedWindows) {
        if (!isHHMM(w?.startHHMM) || !isHHMM(w?.endHHMM)) {
          errors.push(`Tratamiento "${t?.type ?? "?"}": ventana inválida (HH:MM).`);
          continue;
        }
        const a = hhmmToMin(w.startHHMM);
        const b = hhmmToMin(w.endHHMM);
        if (b <= a) errors.push(`Tratamiento "${t?.type ?? "?"}": ventana debe cumplir fin > inicio.`);
      }
    }
  }

  return { ready: errors.length === 0, errors, warnings };
}
