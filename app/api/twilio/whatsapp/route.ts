// app/api/twilio/whatsapp/route.ts
import { NextResponse } from "next/server";
import { twimlMessage } from "../../../lib/twilio/twiml";

import { getAvailableSlots, createHold, confirmHoldToAppointment } from "../../../lib/scheduler";

import {
  listAppointmentsByDay,
  createAppointment,
  getStaffRecordIdByStaffId,
  getSillonRecordIdBySillonId,
} from "../../../lib/scheduler/repo/airtableRepo";

import type { Preferences, Slot } from "../../../lib/scheduler/types";
import { DEFAULT_RULES } from "../../../lib/demoData";
import type { RulesState } from "../../../lib/types";
import { formatTime } from "../../../lib/time";

import { listStaff } from "../../../lib/scheduler/repo/staffRepo";
import { DateTime } from "luxon";

import { listTreatments, type TreatmentRow } from "../../../lib/scheduler/repo/treatmentsRepo";

// ⚠️ Recomendado en Vercel
export const runtime = "nodejs";

/* ---------------------------------------
   Helpers para selección “humana” top-3
---------------------------------------- */
function hhmmToMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function isoToMin(isoLocal: string) {
  const hhmm = isoLocal.slice(11, 16);
  return hhmmToMin(hhmm);
}
type Window = { key: string; startMin: number; endMin: number };

function pickDiversifiedTop3(slots: Slot[], rules: RulesState, preferences: Preferences): Slot[] {
  if (!slots.length) return [];

  const windows: Window[] = [
    { key: "AM_EARLY", startMin: 8 * 60, endMin: 11 * 60 },
    { key: "AM_LATE", startMin: 11 * 60, endMin: 14 * 60 },
    { key: "PM", startMin: 16 * 60, endMin: 20 * 60 },
  ];

  const minGap = Math.max(60, (rules.minBookableSlotMin ?? 30) + (rules.bufferMin ?? 0));

  const picked: Slot[] = [];
  const usedWindows = new Set<string>();

  const inWindow = (s: Slot, w: Window) => {
    const m = isoToMin(s.start);
    return m >= w.startMin && m < w.endMin;
  };

  const tooClose = (s: Slot) =>
    picked.some((p) => Math.abs(isoToMin(p.start) - isoToMin(s.start)) < minGap);

  const pickFirstFromWindow = (w: Window) => {
    const cand = slots.find((s) => inWindow(s, w) && !tooClose(s));
    if (cand) {
      picked.push(cand);
      usedWindows.add(w.key);
    }
  };

  const pickLastFromWindow = (w: Window) => {
    const cand = [...slots].filter((s) => inWindow(s, w) && !tooClose(s)).slice(-1)[0];
    if (cand) {
      picked.push(cand);
      usedWindows.add(w.key);
    }
  };

  const prefStart = preferences.preferredStartHHMM ? hhmmToMin(preferences.preferredStartHHMM) : null;
  const wantsAfternoon = prefStart !== null && prefStart >= 14 * 60;
  const wantsMorning = prefStart !== null && prefStart < 14 * 60;

  const priority: Window[] = wantsAfternoon
    ? [windows[2]!, windows[0]!, windows[1]!]
    : wantsMorning
    ? [windows[0]!, windows[1]!, windows[2]!]
    : windows;

  pickFirstFromWindow(priority[0]!);

  for (const w of priority) {
    if (picked.length >= 2) break;
    if (usedWindows.has(w.key)) continue;
    pickFirstFromWindow(w);
  }

  for (const w of priority) {
    if (picked.length >= 3) break;
    if (usedWindows.has(w.key)) {
      pickLastFromWindow(w);
      break;
    }
  }

  for (const s of slots) {
    if (picked.length >= 3) break;
    if (!tooClose(s) && !picked.includes(s)) picked.push(s);
  }

  return picked.slice(0, 3);
}

/* ---------------------------------------
   Sesiones en memoria (MVP)
---------------------------------------- */
type SessionStage = "ASK_TREATMENT" | "OFFER_SLOTS";

type Session = {
  createdAtMs: number;
  stage: SessionStage;

  clinicId: string;
  clinicRecordId?: string;

  rules: RulesState;

  // Preferencias del usuario para reusar cuando elige tratamiento
  preferences: Preferences;

  // Tratamiento seleccionado (type que usa el scheduler)
  treatmentType?: string;

  // Lista de tratamientos mostrados (para mapear número->tratamiento)
  treatmentOptions?: TreatmentRow[];

  // slots ofrecidos (para mapear número->slot)
  slotsTop?: Slot[];

  staffById: Record<string, { name: string; recordId?: string }>;
};

