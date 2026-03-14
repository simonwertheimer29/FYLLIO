import { DateTime } from "luxon";
import type { Slot, Preferences } from "../scheduler/types";
import type { RulesState } from "../types";

import { getAvailableSlots, createHoldKV, confirmHoldToAppointment } from "../scheduler";
import { listStaff } from "../scheduler/repo/staffRepo";
import { listTreatments } from "../scheduler/repo/treatmentsRepo";
import {
  listAppointmentsByDay,
  createAppointment,
  getStaffRecordIdByStaffId,
  getSillonRecordIdBySillonId,
  upsertPatientByPhone,
  cancelAppointment,
  confirmAppointment,
  findNextAppointmentByContactPhone,
  getAppointmentByRecordId,
  getPatientByPhone,
  markPatientOptOut,
  isPatientOptedOut,
} from "../scheduler/repo/airtableRepo";

import { getSession, setSession, deleteSession } from "../scheduler/sessionStore";
import { kv } from "@vercel/kv";
import { DEFAULT_RULES } from "../demoData";

/** Muestra un ISO naive UTC (formato slots) como hora Madrid HH:mm */
function slotTime(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone("Europe/Madrid").toFormat("HH:mm");
}

import {
  createWaitlistEntry,
  getOfferedEntryByPhone,
  markWaitlistActiveWithResult,
  markWaitlistBooked,
  getTreatmentMeta,
} from "../scheduler/repo/waitlistRepo";

import { onSlotFreed } from "../scheduler/waitlist/onSlotFreed";
import { sendWhatsAppMessage } from "./send";
import { parseIntentWithLLM, parseWhenWithLLM, parseChoiceWithLLM, humanizeReply } from "./llm";

import { NextResponse } from "next/server";
import { twimlMessage } from "../twilio/twiml";
import { isDuplicateMessage } from "../scheduler/idempotency";


// ─────────────────────────────────────────────
// STAGES
// ─────────────────────────────────────────────
type Stage =
  | "ASK_TREATMENT"
  | "ASK_DOCTOR"
  | "ASK_WHEN"
  | "OFFER_SLOTS"
  | "OFFER_WAITLIST"
  | "ASK_BOOKING_FOR"
  | "ASK_OTHER_PHONE"
  | "ASK_PATIENT_NAME"
  | "CONFIRM_CANCEL"
  | "CANCEL_OFFER_WAITLIST"
  | "RESCHEDULE_ASK_WHEN"
  | "RESCHEDULE_OFFER_SLOTS"
  | "ASK_NEW_BOOKING_FOR"
  | "COLLECT_FEEDBACK"
  | "CONFIRM_ATTENDANCE";

type Session = {
  createdAtMs: number;
  stage: Stage;

  clinicId: string;
  clinicRecordId?: string;
  rules: RulesState;

  // treatment + doctor
  treatmentRecordId?: string;
  treatmentName?: string;
  preferredDoctorMode?: "SPECIFIC" | "ANY";
  preferredStaffId?: string;
  preferredStaffRecordId?: string;

  // date/time preferences
  preferences?: Preferences & { exactTime?: boolean };

  // slot offer
  slotsTop: Slot[];
  staffById: Record<string, { name: string; recordId?: string }>;

  // hold + booking
  pendingHoldId?: string;
  pendingStaffRecordId?: string;
  pendingSillonRecordId?: string;
  pendingStart?: string;
  pendingEnd?: string;
  bookingFor?: "SELF" | "OTHER";
  knownPatientName?: string;   // known from ASK_NEW_BOOKING_FOR when patient is already in system
  otherPhoneE164?: string;
  useTutorPhone?: boolean;

  // feedback
  feedbackApptRecordId?: string;
  feedbackPatientName?: string;

  // attendance confirmation (set by cron/daily reminder)
  attendanceApptRecordId?: string;

  // cancel
  pendingCancelRecordId?: string;
  pendingCancelTreatmentRecordId?: string;
  pendingCancelClinicRecordId?: string;

  // reschedule
  rescheduleFromAppointmentRecordId?: string;
  reschedulePatientRecordId?: string;
  reschedulePatientName?: string;
  rescheduleTreatmentRecordId?: string;
  rescheduleTreatmentName?: string;
  rescheduleStaffId?: string;
  rescheduleStaffRecordId?: string;
  rescheduleSillonRecordId?: string;
  rescheduleDurationMin?: number;
};

const SESSION_TTL_SECONDS = 15 * 60;
const DAYS_UNTIL_WAITLIST_OFFER = 7;


// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function normalizeText(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function chairIdToSillonId(chairId: number) {
  const n = Math.max(1, Math.floor(chairId || 1));
  return `CHR_${String(n).padStart(3, "0")}`;
}

function parseWorkRange(raw: string | undefined): { start: string; end: string } | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(s);
  if (!m) return null;
  const hhmm = (x: string) => x.trim().padStart(5, "0");
  return { start: hhmm(m[1]!), end: hhmm(m[2]!) };
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

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isoToMinutesLocal(iso: string) {
  const hhmm = DateTime.fromISO(iso).setZone("Europe/Madrid").toFormat("HH:mm");
  return hhmmToMinutes(hhmm);
}

// Parses natural language date/time from Spanish text
function parseWhen(body: string): Preferences & { exactTime?: boolean } {
  const t = normalizeText(body);
  const now = DateTime.now().setZone("Europe/Madrid");

  const daysMap: Record<string, number> = {
    lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
    jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 7,
  };

  let dateIso: string | undefined;
  if (t.includes("hoy")) dateIso = now.toISODate()!;
  if (t.includes("manana") || t.includes("mañana")) dateIso = now.plus({ days: 1 }).toISODate()!;

  for (const key of Object.keys(daysMap)) {
    if (t.includes(key)) {
      const targetWeekday = daysMap[key]!;
      let diff = targetWeekday - now.weekday;
      if (diff <= 0) diff += 7;
      dateIso = now.plus({ days: diff }).toISODate()!;
      break;
    }
  }

  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;
  let exactTime = false;

  const hhmm = /(\d{1,2}):(\d{2})/.exec(t);
  const hFormat = /(\d{1,2})h\b/.exec(t);
  const pmFormat = /(\d{1,2})\s?pm\b/.exec(t);
  const aLas = /(?:a )?las (\d{1,2})\b/.exec(t);
  // bare number between 6-23: "15", "9" — only if no other time pattern matched
  const numSolo = (!hhmm && !hFormat && !pmFormat && !aLas)
    ? /\b([6-9]|1\d|2[0-3])\b/.exec(t)
    : null;

  if (hhmm) {
    const h = String(hhmm[1]).padStart(2, "0");
    preferredStartHHMM = `${h}:${hhmm[2]}`;
    preferredEndHHMM = `${h}:${hhmm[2]}`;
    exactTime = true;
  } else if (hFormat) {
    const h = String(hFormat[1]).padStart(2, "0");
    preferredStartHHMM = `${h}:00`;
    preferredEndHHMM = `${h}:00`;
    exactTime = true;
  } else if (pmFormat) {
    let h = Number(pmFormat[1]);
    if (h < 12) h += 12;
    preferredStartHHMM = `${String(h).padStart(2, "0")}:00`;
    preferredEndHHMM = `${String(h).padStart(2, "0")}:00`;
    exactTime = true;
  } else if (aLas) {
    let h = Number(aLas[1]);
    if (h >= 1 && h <= 6 && (t.includes("tarde") || t.includes("noche"))) h += 12;
    preferredStartHHMM = `${String(h).padStart(2, "0")}:00`;
    preferredEndHHMM = `${String(h).padStart(2, "0")}:00`;
    exactTime = true;
  } else if (numSolo) {
    let h = Number(numSolo[1]);
    if (h >= 1 && h <= 6 && (t.includes("tarde") || t.includes("noche"))) h += 12;
    preferredStartHHMM = `${String(h).padStart(2, "0")}:00`;
    preferredEndHHMM = `${String(h).padStart(2, "0")}:00`;
    exactTime = true;
  } else if (t.includes("manana") || t.includes("mañana") || t.includes("por la manana") || t.includes("por la mañana")) {
    preferredStartHHMM = "09:00";
    preferredEndHHMM = "13:00";
  } else if (t.includes("tarde")) {
    preferredStartHHMM = "15:00";
    preferredEndHHMM = "19:00";
  }

  return { dateIso, preferredStartHHMM, preferredEndHHMM, exactTime };
}

