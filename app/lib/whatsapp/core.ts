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
  upsertPatientWithoutPhone,
  cancelAppointment,
} from "../scheduler/repo/airtableRepo";

import { getSession, setSession, deleteSession } from "../scheduler/sessionStore";
import { DEFAULT_RULES } from "../demoData";
import { formatTime } from "../time";

import {
  createWaitlistEntry,          // ✅ tú lo tienes en /api/db/waitlist POST o repo; usa la función real
  getOfferedEntryByPhone,
  markWaitlistActiveWithResult,
  markWaitlistBooked,
  getTreatmentMeta,
} from "../scheduler/repo/waitlistRepo";

import { onSlotFreed } from "../scheduler/waitlist/onSlotFreed";

import { NextResponse } from "next/server";
import { twimlMessage } from "../twilio/twiml";
import { isDuplicateMessage } from "../scheduler/idempotency";


// --------------------
// STAGES
// --------------------
type Stage =
  | "START"
  | "ASK_TREATMENT"
  | "ASK_DOCTOR"
  | "ASK_WHEN"
  | "OFFER_SLOTS"
  | "OFFER_ALTERNATIVES"
  | "OFFER_WAITLIST"
  | "ASK_BOOKING_FOR"
  | "ASK_OTHER_PHONE"
  | "ASK_PATIENT_NAME";

type Session = {
  createdAtMs: number;
  stage: Stage;

  clinicId: string;
  clinicRecordId?: string;
  rules: RulesState;

  // intent
  treatmentRecordId?: string;
  treatmentName?: string;

  preferredDoctorMode?: "SPECIFIC" | "ANY";
  preferredStaffId?: string; // STF_003 (ID lógico)
  preferredStaffRecordId?: string; // rec...

  preferences?: Preferences & { exactTime?: boolean };

  // offer
  slotsTop: Slot[];
  staffById: Record<string, { name: string; recordId?: string }>;

  // hold + booking
  pendingHoldId?: string;
  pendingStaffRecordId?: string;
  pendingSillonRecordId?: string;
  pendingStart?: string;
  pendingEnd?: string;

  bookingFor?: "SELF" | "OTHER";
  otherPhoneE164?: string;
  useTutorPhone?: boolean;
};

const SESSION_TTL_SECONDS = 15 * 60;

// --------------------
// Helpers
// --------------------
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

// ✅ parsing “día/hora” MVP (hoy/mañana + HH:mm + “a las 15”)
function parseWhen(body: string): Preferences & { exactTime?: boolean } {
  const t = normalizeText(body);
  const now = DateTime.now().setZone("Europe/Madrid");

  let dateIso: string | undefined;
  if (t.includes("hoy")) dateIso = now.toISODate()!;
  if (t.includes("manana")) dateIso = now.plus({ days: 1 }).toISODate()!;

  // HH:mm
  const hhmm = /(\d{1,2}):(\d{2})/.exec(t);
  // “a las 15”
  const hOnly = /a las (\d{1,2})\b/.exec(t);

  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;
  let exactTime = false;

  if (hhmm) {
    const h = String(hhmm[1]).padStart(2, "0");
    const m = hhmm[2];
    preferredStartHHMM = `${h}:${m}`;
    preferredEndHHMM = `${h}:${m}`;
    exactTime = true;
  } else if (hOnly) {
    const h = String(hOnly[1]).padStart(2, "0");
    preferredStartHHMM = `${h}:00`;
    preferredEndHHMM = `${h}:00`;
    exactTime = true;
  } else {
    // si no dio hora, intenta mañana/mañana tarde etc (simple)
    if (t.includes("manana") || t.includes("por la manana")) {
      preferredStartHHMM = "09:00";
      preferredEndHHMM = "13:00";
    } else if (t.includes("tarde")) {
      preferredStartHHMM = "15:00";
      preferredEndHHMM = "19:00";
    }
  }

  return { dateIso, preferredStartHHMM, preferredEndHHMM, exactTime };
}

function renderTreatmentsList(treatments: { recordId: string; name: string }[]) {
  const lines = treatments.slice(0, 12).map((t, i) => `${i + 1}) ${t.name}`);
  return `Perfecto 🙂 ¿Qué tratamiento necesitas?\n\n${lines.join("\n")}\n\nResponde con el número o el nombre.`;
}