const SESSIONS = new Map<string, Session>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min

export function toAirtableDateTime(isoLocal: string, zone = "Europe/Madrid"): string {
  if (!isoLocal) throw new Error("toAirtableDateTime: isoLocal vacío");
  const dt = DateTime.fromISO(isoLocal, { zone });
  if (!dt.isValid) throw new Error(`toAirtableDateTime: fecha inválida: ${isoLocal}`);
  return dt.toISO({ suppressMilliseconds: true })!;
}

function chairIdToSillonId(chairId: number) {
  const n = Math.max(1, Math.floor(chairId || 1));
  return `CHR_${String(n).padStart(2, "0")}`;
}

function safe(v: any) {
  return typeof v === "string" ? v : v ? String(v) : "";
}

function normalizeWhatsAppFrom(from: string) {
  return safe(from).replace("whatsapp:", "").trim();
}

function cleanupSessions() {
  const now = Date.now();
  for (const [k, s] of SESSIONS.entries()) {
    if (now - s.createdAtMs > SESSION_TTL_MS) SESSIONS.delete(k);
  }
}

function getDemoRules(): RulesState {
  const raw = process.env.DEMO_RULES_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_RULES, ...parsed };
    } catch {
      return DEFAULT_RULES;
    }
  }
  return DEFAULT_RULES;
}

function parseWorkRange(raw: string | undefined): { start: string; end: string } | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(s);
  if (!m) return null;
  const hhmm = (x: string) => x.trim().padStart(5, "0");
  return { start: hhmm(m[1]), end: hhmm(m[2]) };
}

function timeToHHMM(value: any, zone = "Europe/Madrid"): string | null {
  if (!value) return null;
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const iso =
    value instanceof Date ? value.toISOString()
    : typeof value === "string" ? value
    : String(value);

  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  return dt.isValid ? dt.toFormat("HH:mm") : null;
}

function parsePreferences(text: string): Preferences {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toDateIso = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let dateIso: string | undefined = undefined;
  if (text.includes("hoy")) dateIso = toDateIso(now);
  if (text.includes("mañana")) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    dateIso = toDateIso(d);
  }

  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;

  const saysMorning = text.includes("por la mañana") || text.includes("en la mañana");
  if (saysMorning) {
    preferredStartHHMM = "09:00";
    preferredEndHHMM = "13:00";
  } else if (text.includes("tarde")) {
    preferredStartHHMM = "15:00";
    preferredEndHHMM = "19:00";
  }

  return { dateIso, preferredStartHHMM, preferredEndHHMM };
}

function isNumeric(text: string) {
  return /^\d+$/.test(text.trim());
}

/* ---------------------------------------
   Inyectar tratamiento de Airtable en rules
---------------------------------------- */
function injectTreatmentIntoRules(baseRules: RulesState, t: TreatmentRow): RulesState {
  const durationMin = t.durationMin ?? 25;

  // Tu core solo soporta bufferMin (uno), así que lo sumamos (antes+después)
  const bufferMin = (t.bufferBeforeMin ?? 0) + (t.bufferAfterMin ?? 0);

  const type = t.name; // lo usamos como treatmentType para getTreatmentRule

  const rest = (baseRules.treatments ?? []).filter(x => (x.type ?? "").toLowerCase() !== type.toLowerCase());

  return {
    ...baseRules,
    enableBuffers: true,
    bufferMin: Math.max(0, Math.min(60, Math.floor(bufferMin))),
    treatments: [
      ...rest,
      { type, durationMin, bufferMin: Math.max(0, Math.min(60, Math.floor(bufferMin))) } as any,
    ],
  };
}

/* ---------------------------------------
   Construir providers / rules por provider
---------------------------------------- */
async function buildProviders(rules: RulesState) {
  const staff = await listStaff();
  const activeStaff = staff.filter((s: any) => s.activo);

  const eligible = activeStaff
    .filter((s: any) => !!parseWorkRange(s.horarioLaboral))
    .filter((s: any) => (s.rol || "").toLowerCase() !== "recepcionista");

  const providerRulesById: Record<string, RulesState> = {};
  const staffById: Record<string, { name: string; recordId?: string }> = {};

  for (const s of eligible as any[]) {
    const work = parseWorkRange(s.horarioLaboral);
    if (!work) continue;

    const lunchStart = timeToHHMM(s.almuerzoInicio, "Europe/Madrid");
    const lunchEnd = timeToHHMM(s.almuerzoFin, "Europe/Madrid");
    const enableLunch = !!(lunchStart && lunchEnd);

    providerRulesById[s.staffId] = {
      ...rules,
      dayStartTime: work.start,
      dayEndTime: work.end,
      enableLunch,
      lunchStartTime: lunchStart ?? "",
      lunchEndTime: lunchEnd ?? "",
    };

    staffById[s.staffId] = { name: s.name || s.staffId, recordId: s.recordId };
  }

  return {
    providerIds: Object.keys(providerRulesById),
    providerRulesById,
    staffById,
  };
}

