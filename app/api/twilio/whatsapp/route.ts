// app/api/twilio/whatsapp/route.ts
import { NextResponse } from "next/server";
import { twimlMessage } from "../../../lib/twilio/twiml";

import {
  getAvailableSlots,
  createHold,
  confirmHoldToAppointment,
} from "../../../lib/scheduler";

import {
  listAppointmentsByDay,
  createAppointment,
  getStaffRecordIdByStaffId,
  getSillonRecordIdBySillonId,
} from "../../../lib/scheduler/repo/airtableRepo";

import { listStaff } from "../../../lib/scheduler/repo/staffRepo";
import { listTreatments } from "../../../lib/scheduler/repo/treatmentsRepo";

import type { Preferences, Slot } from "../../../lib/scheduler/types";
import type { RulesState } from "../../../lib/types";
import { DEFAULT_RULES } from "../../../lib/demoData";
import { formatTime } from "../../../lib/time";
import { DateTime } from "luxon";

// ⚠️ Recomendado en Vercel
export const runtime = "nodejs";

/* ---------------------------------------
   Helpers para top-3 “humano”
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

function pickDiversifiedTop3(
  slots: Slot[],
  rules: RulesState,
  preferences: Preferences
): Slot[] {
  if (!slots.length) return [];

  const windows: Window[] = [
    { key: "AM_EARLY", startMin: 8 * 60, endMin: 11 * 60 },
    { key: "AM_LATE", startMin: 11 * 60, endMin: 14 * 60 },
    { key: "PM", startMin: 16 * 60, endMin: 20 * 60 },
  ];

  const minGap = Math.max(
    60,
    (rules.minBookableSlotMin ?? 30) + (rules.bufferMin ?? 0)
  );

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
    const cand = [...slots]
      .filter((s) => inWindow(s, w) && !tooClose(s))
      .slice(-1)[0];
    if (cand) {
      picked.push(cand);
      usedWindows.add(w.key);
    }
  };

  const prefStart = preferences.preferredStartHHMM
    ? hhmmToMin(preferences.preferredStartHHMM)
    : null;

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
   Sesiones (MVP)
---------------------------------------- */
type SessionStage = "ASK_TREATMENT" | "OFFER_SLOTS";

type Session = {
  createdAtMs: number;

  clinicId: string;
  clinicRecordId?: string;
  rules: RulesState;

  stage: SessionStage;

  treatmentType?: string;

  treatments?: {
    id: string;
    name: string;
    durationMin?: number;
    bufferBeforeMin?: number;
    bufferAfterMin?: number;
  }[];

  lastPreferences?: Preferences;

  slotsTop: Slot[];

  staffById: Record<string, { name: string; recordId?: string }>;
};

const SESSIONS = new Map<string, Session>();
const SESSION_TTL_MS = 10 * 60 * 1000;

/* ---------------------------------------
   Utils
---------------------------------------- */
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
function chairIdToSillonId(chairId: number) {
  const n = Math.max(1, Math.floor(chairId || 1));
  return `CHR_${String(n).padStart(2, "0")}`;
}
export function toAirtableDateTime(isoLocal: string, zone = "Europe/Madrid"): string {
  if (!isoLocal) throw new Error("toAirtableDateTime: isoLocal vacío");
  const dt = DateTime.fromISO(isoLocal, { zone });
  if (!dt.isValid) throw new Error(`toAirtableDateTime: fecha inválida: ${isoLocal}`);
  return dt.toISO({ suppressMilliseconds: true })!;
}

function parsePreferences(textLower: string): Preferences {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toDateIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let dateIso: string | undefined;

  if (textLower.includes("hoy")) dateIso = toDateIso(now);
  if (textLower.includes("mañana")) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    dateIso = toDateIso(d);
  }

  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;

  const saysMorning = textLower.includes("por la mañana") || textLower.includes("en la mañana");
  if (saysMorning) {
    preferredStartHHMM = "09:00";
    preferredEndHHMM = "13:00";
  } else if (textLower.includes("tarde")) {
    preferredStartHHMM = "15:00";
    preferredEndHHMM = "19:00";
  }

  return { dateIso, preferredStartHHMM, preferredEndHHMM };
}