function findTreatment(treatments: { recordId: string; name: string }[], body: string) {
  const raw = normalizeText(body);
  if (!raw) return null;

  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= treatments.length) return treatments[n - 1];

  const exact = treatments.find((x) => normalizeText(x.name) === raw);
  if (exact) return exact;

  const partial = treatments.find((x) => normalizeText(x.name).includes(raw));
  return partial ?? null;
}

// --------------------
// Motor principal
// --------------------
export async function handleInboundWhatsApp(params: {
  fromE164: string;
  body: string;
  clinicId: string;
  clinicRecordId?: string;
  rules: RulesState;
}) {
  const { fromE164, body, clinicId, clinicRecordId, rules } = params;
  const text = normalizeText(body);

  // 0) Si hay una oferta de waitlist pendiente: aceptar/rechazar
  const offered = await getOfferedEntryByPhone({ phoneE164: fromE164 });
  if (offered?.offerHoldId) {
    const wantsAccept = text === "si" || text === "sí" || text.includes("acepto") || text.includes("confirm");
    const wantsReject = text === "no" || text.includes("rechazo") || text.includes("paso");

    if (!wantsAccept && !wantsReject) {
      return `Tienes una oferta pendiente.\nResponde:\n✅ ACEPTO\n❌ NO`;
    }

    if (wantsReject) {
      await markWaitlistActiveWithResult({ waitlistRecordId: offered.recordId, result: "REJECTED" });

      // re-ofrecer al siguiente (slotKey guardado)
      const key = offered.lastOfferedSlotKey || "";
      const [start, end, providerId, chairIdRaw] = key.split("|");
      const chairId = Number(chairIdRaw || "1") || 1;

      if (start && end && providerId) {
        await onSlotFreed({
          clinicRecordId: offered.clinicRecordId,
          treatmentRecordId: offered.treatmentRecordId!,
          slot: { slotId: key, start, end, providerId, chairId },
        });
      }

      return "Perfecto 👍 Se lo ofrezco al siguiente de la lista.";
    }

    // ACCEPT
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
      if (offered.citaSeguraRecordId) await cancelAppointment({ appointmentRecordId: offered.citaSeguraRecordId, origin: "Waitlist" });
    }

    return "✅ Listo. Te reservé el hueco.";
  }

  // 1) Cargar sesión
  const sess = await getSession<Session>(fromE164);

  // 2) Si no hay sesión, iniciamos “captura de intent”
  if (!sess) {
    const newSess: Session = {
      createdAtMs: Date.now(),
      stage: "ASK_TREATMENT",
      clinicId,
      clinicRecordId,
      rules,
      slotsTop: [],
      staffById: {},
    };

    await setSession(fromE164, newSess, SESSION_TTL_SECONDS);

    const treatments = await listTreatments({ clinicRecordId });
    if (!treatments.length) return "⚠️ No encontré tratamientos configurados.";

    const list = treatments.map((t: any) => ({ recordId: t.recordId, name: t.name }));
    // guardarlo en KV sería ideal; por MVP lo pedimos y al siguiente msg volvemos a traer listTreatments
    return renderTreatmentsList(list);
  }

  // 3) Stage: ASK_TREATMENT
  if (sess.stage === "ASK_TREATMENT") {
    const treatments = await listTreatments({ clinicRecordId });
    const list = treatments.map((t: any) => ({ recordId: t.recordId, name: t.name }));
    const chosen = findTreatment(list, body);

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

  // 4) Stage: ASK_DOCTOR
  if (sess.stage === "ASK_DOCTOR") {
    const t = normalizeText(body);

    let preferredDoctorMode: Session["preferredDoctorMode"] = "ANY";
    let preferredStaffId: string | undefined;

    if (t === "1" || t.includes("cualquiera")) {
      preferredDoctorMode = "ANY";
    } else {
      // MVP: si escriben “mateo” lo convertimos a STF_003 por matching contra listStaff
      const staff = await listStaff();
      const doc = staff.find((s: any) => normalizeText(s.name).includes(t));
      if (!doc) return "No encontré ese doctor 😅 Escríbeme el nombre tal cual aparece en la clínica, o responde 1) Cualquiera.";
      preferredDoctorMode = "SPECIFIC";
      preferredStaffId = doc.staffId;
    }

    const next: Session = { ...sess, createdAtMs: Date.now(), stage: "ASK_WHEN", preferredDoctorMode, preferredStaffId };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);

    return `Genial 🙂 ¿Para cuándo la quieres?\nEj: "mañana 15:00", "hoy tarde", "mañana por la mañana".`;
  }

  // 5) Stage: ASK_WHEN -> buscar huecos y ofertar
  if (sess.stage === "ASK_WHEN") {
    const prefs = parseWhen(body);

    // si no dijo nada útil, repregunta
    if (!prefs.dateIso && !prefs.preferredStartHHMM && !prefs.preferredEndHHMM) {
      return "Dime un día u hora aproximada 🙂 Ej: mañana 15:00 / hoy tarde / martes por la mañana.";
    }

    // staff elegible
    const staff = await listStaff();
    const active = staff.filter((s: any) => s.activo && (s.rol || "").toLowerCase() !== "recepcionista");

    const providerIds =
      sess.preferredDoctorMode === "SPECIFIC" && sess.preferredStaffId
        ? [sess.preferredStaffId]
        : active.map((s: any) => s.staffId);

    // providerRulesById (si ya lo tienes armado en tu route, aquí lo meterías; por MVP lo dejamos vacío)
    const providerRulesById: any = {};

    const slots = await getAvailableSlots(
      { rules: sess.rules, treatmentType: sess.treatmentName || "Tratamiento", preferences: prefs, providerIds, providerRulesById } as any,
      async (dayIso) => listAppointmentsByDay({ dayIso, clinicId: sess.clinicId, onlyActive: true })
    );

    if (!slots.length) {
      // ✅ aquí empieza TU lógica: ofrecer alternativas (otro doctor / otro horario) y si no -> waitlist
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST", preferences: prefs };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);

      return `😕 No encontré huecos con esas preferencias.\n\nPuedo:\n1) Buscar con otro doctor\n2) Ofrecerte la opción más cercana\n3) Apuntarte en lista de espera y avisarte si se libera antes\n\nResponde 1, 2 o 3.`;
    }

    // top 3
    const top = slots.slice(0, 3);
    const staffById: Session["staffById"] = {};
    for (const s of active as any[]) staffById[s.staffId] = { name: s.name || s.staffId, recordId: s.recordId };

    const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_SLOTS", preferences: prefs, slotsTop: top, staffById };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);

    const lines = top.map((slot, i) => {
      const name = staffById?.[slot.providerId]?.name ?? slot.providerId;
      return `${i + 1}) ${formatTime(slot.start)} con ${name}`;
    });

    return `Estas son las opciones más cercanas 🙂\n\n${lines.join("\n")}\n\nResponde 1, 2 o 3.\nSi ninguna te sirve, escribe: "no me sirve".`;
  }

  // 6) Stage: OFFER_SLOTS -> elegir slot o “no me sirve”
  if (sess.stage === "OFFER_SLOTS") {
    const t = normalizeText(body);
    if (t.includes("no me sirve") || t === "no") {
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST" };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return `Vale. Dime tu preferencia exacta (día/hora) y lo intento.\nSi no hay, te propongo lista de espera.`;
    }

    const idx = Number(t);
    if (!Number.isFinite(idx) || idx < 1 || idx > 3) return "Responde 1, 2 o 3 🙂";

    const chosen = sess.slotsTop[idx - 1];
    if (!chosen) return "Esa opción no existe 🙂";

    // hold
    const hold = await createHoldKV({
      slot: chosen,
      patientId: fromE164,
      treatmentType: sess.treatmentName || "Tratamiento",
      ttlMinutes: 10,
    });

    // staffRecordId
   // staffRecordId
let staffRecordId: string | undefined = sess.staffById?.[chosen.providerId]?.recordId;

if (!staffRecordId) {
  const found = await getStaffRecordIdByStaffId(chosen.providerId);
  staffRecordId = found ?? undefined; // ✅ null -> undefined
}

if (!staffRecordId) {
  return "⚠️ No pude identificar al profesional (config interna).";
}


    const sillonRecordId = await getSillonRecordIdBySillonId(chairIdToSillonId(chosen.chairId));

    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      stage: "ASK_BOOKING_FOR",
      pendingHoldId: hold.id,
      pendingStaffRecordId: staffRecordId,
      pendingSillonRecordId: sillonRecordId || undefined,
      pendingStart: chosen.start,
      pendingEnd: chosen.end,
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);

    return `Perfecto 🙂 ¿La cita es para ti o para otra persona?\n1) Para mí\n2) Para otra persona`;
  }

  // 7) Stage: OFFER_WAITLIST -> crear waitlist (Airtable) y cerrar
  if (sess.stage === "OFFER_WAITLIST") {
    const t = normalizeText(body);

    // aquí: si el user mandó nueva preferencia, reintenta (simplificado)
    if (t.includes("hoy") || t.includes("manana") || /\d{1,2}:\d{2}/.test(t)) {
      const prefs = parseWhen(body);
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "ASK_WHEN", preferences: prefs };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return `Dale, lo intento con eso 🙂`;
    }

    // si elige opción 3 o dice “si”
    const wantsWaitlist = t === "3" || t === "si" || t === "sí" || t.includes("apunta") || t.includes("lista");
    if (!wantsWaitlist) {
      return `Responde 1, 2 o 3.\n(1 otro doctor / 2 opción cercana / 3 lista de espera)`;
    }