export async function POST(req: Request) {
  cleanupSessions();

  const form = await req.formData();
  const fromRaw = safe(form.get("From"));
  const bodyRaw = safe(form.get("Body")).trim();
  const msgSid = safe(form.get("MessageSid"));

  const from = normalizeWhatsAppFrom(fromRaw);
  const text = bodyRaw.toLowerCase().trim();

  console.log("[twilio/whatsapp] inbound", { from: fromRaw, fromNorm: from, body: bodyRaw, msgSid });

  try {
    // Contexto demo
    const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID;
    const baseRules = getDemoRules();

    // 0) Respuesta numérica -> depende del stage
    if (isNumeric(text)) {
      const sess = SESSIONS.get(from);

      if (!sess) {
        const xmlNoSess = twimlMessage("No tengo opciones activas 🙂 Escribe: 'cita' para empezar.");
        return new NextResponse(xmlNoSess, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
      }

      const n = Number(text);

      // A) Stage: elegir tratamiento
      if (sess.stage === "ASK_TREATMENT") {
        const options = sess.treatmentOptions ?? [];
        const chosenT = options[n - 1];

        if (!chosenT) {
          const xmlBad = twimlMessage("Esa opción no existe. Responde con un número de la lista 🙂");
          return new NextResponse(xmlBad, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
        }

        const rulesWithTreatment = injectTreatmentIntoRules(sess.rules, chosenT);

        // Recalcular providers (depende de rules, y luego buscar slots)
        const { providerIds, providerRulesById, staffById } = await buildProviders(rulesWithTreatment);

        console.log("[DEBUG] before getAvailableSlots", {
          providerIds,
          dateIso: sess.preferences.dateIso,
          treatment: chosenT.name,
          durationMin: chosenT.durationMin,
          bufferBefore: chosenT.bufferBeforeMin,
          bufferAfter: chosenT.bufferAfterMin,
        });

        const slots = await getAvailableSlots(
          { rules: rulesWithTreatment, treatmentType: chosenT.name, preferences: sess.preferences, providerIds, providerRulesById } as any,
          async (dayIso) => {
            const appts = await listAppointmentsByDay({ dayIso, clinicId });
            console.log("[peekAppointments] occupied slots", appts.map(a => ({
              start: a.start,
              end: a.end,
              providerId: a.providerId,
              chairId: a.chairId,
            })));
            return appts;
          }
        );

        if (!slots.length) {
          const xmlNoSlots = twimlMessage("😕 No encontré huecos para ese tratamiento con esas preferencias. Prueba otro horario (mañana/tarde).");
          return new NextResponse(xmlNoSlots, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
        }

        const top = pickDiversifiedTop3(slots, rulesWithTreatment, sess.preferences);

        console.log("[slots] generated + top3", {
          totalSlots: slots.length,
          sampleSlots: slots.slice(0, 10).map(s => ({ start: s.start, end: s.end, providerId: s.providerId, chairId: s.chairId })),
          top3: top.map(s => ({ start: s.start, end: s.end, providerId: s.providerId, chairId: s.chairId })),
        });

        // Actualizar sesión a OFFER_SLOTS
        sess.stage = "OFFER_SLOTS";
        sess.rules = rulesWithTreatment;
        sess.treatmentType = chosenT.name;
        sess.slotsTop = top;
        sess.staffById = staffById;
        SESSIONS.set(from, sess);

        const optionsMsg = top.map((slot, i) => {
          const name = staffById?.[slot.providerId]?.name ?? slot.providerId ?? "Profesional";
          return `${i + 1}️⃣ ${formatTime(slot.start)} con ${name}`;
        });

        const xmlOptions = twimlMessage(
          `Perfecto 🙂 *${chosenT.name}*\n\nOpciones disponibles:\n\n` +
          optionsMsg.join("\n") +
          `\n\nResponde con el número que prefieras.`
        );
        return new NextResponse(xmlOptions, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
      }

      // B) Stage: elegir slot (1/2/3)
      if (sess.stage === "OFFER_SLOTS") {
        const idx = n - 1;
        const chosen = sess.slotsTop?.[idx];

        if (!chosen) {
          const xmlBad = twimlMessage("Esa opción no existe. Responde 1, 2 o 3 🙂");
          return new NextResponse(xmlBad, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
        }

        // HOLD
        const patientId = from;
        const hold = createHold({
          slot: chosen,
          patientId,
          treatmentType: sess.treatmentType ?? "Revisión",
          ttlMinutes: 10,
        });

        // Staff recordId (cache; si no, lookup)
        const providerName =
          sess.staffById?.[chosen.providerId]?.name ?? chosen.providerId ?? "Profesional";

        let staffRecordId: string | undefined =
          sess.staffById?.[chosen.providerId]?.recordId ?? undefined;

        if (!staffRecordId) {
          const found = await getStaffRecordIdByStaffId(chosen.providerId);
          if (!found) throw new Error(`No staff recordId for ${chosen.providerId}`);
          staffRecordId = found;
        }

        // Sillón recordId
        const sillonId = chairIdToSillonId(chosen.chairId);
        const sillonRecordId = await getSillonRecordIdBySillonId(sillonId);
        if (!sillonRecordId) throw new Error(`No sillon recordId for ${sillonId}`);

        const out = await confirmHoldToAppointment({
          holdId: hold.id,
          rules: sess.rules,
          patientName: "Paciente WhatsApp",
          createAppointment: async (appt) => {
            const res = await createAppointment({
              name: appt.patientName ?? "Paciente WhatsApp",
              startIso: toAirtableDateTime(appt.start),
              endIso: toAirtableDateTime(appt.end),
              clinicRecordId: sess.clinicRecordId,
              staffRecordId,
              sillonRecordId,
            });
            return res.recordId;
          },
        });

        SESSIONS.delete(from);

        const appointmentId = safe((out as any)?.appointmentId ?? "");
        const xmlDone = twimlMessage(
          `🗓️ Cita creada ✅\n` +
            `Tratamiento: ${sess.treatmentType ?? "Tratamiento"}\n` +
            `Con: ${providerName}\n` +
            `Inicio: ${chosen.start}\n` +
            `Fin: ${chosen.end}\n` +
            (appointmentId ? `ID: ${appointmentId}\n` : "") +
            `Si quieres cambiarla, escribe: "reagendar"`
        );

        return new NextResponse(xmlDone, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
      }

      // Si cae aquí, stage raro
      const xmlStageErr = twimlMessage("No entendí esa opción 🙂 Escribe 'cita' para empezar de nuevo.");
      return new NextResponse(xmlStageErr, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    // 1) Si no habla de cita
    if (!text.includes("cita")) {
      const xmlEcho = twimlMessage(`✅ Recibido: "${bodyRaw}"`);
      return new NextResponse(xmlEcho, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    // 2) Si habla de cita: arrancamos flow -> pedir tratamiento
    const preferences = parsePreferences(text);

    // Traer tratamientos reales
    const treatments = await listTreatments({ clinicRecordId });

    if (!treatments.length) {
      const xmlNoTreat = twimlMessage("⚠️ No encontré tratamientos en Airtable (tabla Tratamientos).");
      return new NextResponse(xmlNoTreat, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    // Guardar sesión en stage ASK_TREATMENT
    const { staffById } = await buildProviders(baseRules);

    SESSIONS.set(from, {
      createdAtMs: Date.now(),
      stage: "ASK_TREATMENT",
      clinicId,
      clinicRecordId,
      rules: baseRules,
      preferences,
      treatmentOptions: treatments,
      staffById,
    });

    // Mensaje con lista completa (tu demo tiene 6, perfecto)
    const listMsg = treatments.map((t, i) => `${i + 1}️⃣ ${t.name}`).join("\n");

    const xmlAsk = twimlMessage(
      `Perfecto 🙂 ¿Qué tratamiento necesitas?\n\n` +
      listMsg +
      `\n\nResponde con el número.`
    );

    return new NextResponse(xmlAsk, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  } catch (err: any) {
    console.error("[twilio/whatsapp] ERROR", err);
    const xmlErr = twimlMessage("⚠️ Hubo un error. Mira los logs de Vercel y lo arreglamos.");
    return new NextResponse(xmlErr, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  }
}