function renderTreatmentsList(treatments: { recordId: string; name: string }[]) {
  const lines = treatments.slice(0, 12).map((t, i) => `${i + 1}) ${t.name}`);
  return `Perfecto 🙂 ¿Qué tratamiento necesitas?\n\n${lines.join("\n")}\n\nResponde con el número o el nombre.`;
}

function findTreatmentSmart(treatments: { recordId: string; name: string }[], body: string) {
  const raw = normalizeText(body);
  if (!raw) return null;
  const tokens = raw.split(/\s+/).filter(Boolean);

  for (const t of treatments) {
    const nameN = normalizeText(t.name);
    if (!nameN) continue;
    if (raw.includes(nameN)) return t;
    const nameWords = nameN.split(/\s+/).filter(Boolean);
    for (const w of nameWords) {
      if (w.length >= 5 && tokens.includes(w)) return t;
    }
  }
  return null;
}

function findDoctorSmart(staff: { staffId: string; name: string }[], body: string) {
  const raw = normalizeText(body);
  if (!raw) return null;
  const tokens = raw.split(/\s+/).filter(Boolean);

  for (const s of staff) {
    const nameN = normalizeText(s.name);
    if (!nameN) continue;
    if (raw.includes(nameN)) return s;
    const words = nameN.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (w.length >= 4 && tokens.includes(w)) return s;
    }
  }
  return null;
}

// Returns slots immediately before and after a target time on the same day
function pickClosestBeforeAfterSameDay(slots: Slot[], dateIso: string, targetHHMM: string): Slot[] {
  const targetMin = hhmmToMinutes(targetHHMM);
  const sameDay = slots
    .filter((s) => DateTime.fromISO(s.start).setZone("Europe/Madrid").toISODate() === dateIso)
    .sort((a, b) => isoToMinutesLocal(a.start) - isoToMinutesLocal(b.start));

  if (!sameDay.length) return [];

  let before: Slot | undefined;
  for (const s of sameDay) {
    if (isoToMinutesLocal(s.start) < targetMin) before = s;
    else break;
  }
  const after = sameDay.find((s) => isoToMinutesLocal(s.start) > targetMin);

  const out: Slot[] = [];
  if (before) out.push(before);
  if (after) out.push(after);
  return out;
}

type Window = { key: string; startMin: number; endMin: number };

// Distributes top 3 slots across time windows (AM early, AM late, PM)
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

  const isoToMin = (iso: string) => isoToMinutesLocal(iso);
  const inWindow = (s: Slot, w: Window) => { const m = isoToMin(s.start); return m >= w.startMin && m < w.endMin; };
  const tooClose = (s: Slot) => picked.some((p) => Math.abs(isoToMin(p.start) - isoToMin(s.start)) < minGap);

  const pickFirstFromWindow = (w: Window) => {
    const cand = slots.find((s) => inWindow(s, w) && !tooClose(s));
    if (cand) { picked.push(cand); usedWindows.add(w.key); }
  };
  const pickLastFromWindow = (w: Window) => {
    const cand = [...slots].filter((s) => inWindow(s, w) && !tooClose(s)).slice(-1)[0];
    if (cand) { picked.push(cand); usedWindows.add(w.key); }
  };

  const prefStart = preferences.preferredStartHHMM ? hhmmToMinutes(preferences.preferredStartHHMM) : null;
  const wantsAfternoon = prefStart !== null && prefStart >= 14 * 60;
  const wantsMorning = prefStart !== null && prefStart < 14 * 60;

  const priority: Window[] = wantsAfternoon
    ? [windows[2]!, windows[0]!, windows[1]!]
    : wantsMorning
    ? [windows[0]!, windows[1]!, windows[2]!]
    : windows;

  pickFirstFromWindow(priority[0]!);
  for (const w of priority) { if (picked.length >= 2) break; if (usedWindows.has(w.key)) continue; pickFirstFromWindow(w); }
  for (const w of priority) { if (picked.length >= 3) break; if (usedWindows.has(w.key)) { pickLastFromWindow(w); break; } }
  for (const s of slots) { if (picked.length >= 3) break; if (!tooClose(s) && !picked.includes(s)) picked.push(s); }

  return picked.slice(0, 3);
}

// Builds providerIds, providerRulesById, and staffById from Airtable staff
async function buildProviderRulesById(
  baseRules: RulesState,
  filterStaffId?: string
): Promise<{
  providerIds: string[];
  providerRulesById: Record<string, RulesState>;
  staffById: Record<string, { name: string; recordId?: string }>;
}> {
  const staff = await listStaff();
  const eligible = (staff as any[]).filter(
    (s) =>
      s.activo &&
      (s.rol || "").toLowerCase() !== "recepcionista" &&
      parseWorkRange(s.horarioLaboral) !== null &&
      (!filterStaffId || s.staffId === filterStaffId)
  );

  const providerRulesById: Record<string, RulesState> = {};
  const staffById: Record<string, { name: string; recordId?: string }> = {};

  for (const s of eligible) {
    const work = parseWorkRange(s.horarioLaboral);
    if (!work) continue;
    const lunchStart = timeToHHMM(s.almuerzoInicio, "Europe/Madrid");
    const lunchEnd = timeToHHMM(s.almuerzoFin, "Europe/Madrid");
    const enableLunch = !!(lunchStart && lunchEnd);
    providerRulesById[s.staffId] = {
      ...baseRules,
      dayStartTime: work.start,
      dayEndTime: work.end,
      enableLunch,
      lunchStartTime: lunchStart ?? "",
      lunchEndTime: lunchEnd ?? "",
    };
    staffById[s.staffId] = { name: s.name || s.staffId, recordId: s.recordId };
  }

  return { providerIds: Object.keys(providerRulesById), providerRulesById, staffById };
}

// Detects global user intent from normalized text
function detectIntent(text: string): "CANCEL" | "RESCHEDULE" | "BOOK" | "HELP" | null {
  if (text.includes("cancelar") || text.includes("cancel")) return "CANCEL";
  if (text.includes("reagendar") || text.includes("cambiar cita") || text.includes("cambiar mi cita")) return "RESCHEDULE";
  if (text.includes("cita") || text.includes("reservar") || text.includes("turno") || text.includes("pedir hora")) return "BOOK";
  if (text.includes("hola") || text.includes("ayuda") || text.includes("menu") || text.includes("menú") || text.includes("inicio")) return "HELP";
  return null;
}

function renderHelpMenu(name?: string) {
  const greeting = name ? `Hola *${name}* 👋` : `Hola 👋`;
  return (
    `${greeting} Soy el asistente de la clínica. Puedo ayudarte con:\n\n` +
    `📅 *cita* → Reservar una nueva cita\n` +
    `❌ *cancelar* → Cancelar mi próxima cita\n` +
    `🔄 *reagendar* → Cambiar fecha/hora de mi cita\n` +
    `⏳ *lista de espera* → Avisar si se libra algo antes\n\n` +
    `¿Qué necesitas?`
  );
}

// Searches available slots using correct per-provider rules
async function searchSlots(params: {
  sess: Session;
  rules: RulesState;
  treatmentName: string;
  preferences: Preferences;
  filterStaffId?: string;
}): Promise<{ slots: Slot[]; staffById: Record<string, { name: string; recordId?: string }> }> {
  const { sess, rules, treatmentName, preferences, filterStaffId } = params;

  let { providerIds, providerRulesById, staffById } = await buildProviderRulesById(rules, filterStaffId);

  // If filtering by specific doctor yields nothing, fall back to all providers
  if (!providerIds.length && filterStaffId) {
    const all = await buildProviderRulesById(rules);
    providerIds = all.providerIds;
    providerRulesById = all.providerRulesById;
    staffById = all.staffById;
  }

  const slots = await getAvailableSlots(
    { rules, treatmentType: treatmentName, preferences, providerIds, providerRulesById } as any,
    async (dayIso) => listAppointmentsByDay({ dayIso, clinicId: sess.clinicId, onlyActive: true })
  );

  return { slots, staffById };
}