if (!sess.clinicRecordId) {
  return "⚠️ Config incompleta: falta clinicRecordId. Revisa DEMO_CLINIC_RECORD_ID.";
}

if (!sess.treatmentRecordId) {
  return "Me falta el tratamiento (error interno).";
}

// asegurar paciente en Airtable
const patient = await upsertPatientByPhone({
  name: "Paciente",
  phoneE164: fromE164,
  clinicRecordId: sess.clinicRecordId, // ✅ ahora es string seguro
});

// crear rango desde preferencias si existe
const rangoStartIso = sess.preferences?.dateIso && sess.preferences?.preferredStartHHMM
  ? DateTime.fromISO(`${sess.preferences.dateIso}T${sess.preferences.preferredStartHHMM}`, { zone: "Europe/Madrid" })
      .toISO({ suppressMilliseconds: true })!
  : undefined;

const rangoEndIso = sess.preferences?.dateIso && sess.preferences?.preferredEndHHMM
  ? DateTime.fromISO(`${sess.preferences.dateIso}T${sess.preferences.preferredEndHHMM}`, { zone: "Europe/Madrid" })
      .toISO({ suppressMilliseconds: true })!
  : undefined;

// ⚠️ OJO: createWaitlistEntry NO acepta "estado"
await createWaitlistEntry({
  clinicRecordId: sess.clinicRecordId,
  patientRecordId: patient.recordId,
  treatmentRecordId: sess.treatmentRecordId,

  preferredStaffRecordId: sess.preferredStaffRecordId || undefined,

  // defaults OK si no pasas nada:
  // diasPermitidos, prioridad, urgencia, etc.

  rangoStartIso,
  rangoEndIso,

  notas: "Creado por WhatsApp (core)",
});