function parseIndex(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1) return null;
  return n - 1;
}

/* ---------------------------------------
   Builders de respuesta
---------------------------------------- */
function renderTreatmentsList(treatments: Session["treatments"]) {
  const list = treatments ?? [];
  const lines = list.slice(0, 12).map((t, i) => `${i + 1}️⃣ ${t.name}`);
  return (
    `Perfecto 🙂 ¿Qué tratamiento necesitas?\n\n` +
    (lines.length ? lines.join("\n") : "No hay tratamientos disponibles.") +
    `\n\nResponde con el número.`
  );
}

async function buildAndOfferSlots(params: {
  from: string;
  sess: Session;
  preferences: Preferences;
}): Promise<NextResponse> {
  const { from, sess, preferences } = params;

  const staff = await listStaff();
  const activeStaff = staff.filter((s: any) => s.activo);

  const eligible = activeStaff
    .filter((s: any) => !!parseWorkRange(s.horarioLaboral))
    .filter((s: any) => (s.rol || "").toLowerCase() !== "recepcionista");

  if (!eligible.length) {
    const xmlNoStaff = twimlMessage("⚠️ No encontré profesionales activos con horario laboral configurado en Airtable.");
    return new NextResponse(xmlNoStaff, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  }

  const providerRulesById: Record<string, RulesState> = {};
  const staffById: Record<string, { name: string; recordId?: string }> = {};

  for (const s of eligible as any[]) {
    const work = parseWorkRange(s.horarioLaboral);
    if (!work) continue;

    const lunchStart = timeToHHMM(s.almuerzoInicio, "Europe/Madrid");
    const lunchEnd = timeToHHMM(s.almuerzoFin, "Europe/Madrid");
    const enableLunch = !!(lunchStart && lunchEnd);

    providerRulesById[s.staffId] = {
      ...sess.rules,
      dayStartTime: work.start,
      dayEndTime: work.end,
      enableLunch,
      lunchStartTime: lunchStart ?? "",
      lunchEndTime: lunchEnd ?? "",
    };

    staffById[s.staffId] = { name: s.name || s.staffId, recordId: s.recordId };
  }

  const providerIds = Object.keys(providerRulesById);

  const treatmentType = sess.treatmentType ?? (sess.rules.treatments?.[0]?.type ?? "Revisión");

  const slots = await getAvailableSlots(
    { rules: sess.rules, treatmentType, preferences, providerIds, providerRulesById } as any,
    async (dayIso) => {
      const appts = await listAppointmentsByDay({ dayIso, clinicId: sess.clinicId });
      return appts;
    }
  );

  if (!slots.length) {
    const xmlNoSlots = twimlMessage(
      "😕 No encontré huecos con esas preferencias. Prueba otro día u horario (ej: 'cita mañana por la mañana')."
    );
    return new NextResponse(xmlNoSlots, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  }

  const top = pickDiversifiedTop3(slots, sess.rules, preferences);

  const nextSess: Session = {
    ...sess,
    createdAtMs: Date.now(),
    stage: "OFFER_SLOTS",
    treatmentType,
    lastPreferences: preferences,
    slotsTop: top,
    staffById,
  };
  SESSIONS.set(from, nextSess);
  console.log("[session] set", { from, stage: nextSess.stage, treatments: nextSess.treatments?.length, slotsTop: nextSess.slotsTop?.length });

  const options = top.map((slot, i) => {
    const name = staffById?.[slot.providerId]?.name ?? slot.providerId ?? "Profesional";
    return `${i + 1}️⃣ ${formatTime(slot.start)} con ${name}`;
  });

  const xmlOptions = twimlMessage(
    `Perfecto 🙂 Estas son las opciones disponibles:\n\n` +
      options.join("\n") +
      `\n\nResponde con el número que prefieras.`
  );

  return new NextResponse(xmlOptions, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

/* ---------------------------------------
   Handler principal
---------------------------------------- */
export async function POST(req: Request) {
  cleanupSessions();

  const form = await req.formData();
  const fromRaw = safe(form.get("From"));
  const bodyRaw = safe(form.get("Body")).trim();
  const msgSid = safe(form.get("MessageSid"));

  const from = normalizeWhatsAppFrom(fromRaw);
  const textLower = bodyRaw.toLowerCase();

  // ✅ SOLO AQUÍ se calculan (una vez)
  const idxAny = parseIndex(bodyRaw);
  const sess = SESSIONS.get(from);

  console.log("[twilio/whatsapp] inbound", { from: fromRaw, fromNorm: from, body: bodyRaw, msgSid });
  console.log("[session] lookup", { from, has: SESSIONS.has(from), size: SESSIONS.size, idxAny, stage: sess?.stage });

  try {
    // Contexto demo
    const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID;
    const baseRules = getDemoRules();

    if (!baseRules.dayStartTime || !baseRules.dayEndTime) {
      const xmlConfig = twimlMessage("⚠️ Config incompleta: faltan horarios (dayStartTime/dayEndTime).");
      return new NextResponse(xmlConfig, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    // ✅ FIX inmediato: llegó número pero no hay sesión => no hacemos echo
    if (idxAny !== null && !sess) {
      const xml = twimlMessage(
        "Se me fue la sesión 😅 Escribe 'cita mañana' otra vez y te muestro tratamientos."
      );
      return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    /* ======================================================
       A) Si el usuario envía un número y hay sesión -> resolver
    ======================================================= */
    if (idxAny !== null && sess) {
      // A1) Elegir tratamiento
      if (sess.stage === "ASK_TREATMENT") {
        const list = sess.treatments ?? [];
        const chosenT = list[idxAny];

        if (!chosenT) {
          const xmlBad = twimlMessage("Ese tratamiento no existe. Responde con un número de la lista 🙂");
          return new NextResponse(xmlBad, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
        }

        const durationMin = chosenT.durationMin ?? 30;
        const bufferMin = (chosenT.bufferBeforeMin ?? 0) + (chosenT.bufferAfterMin ?? 0);

        const derivedRules: RulesState = {
          ...sess.rules,
          treatments: [
            {
              type: chosenT.name,
              durationMin,
              bufferMin: bufferMin || (sess.rules.bufferMin ?? 0),
            },
          ],
        };

        const nextSess: Session = {
          ...sess,
          createdAtMs: Date.now(),
          stage: "OFFER_SLOTS",
          treatmentType: chosenT.name,
          rules: derivedRules,
          slotsTop: [],
        };
        SESSIONS.set(from, nextSess);
        console.log("[session] set", { from, stage: nextSess.stage, treatments: nextSess.treatments?.length, slotsTop: nextSess.slotsTop?.length });

        const prefs = nextSess.lastPreferences ?? { dateIso: undefined };
        return await buildAndOfferSlots({ from, sess: nextSess, preferences: prefs });
      }

      // A2) Confirmar slot (solo 1/2/3)
      if (sess.stage === "OFFER_SLOTS") {
        if (idxAny > 2) {
          const xmlBad = twimlMessage("Responde 1, 2 o 3 🙂");
          return new NextResponse(xmlBad, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
        }

        const chosen = sess.slotsTop[idxAny];
        if (!chosen) {
          const xmlBad = twimlMessage("Esa opción no existe. Responde 1, 2 o 3 🙂");
          return new NextResponse(xmlBad, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
        }

        const hold = createHold({
          slot: chosen,
          patientId: from,
          treatmentType: sess.treatmentType ?? "Revisión",
          ttlMinutes: 10,
        });

        const providerName =
          sess.staffById?.[chosen.providerId]?.name ?? chosen.providerId ?? "Profesional";

        let staffRecordId: string | undefined =
          sess.staffById?.[chosen.providerId]?.recordId ?? undefined;

        if (!staffRecordId) {
          const found = await getStaffRecordIdByStaffId(chosen.providerId);
          if (!found) throw new Error(`No staff recordId for ${chosen.providerId}`);
          staffRecordId = found;
        }

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

        const appointmentId = safe((out as any)?.appointmentId ?? "");

        // cerrar sesión para evitar doble confirmación
        SESSIONS.delete(from);

        const xmlDone = twimlMessage(
          `🗓️ Cita creada ✅\n` +
            `Tratamiento: ${sess.treatmentType ?? "Revisión"}\n` +
            `Con: ${providerName}\n` +
            `Inicio: ${chosen.start}\n` +
            `Fin: ${chosen.end}\n` +
            (appointmentId ? `ID: ${appointmentId}\n` : "") +
            `Si quieres cambiarla, escribe: "reagendar"`
        );

        return new NextResponse(xmlDone, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
      }
    }

    /* ======================================================
       B) Si no habla de "cita", echo simple
    ======================================================= */
    if (!textLower.includes("cita")) {
      const xmlEcho = twimlMessage(`✅ Recibido: "${bodyRaw}"`);
      return new NextResponse(xmlEcho, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    /* ======================================================
       C) Flujo "cita": pedir tratamiento si falta, o mostrar slots
    ======================================================= */
    const preferences = parsePreferences(textLower);

    // C1) Si no hay sesión -> preguntar tratamiento desde Airtable
    if (!sess) {
      const treatments = await listTreatments({ clinicRecordId });

      if (!treatments.length) {
        const xmlNoT = twimlMessage("⚠️ No encontré tratamientos en Airtable (tabla Tratamientos).");
        return new NextResponse(xmlNoT, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
      }

      const mapped = treatments.map((t) => ({
        id: t.serviceId || t.recordId,
        name: t.name,
        durationMin: t.durationMin,
        bufferBeforeMin: t.bufferBeforeMin ?? 0,
        bufferAfterMin: t.bufferAfterMin ?? 0,
      }));

      const newSess: Session = {
        createdAtMs: Date.now(),
        clinicId,
        clinicRecordId,
        rules: baseRules,
        stage: "ASK_TREATMENT",
        treatmentType: undefined,
        treatments: mapped,
        lastPreferences: preferences,
        slotsTop: [],
        staffById: {},
      };
      SESSIONS.set(from, newSess);
      console.log("[session] set", { from, stage: newSess.stage, treatments: newSess.treatments?.length, slotsTop: newSess.slotsTop?.length });

      const xmlAsk = twimlMessage(renderTreatmentsList(mapped));
      return new NextResponse(xmlAsk, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    // C2) Hay sesión, pero aún pide tratamiento -> re-mostrar lista y actualizar preferencias
    if (sess.stage === "ASK_TREATMENT") {
      const updated: Session = {
        ...sess,
        createdAtMs: Date.now(),
        lastPreferences:
          preferences.dateIso || preferences.preferredStartHHMM || preferences.preferredEndHHMM
            ? preferences
            : sess.lastPreferences,
      };
      SESSIONS.set(from, updated);

      const xmlAsk = twimlMessage(renderTreatmentsList(updated.treatments));
      return new NextResponse(xmlAsk, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
    }

    // C3) Sesión lista (treatment elegido) -> ofrecer slots (regenera)
    if (sess.stage === "OFFER_SLOTS") {
      const updated: Session = {
        ...sess,
        createdAtMs: Date.now(),
        lastPreferences: preferences,
      };
      SESSIONS.set(from, updated);

      return await buildAndOfferSlots({ from, sess: updated, preferences });
    }

    const xmlFallback = twimlMessage("Escribe 'cita' para empezar 🙂");
    return new NextResponse(xmlFallback, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  } catch (err: any) {
    console.error("[twilio/whatsapp] ERROR", err);
    const xmlErr = twimlMessage("⚠️ Hubo un error. Mira los logs de Vercel y lo arreglamos.");
    return new NextResponse(xmlErr, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  }
}