// Finalizes a booking when patient identity is already known.
// Extracted from ASK_PATIENT_NAME so it can be called from multiple points.
async function confirmBookingWithName(params: {
  fromE164: string;
  sess: Session;  // must have pendingHoldId, pendingStart, pendingEnd, pendingStaffRecordId set
  name: string;
}): Promise<string> {
  const { fromE164, sess, name } = params;

  if (!sess.pendingHoldId || !sess.pendingStart || !sess.pendingEnd) {
    await deleteSession(fromE164);
    return "Ese hueco ya no está disponible 😕 Escribe *cita mañana* y te doy nuevas opciones.";
  }

  const patientPhone =
    sess.bookingFor === "OTHER"
      ? (sess.useTutorPhone ? fromE164 : (sess.otherPhoneE164 || fromE164))
      : fromE164;

  try {
    const patient = await upsertPatientByPhone({
      name,
      phoneE164: patientPhone,
      clinicRecordId: sess.clinicRecordId!,
    });

    await confirmHoldToAppointment({
      holdId: sess.pendingHoldId,
      rules: sess.rules,
      patientName: name,
      createAppointment: async (appt) => {
        const created = await createAppointment({
          name,
          startIso: DateTime.fromISO(appt.start).toISO({ suppressMilliseconds: true })!,
          endIso: DateTime.fromISO(appt.end).toISO({ suppressMilliseconds: true })!,
          clinicRecordId: sess.clinicRecordId!,
          staffRecordId: sess.pendingStaffRecordId,
          sillonRecordId: sess.pendingSillonRecordId,
          treatmentRecordId: sess.treatmentRecordId!,
          patientRecordId: patient.recordId,
        });
        return created.recordId;
      },
    });

    await deleteSession(fromE164);
    const confirmMsg =
      `✅ Cita confirmada.\n\n` +
      `👤 ${name}\n` +
      `🦷 ${sess.treatmentName}\n` +
      `📅 ${slotTime(sess.pendingStart)}`;
    return await humanizeReply(confirmMsg, name).catch(() => confirmMsg);
  } catch (e) {
    console.error("[confirmBookingWithName] failed", e);
    await deleteSession(fromE164);
    return "Ese hueco ya no está disponible 😕 Escribe *cita mañana* y te doy nuevas opciones.";
  }
}

// Creates a hold + moves session to ASK_BOOKING_FOR
async function holdSlotAndAskBookingFor(params: {
  fromE164: string;
  sess: Session;
  slot: Slot;
  staffById: Record<string, { name: string; recordId?: string }>;
}): Promise<string> {
  const { fromE164, sess, slot, staffById } = params;

  const hold = await createHoldKV({
    slot,
    patientId: fromE164,
    treatmentType: sess.treatmentName || "Tratamiento",
    ttlMinutes: 10,
  });

  let staffRecordId: string | undefined = staffById?.[slot.providerId]?.recordId;
  if (!staffRecordId) {
    const found = await getStaffRecordIdByStaffId(slot.providerId);
    staffRecordId = found ?? undefined;
  }
  if (!staffRecordId) return "⚠️ No pude identificar al profesional (config interna).";

  const sillonRecordId = await getSillonRecordIdBySillonId(chairIdToSillonId(slot.chairId));
  const providerName = staffById?.[slot.providerId]?.name ?? slot.providerId;

  const holdBase: Session = {
    ...sess,
    createdAtMs: Date.now(),
    slotsTop: [slot],
    staffById,
    pendingHoldId: hold.id,
    pendingStaffRecordId: staffRecordId,
    pendingSillonRecordId: sillonRecordId || undefined,
    pendingStart: slot.start,
    pendingEnd: slot.end,
  };

  const slotInfo = `📅 ${slotTime(slot.start)} con ${providerName}`;

  // Skip ASK_BOOKING_FOR if bookingFor already determined (from ASK_NEW_BOOKING_FOR)
  if (sess.bookingFor === "SELF" && sess.knownPatientName) {
    return confirmBookingWithName({ fromE164, sess: holdBase, name: sess.knownPatientName });
  }
  if (sess.bookingFor === "SELF") {
    const next: Session = { ...holdBase, stage: "ASK_PATIENT_NAME" };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return `Perfecto 🙂 Tengo ese hueco:\n\n${slotInfo}\n\n¿Cuál es tu nombre y apellido?`;
  }
  if (sess.bookingFor === "OTHER") {
    const next: Session = { ...holdBase, stage: "ASK_OTHER_PHONE" };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return `Perfecto 🙂 Tengo ese hueco:\n\n${slotInfo}\n\nPásame el número de la otra persona 🙂 Ej: +34600111222\nSi no tiene teléfono, responde: *no tiene*`;
  }

  // Default: ask who the appointment is for
  const next: Session = { ...holdBase, stage: "ASK_BOOKING_FOR" };
  await setSession(fromE164, next, SESSION_TTL_SECONDS);
  return (
    `Perfecto 🙂 Tengo ese hueco disponible:\n\n` +
    `${slotInfo}\n\n` +
    `¿La cita es para ti o para otra persona?\n1) Para mí\n2) Para otra persona`
  );
}


// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────
export async function handleInboundWhatsApp(params: {
  fromE164: string;
  body: string;
  clinicId: string;
  clinicRecordId?: string;
  rules: RulesState;
}) {
  const { fromE164, body, clinicId, clinicRecordId, rules } = params;
  const text = normalizeText(body);

  // ── 0) Waitlist offer: accept or reject ──────────────────────────────────
  const offered = await getOfferedEntryByPhone({ phoneE164: fromE164 });
  if (offered?.offerHoldId) {
    const wantsAccept = text === "si" || text === "sí" || text.includes("acepto") || text.includes("confirm");
    const wantsReject = text === "no" || text.includes("rechazo") || text.includes("paso");

    if (!wantsAccept && !wantsReject) {
      return `Tienes una oferta pendiente de lista de espera.\nResponde:\n✅ ACEPTO\n❌ NO`;
    }

    if (wantsReject) {
      await markWaitlistActiveWithResult({ waitlistRecordId: offered.recordId, result: "REJECTED" });
      const key = offered.lastOfferedSlotKey || "";
      const [start, end, providerId, chairIdRaw] = key.split("|");
      const chairId = Number(chairIdRaw || "1") || 1;
      if (start && end && providerId) {
        const freed = await onSlotFreed({
          clinicRecordId: offered.clinicRecordId,
          treatmentRecordId: offered.treatmentRecordId!,
          slot: { slotId: key, start, end, providerId, chairId },
        });
        if (freed?.ok && freed?.messagePreview && freed?.patientHint) {
          sendWhatsAppMessage(`whatsapp:${freed.patientHint}`, freed.messagePreview).catch((e) =>
            console.warn("[waitlist] send failed (ignored)", e)
          );
        }
      }
      return "Perfecto 👍 Se lo ofrezco al siguiente de la lista.";
    }

    // Accept waitlist offer
    const tmeta = await getTreatmentMeta({ treatmentRecordId: offered.treatmentRecordId! });
    const bufferMin = (tmeta.bufferBeforeMin || 0) + (tmeta.bufferAfterMin || 0);
    const derivedRules: any = {
      ...DEFAULT_RULES,
      treatments: [{ type: tmeta.name, durationMin: tmeta.durationMin || 30, bufferMin }],
    };
    const out = await confirmHoldToAppointment({
      holdId: offered.offerHoldId,
      rules: derivedRules,
      patientName: "Paciente",
      createAppointment: async (appt) => {
        const created = await createAppointment({
          name: "Cita (waitlist)",
          startIso: DateTime.fromISO(appt.start).toISO({ suppressMilliseconds: true })!,
          endIso: DateTime.fromISO(appt.end).toISO({ suppressMilliseconds: true })!,
          clinicRecordId: offered.clinicRecordId,
          staffRecordId: offered.preferredStaffRecordId,
          treatmentRecordId: offered.treatmentRecordId!,
          patientRecordId: offered.patientRecordId!,
          sillonRecordId: undefined,
        });
        return created.recordId;
      },
    });
    const appointmentRecordId = (out as any)?.appointmentId;
    if (appointmentRecordId) {
      await markWaitlistBooked({ waitlistRecordId: offered.recordId, appointmentRecordId });
      if (offered.citaSeguraRecordId) {
        await cancelAppointment({ appointmentRecordId: offered.citaSeguraRecordId, origin: "Waitlist" });
      }
    }
    return "✅ Listo. Te reservé el hueco.";
  }

  // ── 1) Load session ──────────────────────────────────────────────────────
  const sess = await getSession<Session>(fromE164);

  // ── CONFIRM_ATTENDANCE: handle SÍ/NO response to 24h cron reminder ───────
  if (sess?.stage === "CONFIRM_ATTENDANCE" && sess.attendanceApptRecordId) {
    const isYes = /^(s[ií]|yes|confirmo|ok|claro|perfecto|voy|ahi estare|ahí estaré|estaré)/i.test(body.trim());
    const isNo  = /^(no|cancel|no puedo|imposible|no voy|no asistiré)/i.test(body.trim());

    if (isYes) {
      await confirmAppointment({ appointmentRecordId: sess.attendanceApptRecordId }).catch(() => null);
      await deleteSession(fromE164);
      return "✅ ¡Perfecto! Tu cita queda confirmada. Hasta mañana 🙂";
    }
    if (isNo) {
      await cancelAppointment({ appointmentRecordId: sess.attendanceApptRecordId, origin: "WhatsApp" });
      await deleteSession(fromE164);
      return "Entendido, cancelamos tu cita. Si quieres reprogramar escríbenos cuando quieras. ¡Hasta pronto! 👋";
    }
    return "¿Confirmas tu asistencia para mañana? Responde *SÍ* o *NO*";
  }

  // Personalized greeting: look up patient name only on first contact (no session)
  const patientInfo = !sess ? await getPatientByPhone(fromE164).catch(() => null) : null;

  // ── 2) Global intent detection (LLM with regex fallback) ─────────────────
  const intent = await parseIntentWithLLM(body).catch(() => null) ?? detectIntent(text);

  // ── STOP / opt-out ────────────────────────────────────────────────────────
  if (intent === "STOP" || text === "stop") {
    await Promise.all([
      markPatientOptOut(fromE164).catch(() => null),
      deleteSession(fromE164).catch(() => null),
    ]);
    return "De acuerdo, no te enviaremos más mensajes. Si quieres reactivar el servicio, escríbenos.";
  }
  if (await isPatientOptedOut(fromE164).catch(() => false)) return "";

  // CANCEL: intercepts regardless of active session (except when already in cancel flow)
  if (
    intent === "CANCEL" &&
    sess?.stage !== "CONFIRM_CANCEL" &&
    sess?.stage !== "CANCEL_OFFER_WAITLIST"
  ) {
    const next_ = await findNextAppointmentByContactPhone({ phoneE164: fromE164 });
    if (!next_) {
      await deleteSession(fromE164);
      return "No encontré ninguna cita futura para cancelar 🙂";
    }
    const apptData = await getAppointmentByRecordId(next_.recordId);
    const apptClinicRecordId =
      sess?.clinicRecordId ||
      (Array.isArray((apptData as any)?.fields?.["Clínica"])
        ? (apptData as any).fields["Clínica"][0]
        : undefined);

    const cancelSess: Session = {
      createdAtMs: Date.now(),
      clinicId: sess?.clinicId || clinicId,
      clinicRecordId: apptClinicRecordId || clinicRecordId,
      rules: sess?.rules || rules,
      stage: "CONFIRM_CANCEL",
      slotsTop: [],
      staffById: {},
      pendingCancelRecordId: next_.recordId,
      pendingCancelTreatmentRecordId: apptData?.treatmentRecordId,
      pendingCancelClinicRecordId: apptClinicRecordId || clinicRecordId,
    };
    await setSession(fromE164, cancelSess, SESSION_TTL_SECONDS);

    const startStr = apptData?.start ? slotTime(apptData.start) : "—";
    const treatmentStr = apptData?.treatmentName || "Tratamiento";
    return (
      `Voy a cancelar esta cita:\n\n` +
      `📅 ${startStr}\n` +
      `🦷 ${treatmentStr}\n\n` +
      `¿Confirmas? Responde *SÍ* o *NO*`
    );
  }

  // RESCHEDULE: intercepts regardless of active session (except when already in reschedule flow)
  if (
    intent === "RESCHEDULE" &&
    sess?.stage !== "RESCHEDULE_ASK_WHEN" &&
    sess?.stage !== "RESCHEDULE_OFFER_SLOTS"
  ) {
    const next_ = await findNextAppointmentByContactPhone({ phoneE164: fromE164 });
    if (!next_) return "No encontré ninguna cita futura para reagendar 🙂";

    const apptData = await getAppointmentByRecordId(next_.recordId);
    const reschSess: Session = {
      createdAtMs: Date.now(),
      clinicId: sess?.clinicId || clinicId,
      clinicRecordId: sess?.clinicRecordId || clinicRecordId,
      rules: sess?.rules || rules,
      stage: "RESCHEDULE_ASK_WHEN",
      slotsTop: [],
      staffById: sess?.staffById || {},
      rescheduleFromAppointmentRecordId: apptData.recordId,
      reschedulePatientRecordId: apptData.patientRecordId,
      reschedulePatientName: apptData.patientName,
      rescheduleTreatmentRecordId: apptData.treatmentRecordId,
      rescheduleTreatmentName: apptData.treatmentName,
      rescheduleStaffId: apptData.staffId,
      rescheduleStaffRecordId: apptData.staffRecordId,
      rescheduleSillonRecordId: apptData.sillonRecordId,
      rescheduleDurationMin: apptData.durationMin,
    };
    await setSession(fromE164, reschSess, SESSION_TTL_SECONDS);

    const startStr = apptData?.start ? slotTime(apptData.start) : "—";
    return (
      `Claro 🙂 Vamos a reagendar:\n\n` +
      `🦷 ${apptData?.treatmentName || "Tratamiento"}\n` +
      `📅 Actual: ${startStr}\n\n` +
      `¿Para cuándo la quieres?\n` +
      `Ej: "mañana 15:00", "jueves por la tarde", "hoy a las 10".`
    );
  }

  // HELP: only when no active session
  if (intent === "HELP" && !sess) return renderHelpMenu(patientInfo?.name);

  // ── 2b) Feedback collection ──────────────────────────────────────────────
  if (sess?.stage === "COLLECT_FEEDBACK") {
    const score = parseInt(body.trim(), 10);
    if (isNaN(score) || score < 1 || score > 5) {
      return "Por favor responde con un número del 1 al 5 ⭐ (1 = muy mejorable, 5 = excelente)";
    }

    // Store score in KV for dashboard (90 days TTL)
    await kv.set(
      `fb:${fromE164}:${Date.now()}`,
      { score, name: sess.feedbackPatientName ?? "Paciente", apptId: sess.feedbackApptRecordId ?? "" },
      { ex: 90 * 86400 }
    );

    await deleteSession(fromE164);

    if (score >= 4) {
      const googleUrl = process.env.GOOGLE_REVIEWS_URL ?? "";
      if (googleUrl) {
        return (
          `¡Gracias por tu valoración de ${score} ${score === 5 ? "⭐⭐⭐⭐⭐" : "⭐⭐⭐⭐"}!\n\n` +
          `Nos alegra mucho que hayas tenido una buena experiencia 🙏\n\n` +
          `¿Te importaría dejar una reseña en Google? Es de gran ayuda para nosotros:\n${googleUrl}`
        );
      }
      return `¡Gracias por tu valoración de ${score} estrellas! 🌟 Nos alegra mucho. ¡Hasta pronto!`;
    } else {
      // Low score: store alert for internal dashboard
      await kv.set(
        `fb:alert:${fromE164}:${Date.now()}`,
        { score, name: sess.feedbackPatientName ?? "Paciente", apptId: sess.feedbackApptRecordId ?? "" },
        { ex: 30 * 86400 }
      );
      return (
        `Gracias por tu sinceridad 🙏\n\n` +
        `Sentimos mucho que tu experiencia no haya sido la que esperabas. ` +
        `Nuestro equipo revisará tu comentario y se pondrá en contacto contigo pronto.`
      );
    }
  }

  // ── 3) Cancel flow: CONFIRM_CANCEL ──────────────────────────────────────
  if (sess?.stage === "CONFIRM_CANCEL") {
    const wantsYes = text === "si" || text === "sí" || text.includes("confirm");
    const wantsNo = text === "no";

    if (wantsNo) {
      await deleteSession(fromE164);
      return "De acuerdo, no cancelo nada 🙂 ¿Puedo ayudarte con algo más?";
    }
    if (!wantsYes) {
      return "Responde *SÍ* para confirmar la cancelación, o *NO* para mantenerla.";
    }
    if (!sess.pendingCancelRecordId) {
      await deleteSession(fromE164);
      return "No encontré la cita (error interno). Escribe *cancelar* de nuevo.";
    }

    const full = await getAppointmentByRecordId(sess.pendingCancelRecordId);
    await cancelAppointment({ appointmentRecordId: sess.pendingCancelRecordId, origin: "WhatsApp" });

    // Trigger waitlist engine (best-effort)
    try {
      const cliRec = sess.pendingCancelClinicRecordId || sess.clinicRecordId;
      if (cliRec && full?.start && full?.end && full?.treatmentRecordId && full?.staffId) {
        const freed = await onSlotFreed({
          clinicRecordId: cliRec,
          clinicId: sess.clinicId,
          treatmentRecordId: full.treatmentRecordId,
          slot: {
            slotId: `FREED|${full.start}|${full.end}|${full.staffId}|1`,
            start: full.start,
            end: full.end,
            providerId: full.staffId,
            chairId: 1,
          },
        });
        if (freed?.ok && freed?.messagePreview && freed?.patientHint) {
          sendWhatsAppMessage(`whatsapp:${freed.patientHint}`, freed.messagePreview).catch((e) =>
            console.warn("[cancel] waitlist send failed (ignored)", e)
          );
        }
      }
    } catch (e) {
      console.warn("[cancel] onSlotFreed failed (ignored)", e);
    }

    const waitlistSess: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "CANCEL_OFFER_WAITLIST",
      treatmentRecordId: full?.treatmentRecordId || sess.pendingCancelTreatmentRecordId,
      treatmentName: full?.treatmentName,
    };
    await setSession(fromE164, waitlistSess, SESSION_TTL_SECONDS);

    const cancelMsg = await humanizeReply(
      `✅ Cita cancelada.\n\n¿Quieres apuntarte en lista de espera? Si se libra un hueco antes, te aviso por aquí 🙂\n\nResponde *SÍ* o *NO*`,
      patientInfo?.name,
      "confirmación de cancelación de cita"
    ).catch(() => `✅ Cita cancelada.\n\n¿Quieres apuntarte en lista de espera? Si se libra un hueco antes, te aviso por aquí 🙂\n\nResponde *SÍ* o *NO*`);
    return cancelMsg;
  }

  // ── 4) Cancel flow: CANCEL_OFFER_WAITLIST ───────────────────────────────
  if (sess?.stage === "CANCEL_OFFER_WAITLIST") {
    const wantsYes = text === "si" || text === "sí" || text.includes("apunta") || text.includes("lista");
    const wantsNo = text === "no";

    if (wantsNo) {
      await deleteSession(fromE164);
      return "Entendido 🙂 Si necesitas algo más, escríbeme.";
    }
    if (!wantsYes) {
      return "Responde *SÍ* o *NO* 🙂";
    }
    if (!sess.clinicRecordId || !sess.treatmentRecordId) {
      await deleteSession(fromE164);
      return "⚠️ Me falta información para apuntarte. Escribe *cita* para empezar de nuevo.";
    }

    const patient = await upsertPatientByPhone({
      name: "Paciente",
      phoneE164: fromE164,
      clinicRecordId: sess.clinicRecordId,
    });
    await createWaitlistEntry({
      clinicRecordId: sess.clinicRecordId,
      patientRecordId: patient.recordId,
      treatmentRecordId: sess.treatmentRecordId,
      notas: "Apuntado tras cancelar (WhatsApp)",
    });
    await deleteSession(fromE164);
    return humanizeReply(
      "Listo ✅ Te apunté en lista de espera. Si se libra un hueco, te aviso por aquí.",
      patientInfo?.name,
      "paciente añadido a lista de espera tras cancelar"
    ).catch(() => "Listo ✅ Te apunté en lista de espera. Si se libra un hueco, te aviso por aquí.");
  }

  // ── 5) Reschedule flow: RESCHEDULE_ASK_WHEN ─────────────────────────────
  if (sess?.stage === "RESCHEDULE_ASK_WHEN") {
    const prefs = parseWhen(body);
    if (!prefs.dateIso && !prefs.preferredStartHHMM) {
      return "Dime un día u horario 🙂 Ej: mañana 15:00 / jueves tarde / hoy por la mañana.";
    }

    const derivedRules: RulesState = {
      ...sess.rules,
      treatments: [{
        type: sess.rescheduleTreatmentName || "Tratamiento",
        durationMin: sess.rescheduleDurationMin ?? 30,
        bufferMin: sess.rules.bufferMin ?? 0,
      }],
    };

    const { slots, staffById } = await searchSlots({
      sess,
      rules: derivedRules,
      treatmentName: sess.rescheduleTreatmentName || "Tratamiento",
      preferences: prefs,
      filterStaffId: sess.rescheduleStaffId,
    });

    if (!slots.length) {
      return `😕 No encontré huecos con esas preferencias.\n\nPrueba otro día u horario (ej: "próxima semana por la tarde").`;
    }

    const top = pickDiversifiedTop3(slots, derivedRules, prefs);
    const nextSess: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "RESCHEDULE_OFFER_SLOTS",
      slotsTop: top,
      staffById,
    };
    await setSession(fromE164, nextSess, SESSION_TTL_SECONDS);

    const lines = top.map((slot, i) => {
      const name = staffById?.[slot.providerId]?.name ?? slot.providerId;
      return `${i + 1}) ${slotTime(slot.start)} con ${name}`;
    });
    return `Opciones para reagendar 🙂\n\n${lines.join("\n")}\n\nResponde 1, 2 o 3.`;
  }

  // ── 6) Reschedule flow: RESCHEDULE_OFFER_SLOTS ──────────────────────────
  if (sess?.stage === "RESCHEDULE_OFFER_SLOTS") {
    let idx = Number(normalizeText(body));
    const max = sess.slotsTop?.length || 0;
    if (!Number.isFinite(idx) || idx < 1 || idx > max) {
      const slotOptions = (sess.slotsTop ?? []).map((_s, i) => ({ key: String(i + 1), label: `Opción ${i + 1}` }));
      const llmKey = await parseChoiceWithLLM(body, slotOptions).catch(() => null);
      const llmIdx = llmKey ? Number(llmKey) : NaN;
      if (Number.isFinite(llmIdx) && llmIdx >= 1 && llmIdx <= max) {
        idx = llmIdx;
      } else {
        return `Responde 1${max >= 2 ? ", 2" : ""}${max >= 3 ? " o 3" : ""} 🙂`;
      }
    }
    const chosen = sess.slotsTop[idx - 1];
    if (!chosen) return "Esa opción no existe 🙂";

    let staffRecordId = sess.rescheduleStaffRecordId;
    if (!staffRecordId && chosen.providerId) {
      const found = await getStaffRecordIdByStaffId(chosen.providerId);
      staffRecordId = found ?? undefined;
    }
    const sillonRecordId = await getSillonRecordIdBySillonId(chairIdToSillonId(chosen.chairId));

    await createAppointment({
      name: sess.reschedulePatientName || "Paciente",
      startIso: DateTime.fromISO(chosen.start).toISO({ suppressMilliseconds: true })!,
      endIso: DateTime.fromISO(chosen.end).toISO({ suppressMilliseconds: true })!,
      clinicRecordId: sess.clinicRecordId,
      staffRecordId,
      sillonRecordId: sillonRecordId || undefined,
      treatmentRecordId: sess.rescheduleTreatmentRecordId,
      patientRecordId: sess.reschedulePatientRecordId,
    });

    if (sess.rescheduleFromAppointmentRecordId) {
      await cancelAppointment({
        appointmentRecordId: sess.rescheduleFromAppointmentRecordId,
        origin: "WhatsApp reagendar",
      });
    }

    await deleteSession(fromE164);
    const rescheduleMsg =
      `✅ Reagendado.\n\n` +
      `📅 Nueva cita: ${slotTime(chosen.start)}\n` +
      `🦷 ${sess.rescheduleTreatmentName || "Tratamiento"}\n` +
      `👤 ${sess.reschedulePatientName || "Paciente"}`;
    return humanizeReply(rescheduleMsg, sess.reschedulePatientName, "confirmación de reagendado de cita").catch(() => rescheduleMsg);
  }

  // ── 7) No session: smart START ───────────────────────────────────────────
  if (!sess) {
    if (!intent || intent === "HELP") return renderHelpMenu(patientInfo?.name);

    // Detect existing appointment before starting a new booking
    if (intent === "BOOK") {
      const existing = await findNextAppointmentByContactPhone({ phoneE164: fromE164 }).catch(() => null);
      if (existing) {
        const apptData = await getAppointmentByRecordId(existing.recordId).catch(() => null);
        const isFuture = apptData?.start
          ? DateTime.fromISO(apptData.start).setZone("Europe/Madrid") > DateTime.now().setZone("Europe/Madrid")
          : false;
        if (isFuture && apptData?.start) {
          const dateStr = DateTime.fromISO(apptData.start)
            .setZone("Europe/Madrid")
            .setLocale("es")
            .toFormat("EEEE d 'de' MMMM");
          const timeStr = slotTime(apptData.start);
          const treatStr = apptData.treatmentName || "una cita";
          const warnSess: Session = {
            createdAtMs: Date.now(),
            stage: "ASK_NEW_BOOKING_FOR",
            clinicId,
            clinicRecordId,
            rules,
            slotsTop: [],
            staffById: {},
            knownPatientName: patientInfo?.name ?? undefined,
          };
          await setSession(fromE164, warnSess, SESSION_TTL_SECONDS);
          return (
            `Hola 🙂 Ya tienes *${treatStr}* el *${dateStr}* a las *${timeStr}*.\n\n` +
            `¿Esta nueva cita también es para ti, o es para otra persona?\n` +
            `1) También es para mí\n` +
            `2) Es para otra persona`
          );
        }
      }
    }

    const treatments = await listTreatments({ clinicRecordId });
    if (!treatments.length) return "⚠️ No encontré tratamientos configurados.";

    const list = treatments.map((t: any) => ({ recordId: t.recordId, name: t.name }));
    const chosen = findTreatmentSmart(list, body);

    if (chosen) {
      const when = parseWhen(body);
      const staff = await listStaff();
      const activeStaff = (staff as any[]).filter(
        (s) => s.activo && (s.rol || "").toLowerCase() !== "recepcionista"
      );
      const detectedDoc = findDoctorSmart(
        activeStaff.map((s: any) => ({ staffId: s.staffId, name: s.name })),
        body
      );
      const hasWhen = !!(when?.dateIso || when?.preferredStartHHMM || when?.preferredEndHHMM);

      const next: Session = {
        createdAtMs: Date.now(),
        stage: detectedDoc ? "ASK_WHEN" : "ASK_DOCTOR",
        clinicId,
        clinicRecordId,
        rules,
        treatmentRecordId: chosen.recordId,
        treatmentName: chosen.name,
        preferredDoctorMode: detectedDoc ? "SPECIFIC" : undefined,
        preferredStaffId: detectedDoc?.staffId,
        slotsTop: [],
        staffById: {},
        preferences: when || {},
      };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);

      if (!detectedDoc) {
        return `Perfecto 🙂 Para *${chosen.name}*.\n¿Tienes preferencia de doctor?\n\nResponde:\n1) Cualquiera\n2) Quiero uno específico (escribe el nombre)`;
      }
      if (hasWhen) {
        return await handleInboundWhatsApp({ fromE164, body: "__USE_SAVED_PREFS__", clinicId, clinicRecordId, rules });
      }
      return `Perfecto 🙂 Para *${chosen.name}* con *${detectedDoc.name}*.\n¿Para cuándo la quieres?\nEj: "mañana 15:00", "hoy tarde", "martes por la mañana".`;
    }

    // No treatment detected: show list
    const next: Session = {
      createdAtMs: Date.now(),
      stage: "ASK_TREATMENT",
      clinicId,
      clinicRecordId,
      rules,
      slotsTop: [],
      staffById: {},
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return renderTreatmentsList(list);
  }

  // ── 7b) Stage: ASK_NEW_BOOKING_FOR ───────────────────────────────────────
  if (sess.stage === "ASK_NEW_BOOKING_FOR") {
    const t = normalizeText(body);
    const forOther =
      t === "2" || t.includes("otra") || t.includes("otro") ||
      t.includes("para un") || t.includes("para una");
    const forSelf =
      t === "1" || t.includes("para mi") || t.includes("para mí") ||
      t === "yo" || t.includes("tambien") || t.includes("también");

    let isForOther: boolean | null = forOther ? true : forSelf ? false : null;
    if (isForOther === null) {
      const llmKey = await parseChoiceWithLLM(
        body,
        [
          { key: "SELF", label: "La cita también es para mí" },
          { key: "OTHER", label: "La cita es para otra persona" },
        ]
      ).catch(() => null);
      if (llmKey === "OTHER") isForOther = true;
      else if (llmKey === "SELF") isForOther = false;
    }

    if (isForOther === null) {
      return "Responde 1 (también para mí) o 2 (para otra persona) 🙂";
    }

    const treatments = await listTreatments({ clinicRecordId });
    if (!treatments.length) return "⚠️ No encontré tratamientos configurados.";

    const treatList = treatments.map((t: any) => ({ recordId: t.recordId, name: t.name }));
    const nextStage: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "ASK_TREATMENT",
      bookingFor: isForOther ? "OTHER" : "SELF",
    };
    await setSession(fromE164, nextStage, SESSION_TTL_SECONDS);
    return renderTreatmentsList(treatList);
  }

  // ── 8) Stage: ASK_TREATMENT ──────────────────────────────────────────────
  if (sess.stage === "ASK_TREATMENT") {
    const treatments = await listTreatments({ clinicRecordId });
    const list = treatments.map((t: any) => ({ recordId: t.recordId, name: t.name }));
    const chosen = findTreatmentSmart(list, body);

    if (!chosen) return "No encontré ese tratamiento 😅 Responde con número o nombre exacto.";

    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "ASK_DOCTOR",
      treatmentRecordId: chosen.recordId,
      treatmentName: chosen.name,
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return `Perfecto 🙂 Para *${chosen.name}*.\n¿Quieres algún doctor en específico?\n\nResponde:\n1) Cualquiera\n2) Quiero uno específico (escribe el nombre)`;
  }

  // ── 9) Stage: ASK_DOCTOR ─────────────────────────────────────────────────
  if (sess.stage === "ASK_DOCTOR") {
    const t = normalizeText(body);
    let preferredDoctorMode: Session["preferredDoctorMode"] = "ANY";
    let preferredStaffId: string | undefined;

    if (
      t === "1" || t.includes("cualquiera") || t.includes("da igual") ||
      t.includes("indiferente") || t.includes("no importa") || t.includes("no me importa")
    ) {
      preferredDoctorMode = "ANY";
    } else {
      if (t === "2" || t.includes("especifico") || t.includes("específico")) {
        return "Dime el nombre del doctor 🙂 (ej: Mateo)";
      }
      const staff = await listStaff();
      const activeStaff = (staff as any[]).filter(
        (s) => s.activo && (s.rol || "").toLowerCase() !== "recepcionista"
      );
      const doc = findDoctorSmart(
        activeStaff.map((s: any) => ({ staffId: s.staffId, name: s.name })),
        body
      );
      if (!doc) {
        const llmKey = await parseChoiceWithLLM(
          body,
          [
            { key: "ANY", label: "Cualquiera, no tengo preferencia de doctor" },
            { key: "SPECIFIC", label: "Quiero un doctor específico (conozco el nombre)" },
          ]
        ).catch(() => null);
        if (llmKey === "ANY") {
          preferredDoctorMode = "ANY";
        } else if (llmKey === "SPECIFIC") {
          return "Dime el nombre del doctor 🙂 (ej: Mateo)";
        } else {
          return "No encontré ese doctor 😅 Escríbeme el nombre tal cual aparece en la clínica, o responde 1) Cualquiera.";
        }
      } else {
        preferredDoctorMode = "SPECIFIC";
        preferredStaffId = doc.staffId;
      }
    }

    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "ASK_WHEN",
      preferredDoctorMode,
      preferredStaffId,
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);

    // If we already had date/time from the first message, search slots now
    if (next.preferences?.dateIso || next.preferences?.preferredStartHHMM) {
      return await handleInboundWhatsApp({ fromE164, body: "__USE_SAVED_PREFS__", clinicId, clinicRecordId, rules });
    }
    return `Genial 🙂 ¿Para cuándo la quieres?\nEj: "mañana 15:00", "hoy tarde", "mañana por la mañana".`;
  }

  // ── 10) Stage: ASK_WHEN ──────────────────────────────────────────────────
  if (sess.stage === "ASK_WHEN") {
    const stored = sess.preferences || {};
    const parsed = body === "__USE_SAVED_PREFS__" ? {} : parseWhen(body);

    const storedHas = !!(stored.dateIso || stored.preferredStartHHMM);
    const parsedHas = !!(parsed.dateIso || parsed.preferredStartHHMM);

    let prefs: Preferences & { exactTime?: boolean } =
      body === "__USE_SAVED_PREFS__" ? stored
      : storedHas ? stored
      : parsed;

    if (!storedHas && !parsedHas && body !== "__USE_SAVED_PREFS__") {
      const todayIso = DateTime.now().setZone("Europe/Madrid").toISODate()!;
      const llmParsed = await parseWhenWithLLM(body, todayIso).catch(() => null);
      if (llmParsed && (llmParsed.dateIso || llmParsed.preferredStartHHMM)) {
        prefs = { ...prefs, ...llmParsed };
      } else {
        return "Dime un día u hora aproximada 🙂 Ej: mañana 15:00 / hoy tarde / martes por la mañana.";
      }
    }

    const filterStaffId = sess.preferredDoctorMode === "SPECIFIC" ? sess.preferredStaffId : undefined;
    const { slots, staffById } = await searchSlots({
      sess,
      rules: sess.rules,
      treatmentName: sess.treatmentName || "Tratamiento",
      preferences: prefs,
      filterStaffId,
    });

    if (!slots.length) {
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST", preferences: prefs, staffById };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return `😕 No encontré huecos disponibles.\n\nDime otro día u horario que te venga bien, o responde *lista de espera* para que te avise si se libra algo.`;
    }

    // Exact time requested?
    if (prefs.exactTime && prefs.preferredStartHHMM) {
      const wanted = prefs.preferredStartHHMM;
      const slotHHMM = (iso: string) => DateTime.fromISO(iso).setZone("Europe/Madrid").toFormat("HH:mm");
      const slotDateIso = (iso: string) => DateTime.fromISO(iso).setZone("Europe/Madrid").toISODate();

      const exactSlot = slots.find((s) => slotHHMM(s.start) === wanted);

      if (exactSlot) {
        // Exact match → hold directly → ASK_BOOKING_FOR
        return await holdSlotAndAskBookingFor({ fromE164, sess: { ...sess, preferences: prefs, staffById }, slot: exactSlot, staffById });
      }

      // No exact match → try nearby slots same day
      const dateForSearch = prefs.dateIso || slotDateIso(slots[0]?.start ?? "") || "";
      const nearby = pickClosestBeforeAfterSameDay(slots, dateForSearch, wanted);

      if (nearby.length) {
        const next: Session = {
          ...sess,
          createdAtMs: Date.now(),
          stage: "OFFER_SLOTS",
          preferences: prefs,
          slotsTop: nearby,
          staffById,
        };
        await setSession(fromE164, next, SESSION_TTL_SECONDS);

        const lines = nearby.map((slot, i) => {
          const name = staffById?.[slot.providerId]?.name ?? slot.providerId;
          return `${i + 1}) ${slotTime(slot.start)} con ${name}`;
        });
        return (
          `😕 A las *${wanted}* no tengo hueco.\n\n` +
          `Las opciones más cercanas ese día son:\n\n` +
          `${lines.join("\n")}\n\n` +
          `Responde 1${nearby.length >= 2 ? " o 2" : ""}, o escribe *otro horario*.`
        );
      }

      // Nothing nearby that day → OFFER_WAITLIST
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST", preferences: prefs, staffById };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return `😕 Ese día no tengo huecos disponibles.\n\nDime otro día u horario que te venga bien, o escribe *lista de espera* para avisarte cuando se libra algo.`;
    }

    // Time range (not exact): offer diversified top 3
    const top = pickDiversifiedTop3(slots, sess.rules, prefs);
    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "OFFER_SLOTS",
      preferences: prefs,
      slotsTop: top,
      staffById,
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);

    const lines = top.map((slot, i) => {
      const name = staffById?.[slot.providerId]?.name ?? slot.providerId;
      return `${i + 1}) ${slotTime(slot.start)} con ${name}`;
    });

    // Mention waitlist if best option is far away
    const firstSlot = top[0];
    const daysUntilFirst = firstSlot
      ? Math.round(DateTime.fromISO(firstSlot.start).setZone("Europe/Madrid").diffNow("days").days)
      : 0;
    const waitlistNote = daysUntilFirst > DAYS_UNTIL_WAITLIST_OFFER
      ? `\n\nSi prefieres algo antes, puedes escribir *lista de espera* y te aviso si se libra.`
      : "";

    return (
      `Estas son las opciones más cercanas 🙂\n\n` +
      `${lines.join("\n")}\n\n` +
      `Responde 1, 2 o 3.\nSi ninguna te sirve, escribe: *otro horario*.` +
      waitlistNote
    );
  }

  // ── 11) Stage: OFFER_SLOTS ───────────────────────────────────────────────
  if (sess.stage === "OFFER_SLOTS") {
    const t = normalizeText(body);

    // "no me sirve" / "otro horario" → ask for new preferences
    if (t.includes("no me sirve") || t.includes("otro horario") || t.includes("otro dia") || t === "no") {
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return `Vale. Dime otro día u horario que te venga mejor 🙂\nO escribe *lista de espera* para avisarte si se libra algo.`;
    }

    // "lista de espera"
    if (t.includes("lista") || t.includes("espera") || t.includes("apunta")) {
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return "¿Quieres apuntarte en lista de espera? Responde *SÍ* y te aviso si se libra un hueco 🙂";
    }

    let idx = Number(t);
    const max = sess.slotsTop?.length || 0;
    if (!Number.isFinite(idx) || idx < 1 || idx > max) {
      const slotOptions = (sess.slotsTop ?? []).map((_s, i) => ({ key: String(i + 1), label: `Opción ${i + 1}` }));
      const llmKey = await parseChoiceWithLLM(body, slotOptions).catch(() => null);
      const llmIdx = llmKey ? Number(llmKey) : NaN;
      if (Number.isFinite(llmIdx) && llmIdx >= 1 && llmIdx <= max) {
        idx = llmIdx;
      } else {
        return `Responde 1${max >= 2 ? ", 2" : ""}${max >= 3 ? " o 3" : ""} 🙂`;
      }
    }

    const chosen = sess.slotsTop[idx - 1];
    if (!chosen) return "Esa opción no existe 🙂";

    const hold = await createHoldKV({
      slot: chosen,
      patientId: fromE164,
      treatmentType: sess.treatmentName || "Tratamiento",
      ttlMinutes: 10,
    });

    let staffRecordId: string | undefined = sess.staffById?.[chosen.providerId]?.recordId;
    if (!staffRecordId) {
      const found = await getStaffRecordIdByStaffId(chosen.providerId);
      staffRecordId = found ?? undefined;
    }
    if (!staffRecordId) return "⚠️ No pude identificar al profesional (config interna).";

    const sillonRecordId = await getSillonRecordIdBySillonId(chairIdToSillonId(chosen.chairId));

    const holdBase: Session = {
      ...sess,
      createdAtMs: Date.now(),
      pendingHoldId: hold.id,
      pendingStaffRecordId: staffRecordId,
      pendingSillonRecordId: sillonRecordId || undefined,
      pendingStart: chosen.start,
      pendingEnd: chosen.end,
    };

    // Skip ASK_BOOKING_FOR if bookingFor already determined (from ASK_NEW_BOOKING_FOR)
    if (sess.bookingFor === "SELF" && sess.knownPatientName) {
      return confirmBookingWithName({ fromE164, sess: holdBase, name: sess.knownPatientName });
    }
    if (sess.bookingFor === "SELF") {
      await setSession(fromE164, { ...holdBase, stage: "ASK_PATIENT_NAME" }, SESSION_TTL_SECONDS);
      return "Perfecto 🙂 ¿Cuál es tu nombre y apellido?";
    }
    if (sess.bookingFor === "OTHER") {
      await setSession(fromE164, { ...holdBase, stage: "ASK_OTHER_PHONE" }, SESSION_TTL_SECONDS);
      return "Pásame el número de la otra persona 🙂 Ej: +34600111222\nSi no tiene teléfono, responde: *no tiene*";
    }
    await setSession(fromE164, { ...holdBase, stage: "ASK_BOOKING_FOR" }, SESSION_TTL_SECONDS);
    return `Perfecto 🙂 ¿La cita es para ti o para otra persona?\n1) Para mí\n2) Para otra persona`;
  }

  // ── 12) Stage: OFFER_WAITLIST ────────────────────────────────────────────
  if (sess.stage === "OFFER_WAITLIST") {
    const t = normalizeText(body);

    const wantsWaitlist =
      t === "si" || t === "sí" ||
      t.includes("lista") || t.includes("espera") || t.includes("apunta");

    if (wantsWaitlist) {
      if (!sess.clinicRecordId || !sess.treatmentRecordId) {
        await deleteSession(fromE164);
        return "⚠️ Me falta información (clínica o tratamiento). Escribe *cita* para empezar de nuevo.";
      }
      const patient = await upsertPatientByPhone({
        name: "Paciente",
        phoneE164: fromE164,
        clinicRecordId: sess.clinicRecordId,
      });

      const rangoStartIso = sess.preferences?.dateIso && sess.preferences?.preferredStartHHMM
        ? DateTime.fromISO(`${sess.preferences.dateIso}T${sess.preferences.preferredStartHHMM}`, { zone: "Europe/Madrid" })
            .toISO({ suppressMilliseconds: true })!
        : undefined;
      const rangoEndIso = sess.preferences?.dateIso && sess.preferences?.preferredEndHHMM
        ? DateTime.fromISO(`${sess.preferences.dateIso}T${sess.preferences.preferredEndHHMM}`, { zone: "Europe/Madrid" })
            .toISO({ suppressMilliseconds: true })!
        : undefined;

      await createWaitlistEntry({
        clinicRecordId: sess.clinicRecordId,
        patientRecordId: patient.recordId,
        treatmentRecordId: sess.treatmentRecordId,
        preferredStaffRecordId: sess.preferredStaffRecordId || undefined,
        rangoStartIso,
        rangoEndIso,
        notas: "Creado por WhatsApp (core)",
      });
      await deleteSession(fromE164);
      return humanizeReply(
        "Listo ✅ Te apunté en lista de espera. Si se libra un hueco, te aviso por aquí.",
        patientInfo?.name,
        "paciente añadido a lista de espera"
      ).catch(() => "Listo ✅ Te apunté en lista de espera. Si se libra un hueco, te aviso por aquí.");
    }

    // New time preference → re-search
    const prefs = parseWhen(body);
    const hasNewPrefs = !!(prefs.dateIso || prefs.preferredStartHHMM);

    if (!hasNewPrefs) {
      return `Dime un día u horario que te venga bien 🙂\nEj: "jueves tarde", "próxima semana", "martes 11:00".\nO escribe *lista de espera* para que te avise si se libra algo.`;
    }

    const filterStaffId = sess.preferredDoctorMode === "SPECIFIC" ? sess.preferredStaffId : undefined;
    const { slots, staffById } = await searchSlots({
      sess,
      rules: sess.rules,
      treatmentName: sess.treatmentName || "Tratamiento",
      preferences: prefs,
      filterStaffId,
    });

    if (!slots.length) {
      return `😕 Tampoco hay huecos con esa preferencia.\n\nPrueba otra fecha u horario, o escribe *lista de espera* y te aviso si se libra algo.`;
    }

    const top = pickDiversifiedTop3(slots, sess.rules, prefs);
    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "OFFER_SLOTS",
      preferences: prefs,
      slotsTop: top,
      staffById,
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);

    const lines = top.map((slot, i) => {
      const name = staffById?.[slot.providerId]?.name ?? slot.providerId;
      return `${i + 1}) ${slotTime(slot.start)} con ${name}`;
    });

    const firstSlot = top[0];
    const daysUntilFirst = firstSlot
      ? Math.round(DateTime.fromISO(firstSlot.start).setZone("Europe/Madrid").diffNow("days").days)
      : 0;
    const waitlistNote = daysUntilFirst > DAYS_UNTIL_WAITLIST_OFFER
      ? `\n\nSi prefieres algo antes, escribe *lista de espera*.`
      : "";

    return (
      `Estas son las opciones 🙂\n\n${lines.join("\n")}\n\n` +
      `Responde 1${top.length >= 2 ? ", 2" : ""}${top.length >= 3 ? " o 3" : ""}, o *otro horario*.` +
      waitlistNote
    );
  }

  // ── 13) Booking flow: ASK_BOOKING_FOR ────────────────────────────────────
  if (sess.stage === "ASK_BOOKING_FOR") {
    const t = normalizeText(body);

    if (t === "1" || t.includes("para mi") || t.includes("para mí") || t === "yo" || t.includes("es para mi")) {
      const next: Session = { ...sess, createdAtMs: Date.now(), bookingFor: "SELF", stage: "ASK_PATIENT_NAME" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return "Perfecto 🙂 ¿Cuál es tu nombre y apellido?";
    }
    if (t === "2" || t.includes("otra") || t.includes("otro") || t.includes("para un") || t.includes("para una")) {
      const next: Session = { ...sess, createdAtMs: Date.now(), bookingFor: "OTHER", stage: "ASK_OTHER_PHONE" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return "Pásame el número en formato internacional 🙂 Ej: +34600111222\nSi no tiene teléfono, responde: *no tiene*";
    }
    // LLM fallback
    const llmBookFor = await parseChoiceWithLLM(
      body,
      [
        { key: "SELF", label: "La cita es para mí mismo" },
        { key: "OTHER", label: "La cita es para otra persona" },
      ]
    ).catch(() => null);
    if (llmBookFor === "SELF") {
      const next: Session = { ...sess, createdAtMs: Date.now(), bookingFor: "SELF", stage: "ASK_PATIENT_NAME" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return "Perfecto 🙂 ¿Cuál es tu nombre y apellido?";
    }
    if (llmBookFor === "OTHER") {
      const next: Session = { ...sess, createdAtMs: Date.now(), bookingFor: "OTHER", stage: "ASK_OTHER_PHONE" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return "Pásame el número en formato internacional 🙂 Ej: +34600111222\nSi no tiene teléfono, responde: *no tiene*";
    }
    return "Responde 1 (para mí) o 2 (para otra persona).";
  }

  // ── 14) Booking flow: ASK_OTHER_PHONE ────────────────────────────────────
  if (sess.stage === "ASK_OTHER_PHONE") {
    const t = normalizeText(body);
    const saidNoPhone = t.includes("no tiene") || t.includes("sin telefono") || t.includes("sin teléfono");

    if (saidNoPhone) {
      const next: Session = { ...sess, createdAtMs: Date.now(), useTutorPhone: true, otherPhoneE164: undefined, stage: "ASK_PATIENT_NAME" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return "Perfecto 🙂 ¿Cuál es el nombre y apellido de la persona?";
    }

    const phone = body.trim();
    const isE164 = /^\+\d{8,15}$/.test(phone);
    if (!isE164) return "Pásamelo así porfa: +346XXXXXXXX 🙂 o responde *no tiene*";

    const next: Session = { ...sess, createdAtMs: Date.now(), otherPhoneE164: phone, useTutorPhone: false, stage: "ASK_PATIENT_NAME" };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return "Perfecto 🙂 ¿Cuál es el nombre y apellido de la persona?";
  }

  // ── 15) Booking flow: ASK_PATIENT_NAME ───────────────────────────────────
  if (sess.stage === "ASK_PATIENT_NAME") {
    const name = body.trim();
    if (name.length < 3) return "¿Me lo repites? Nombre y apellido 🙂";
    return confirmBookingWithName({ fromE164, sess, name });
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return renderHelpMenu();
}


// ─────────────────────────────────────────────
// TWILIO HTTP HANDLER
// ─────────────────────────────────────────────
export async function handleTwilioWhatsAppPOST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  let fromRaw = "";
  let bodyRaw = "";
  let msgSid = "";

  if (ct.includes("application/x-www-form-urlencoded")) {
    const raw = await req.text();
    const p = new URLSearchParams(raw);
    fromRaw = String(p.get("From") || "");
    bodyRaw = String(p.get("Body") || "").trim();
    msgSid = String(p.get("MessageSid") || "");
  } else {
    const form = await req.formData();
    fromRaw = String(form.get("From") || "");
    bodyRaw = String(form.get("Body") || "").trim();
    msgSid = String(form.get("MessageSid") || "");
  }

  const fromE164 = fromRaw.replace("whatsapp:", "").trim();

  if (msgSid && (await isDuplicateMessage(msgSid))) {
    const xml = twimlMessage("✅ Recibido.");
    return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  }

  const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
  const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID;

  const rules: RulesState = (() => {
    const raw = process.env.DEMO_RULES_JSON;
    if (!raw) return DEFAULT_RULES;
    try { return { ...DEFAULT_RULES, ...JSON.parse(raw) }; }
    catch { return DEFAULT_RULES; }
  })();

  const replyText = await handleInboundWhatsApp({ fromE164, body: bodyRaw, clinicId, clinicRecordId, rules });

  const xml = twimlMessage(replyText);
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