await deleteSession(fromE164);

return "Listo ✅ Te apunté en lista de espera. Si se libera un hueco antes, te aviso por aquí.";

  }

  // 8) booking flow (igual que tú ya lo tienes): ASK_BOOKING_FOR / ASK_OTHER_PHONE / ASK_PATIENT_NAME
  // (lo dejo fuera por espacio, pero tu código actual se pega aquí con pocos cambios)

  return "Escribe 'cita' para empezar 🙂";
}

export async function handleTwilioWhatsAppPOST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  let fromRaw = "";
  let bodyRaw = "";
  let msgSid = "";

  // ✅ Twilio: application/x-www-form-urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    const raw = await req.text();
    const p = new URLSearchParams(raw);
    fromRaw = String(p.get("From") || "");
    bodyRaw = String(p.get("Body") || "").trim();
    msgSid = String(p.get("MessageSid") || "");
  } else {
    // fallback por si alguna vez llega multipart
    const form = await req.formData();
    fromRaw = String(form.get("From") || "");
    bodyRaw = String(form.get("Body") || "").trim();
    msgSid = String(form.get("MessageSid") || "");
  }

  const fromE164 = fromRaw.replace("whatsapp:", "").trim();

  if (msgSid && (await isDuplicateMessage(msgSid))) {
    const xml = twimlMessage("✅ Recibido.");
    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
  const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID;

  const rules: RulesState = (() => {
    const raw = process.env.DEMO_RULES_JSON;
    if (!raw) return DEFAULT_RULES;
    try {
      return { ...DEFAULT_RULES, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_RULES;
    }
  })();

  const replyText = await handleInboundWhatsApp({
    fromE164,
    body: bodyRaw,
    clinicId,
    clinicRecordId,
    rules,
  });

  const xml = twimlMessage(replyText);
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
