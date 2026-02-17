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

  const daysMap: Record<string, number> = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
    domingo: 7,
  };

  let dateIso: string | undefined;

  // hoy / mañana
  if (t.includes("hoy")) dateIso = now.toISODate()!;
  if (t.includes("manana")) dateIso = now.plus({ days: 1 }).toISODate()!;

  // día de la semana
  for (const key of Object.keys(daysMap)) {
    if (t.includes(key)) {
      const targetWeekday = daysMap[key];
      let diff = targetWeekday - now.weekday;
      if (diff <= 0) diff += 7;
      dateIso = now.plus({ days: diff }).toISODate()!;
      break;
    }
  }

  // -------------------
  // Hora exacta
  // -------------------

  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;
  let exactTime = false;

  // 15:30
  const hhmm = /(\d{1,2}):(\d{2})/.exec(t);

  // 15h
  const hFormat = /(\d{1,2})h\b/.exec(t);

  // 3pm / 3 pm
  const pmFormat = /(\d{1,2})\s?pm\b/.exec(t);

  // a las 15
  const aLas = /a las (\d{1,2})\b/.exec(t);

  if (hhmm) {
    const h = String(hhmm[1]).padStart(2, "0");
    const m = hhmm[2];
    preferredStartHHMM = `${h}:${m}`;
    preferredEndHHMM = `${h}:${m}`;
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
    const h = String(aLas[1]).padStart(2, "0");
    preferredStartHHMM = `${h}:00`;
    preferredEndHHMM = `${h}:00`;
    exactTime = true;
  } else {
    // rangos aproximados
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

function findTreatmentSmart(
  treatments: { recordId: string; name: string }[],
  body: string
) {
  const raw = normalizeText(body);
  if (!raw) return null;

  // tokens del mensaje (cita limpieza mañana 15:00 -> ["cita","limpieza","manana","1500"])
  const tokens = raw.split(/\s+/).filter(Boolean);

  // intenta match por:
  // 1) raw incluye nombre completo
  // 2) raw incluye alguna palabra del nombre (>=5 chars)
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

function findDoctorSmart(
  staff: { staffId: string; name: string }[],
  body: string
) {
  const raw = normalizeText(body);
  if (!raw) return null;

  // tokens del mensaje
  const tokens = raw.split(/\s+/).filter(Boolean);

  for (const s of staff) {
    const nameN = normalizeText(s.name);
    if (!nameN) continue;

    // match por nombre completo (incluye)
    if (raw.includes(nameN)) return s;

    // match por palabras del nombre (>=4)
    const words = nameN.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (w.length >= 4 && tokens.includes(w)) return s;
    }
  }

  return null;
}

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isoToMinutes(iso: string) {
  // iso tipo "2026-02-16T15:00:00.000+01:00" o "...Z"
  const hhmm = iso.slice(11, 16);
  return hhmmToMinutes(hhmm);
}

/**
 * Devuelve hasta 2 slots: el inmediatamente ANTERIOR y el inmediatamente POSTERIOR
 * a la hora pedida (en el mismo día).
 * Si solo hay uno de los dos, devuelve ese.
 */
function pickClosestBeforeAfterSameDay(slots: Slot[], dateIso: string, targetHHMM: string): Slot[] {
  const targetMin = hhmmToMinutes(targetHHMM);

  // solo slots del mismo día (si tu start es ISO con zona, esto funciona igual porque slice(0,10) es la fecha)
  const sameDay = slots
    .filter((s) => s.start.slice(0, 10) === dateIso)
    .sort((a, b) => isoToMinutes(a.start) - isoToMinutes(b.start));

  if (!sameDay.length) return [];

  // último slot que empieza ANTES de target
  let before: Slot | undefined;
  for (const s of sameDay) {
    if (isoToMinutes(s.start) < targetMin) before = s;
    else break;
  }

  // primer slot que empieza DESPUÉS de target
  const after = sameDay.find((s) => isoToMinutes(s.start) > targetMin);

  const out: Slot[] = [];
  if (before) out.push(before);
  if (after) out.push(after);
  return out;
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

  // 2) Si no hay sesión: START inteligente (detecta tratamiento en el primer mensaje)
if (!sess) {
  const treatments = await listTreatments({ clinicRecordId });
  if (!treatments.length) return "⚠️ No encontré tratamientos configurados.";

  const list = treatments.map((t: any) => ({ recordId: t.recordId, name: t.name }));

  const chosen = findTreatmentSmart(list, body);

  // Si detectó tratamiento => saltar ASK_TREATMENT
 if (chosen) {
  const when = parseWhen(body);

  // ✅ detectar doctor SOLO si viene en el mensaje
  const staff = await listStaff();
  const activeStaff = staff.filter(
    (s: any) => s.activo && (s.rol || "").toLowerCase() !== "recepcionista"
  );
  const detectedDoc = findDoctorSmart(
    activeStaff.map((s: any) => ({ staffId: s.staffId, name: s.name })),
    body
  );

  const hasWhen =
    !!when?.dateIso || !!when?.preferredStartHHMM || !!when?.preferredEndHHMM;

  const next: Session = {
    createdAtMs: Date.now(),
    // ✅ si NO hay doctor -> preguntamos doctor
    // ✅ si sí hay doctor -> pasamos directo a cuándo (o a buscar slots si ya venía fecha/hora)
    stage: detectedDoc ? "ASK_WHEN" : "ASK_DOCTOR",
    clinicId,
    clinicRecordId,
    rules,
    treatmentRecordId: chosen.recordId,
    treatmentName: chosen.name,

    // ✅ si doctor venía, lo guardamos ya seteado
    preferredDoctorMode: detectedDoc ? "SPECIFIC" : undefined,
    preferredStaffId: detectedDoc ? detectedDoc.staffId : undefined,

    slotsTop: [],
    staffById: {},
    preferences: when || {},
  };

  await setSession(fromE164, next, SESSION_TTL_SECONDS);

  // 1) Si NO venía doctor -> preguntar preferencia de doctor (cualquiera vs específico)
  if (!detectedDoc) {
    return `Perfecto 🙂 Para *${chosen.name}*.\n¿Tienes preferencia de doctor?\n\nResponde:\n1) Cualquiera\n2) Quiero uno específico (escribe el nombre)`;
  }

  // 2) Si venía doctor y también venía fecha/hora -> NO repreguntar nada, busca opciones ya
  if (hasWhen) {
    return await handleInboundWhatsApp({
      fromE164,
      body: "__USE_SAVED_PREFS__",
      clinicId,
      clinicRecordId,
      rules,
    });
  }

  // 3) Si venía doctor pero NO venía fecha/hora -> preguntar cuándo
  return `Perfecto 🙂 Para *${chosen.name}* con *${detectedDoc.name}*.\n¿Para cuándo la quieres?\nEj: "mañana 15:00", "hoy tarde", "martes por la mañana".`;
}


  // Si NO detectó tratamiento => flujo normal
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

  // 3) Stage: ASK_TREATMENT


  
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

  // 4) Stage: ASK_DOCTOR
  if (sess.stage === "ASK_DOCTOR") {
    const t = normalizeText(body);

    let preferredDoctorMode: Session["preferredDoctorMode"] = "ANY";
    let preferredStaffId: string | undefined;

    if (t === "1" || t.includes("cualquiera")) {
      preferredDoctorMode = "ANY";
    } else {
  // si respondieron "2", todavía no tenemos nombre
  if (t === "2" || t.includes("especifico") || t.includes("específico")) {
    return "Dime el nombre del doctor 🙂 (ej: Mateo)";
  }

  const staff = await listStaff();
  const activeStaff = staff.filter(
    (s: any) => s.activo && (s.rol || "").toLowerCase() !== "recepcionista"
  );

  // match flexible usando el helper
  const doc = findDoctorSmart(
    activeStaff.map((s: any) => ({ staffId: s.staffId, name: s.name })),
    body
  );

  if (!doc) {
    return "No encontré ese doctor 😅 Escríbeme el nombre tal cual aparece en la clínica, o responde 1) Cualquiera.";
  }

  preferredDoctorMode = "SPECIFIC";
  preferredStaffId = doc.staffId;
}


   const next: Session = {
  ...sess,
  createdAtMs: Date.now(),
  stage: "ASK_WHEN",
  preferredDoctorMode,
  preferredStaffId,
};

await setSession(fromE164, next, SESSION_TTL_SECONDS);

// 🔥 SI YA TENÍAMOS FECHA/HORA DEL PRIMER MENSAJE → NO REPREGUNTAR
if (next.preferences?.dateIso || next.preferences?.preferredStartHHMM || next.preferences?.preferredEndHHMM) {
  return await handleInboundWhatsApp({
    fromE164,
    body: "__USE_SAVED_PREFS__",
    clinicId,
    clinicRecordId,
    rules,
  });
}


return `Genial 🙂 ¿Para cuándo la quieres?\nEj: "mañana 15:00", "hoy tarde", "mañana por la mañana".`;

  }

  // 5) Stage: ASK_WHEN -> buscar huecos y ofertar
  if (sess.stage === "ASK_WHEN") {
    const stored = sess.preferences || {};
const parsed = parseWhen(body);

const storedHas = !!(stored.dateIso || stored.preferredStartHHMM || stored.preferredEndHHMM);
const parsedHas = !!(parsed.dateIso || parsed.preferredStartHHMM || parsed.preferredEndHHMM);

const prefs =
  body === "__USE_SAVED_PREFS__"
    ? stored
    : (storedHas ? stored : parsed);



    // si no dijo nada útil, repregunta
    if (!storedHas && !parsedHas) {
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

    // 🔥 AUTO-SELECT si pidió hora exacta y existe match exacto
// 🔥 AUTO-SELECT si pidió hora exacta y existe match exacto (en zona Europe/Madrid)
if (prefs.exactTime && prefs.preferredStartHHMM) {
  const wanted = prefs.preferredStartHHMM;

  // Helper: minutos desde HH:mm
  const hhmmToMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  // Helper: HH:mm local desde ISO
  const slotHHMM = (iso: string) =>
    DateTime.fromISO(iso).setZone("Europe/Madrid").toFormat("HH:mm");

  // Helper: dateIso local (YYYY-MM-DD) desde ISO
  const slotDateIso = (iso: string) =>
    DateTime.fromISO(iso).setZone("Europe/Madrid").toISODate();

  // 1) ¿Existe exacto?
  const exactSlot = slots.find((s) => slotHHMM(s.start) === wanted);

  // 2) Si NO existe exacto: ofrecer BEFORE/AFTER del mismo día (si tenemos dateIso)
  if (!exactSlot) {
    // Necesitamos un día para buscar "antes/después" coherente
    // Si el usuario no dijo día, repreguntamos SOLO el día (rápido)
    if (!prefs.dateIso) {
      const next: Session = {
        ...sess,
        createdAtMs: Date.now(),
        stage: "ASK_WHEN",
        preferences: prefs, // guardamos hora exacta para cuando diga el día
      };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);
      return `Perfecto 🙂 ¿Para qué día exactamente?\nEj: "mañana", "jueves", "hoy".`;
    }

    const wantedMin = hhmmToMin(wanted);

    // Slots del MISMO día (local) ordenados por hora
    const sameDay = slots
      .filter((s) => slotDateIso(s.start) === prefs.dateIso)
      .sort((a, b) => hhmmToMin(slotHHMM(a.start)) - hhmmToMin(slotHHMM(b.start)));

    // BEFORE = último slot con start < wanted
    let before: Slot | undefined;
    for (const s of sameDay) {
      if (hhmmToMin(slotHHMM(s.start)) < wantedMin) before = s;
      else break;
    }

    // AFTER = primer slot con start > wanted
    const after = sameDay.find((s) => hhmmToMin(slotHHMM(s.start)) > wantedMin);

    const top: Slot[] = [];
    if (before) top.push(before);
    if (after) top.push(after);

    if (!top.length) {
      // No hay slots cercanos ese día -> tu flow de "no slots"
      const next: Session = { ...sess, createdAtMs: Date.now(), stage: "OFFER_WAITLIST", preferences: prefs };
      await setSession(fromE164, next, SESSION_TTL_SECONDS);

      return `😕 A las *${wanted}* está ocupado y no encontré huecos cercanos ese día.\n\nPuedo:\n1) Buscar con otro doctor\n2) Proponerte la opción más cercana en otro horario\n3) Apuntarte en lista de espera\n\nResponde 1, 2 o 3.`;
    }

    // staffById para render
    const staffById: Session["staffById"] = {};
    for (const s of active as any[]) {
      staffById[s.staffId] = { name: s.name || s.staffId, recordId: s.recordId };
    }

    // Guardar y ofrecer 1 o 2
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
      return `${i + 1}) ${formatTime(slot.start)} con ${name}`;
    });

    const respRange = top.length === 1 ? "Responde 1." : "Responde 1 o 2.";

    return `😕 No tengo exactamente a las *${wanted}*.\nPero estas son las más cercanas:\n\n${lines.join("\n")}\n\n${respRange}`;
  }

  // 3) Si SÍ hay exacto -> HOLD normal y pasar a ASK_BOOKING_FOR
  const hold = await createHoldKV({
    slot: exactSlot,
    patientId: fromE164,
    treatmentType: sess.treatmentName || "Tratamiento",
    ttlMinutes: 10,
  });

  let staffRecordId = sess.staffById?.[exactSlot.providerId]?.recordId;
  if (!staffRecordId) {
    const found = await getStaffRecordIdByStaffId(exactSlot.providerId);
    staffRecordId = found ?? undefined;
  }

  const sillonRecordId = await getSillonRecordIdBySillonId(
    chairIdToSillonId(exactSlot.chairId)
  );

  const next: Session = {
    ...sess,
    createdAtMs: Date.now(),
    stage: "ASK_BOOKING_FOR",
    pendingHoldId: hold.id,
    pendingStaffRecordId: staffRecordId,
    pendingSillonRecordId: sillonRecordId || undefined,
    pendingStart: exactSlot.start,
    pendingEnd: exactSlot.end,
  };

  await setSession(fromE164, next, SESSION_TTL_SECONDS);

  return `Perfecto 🙂 Tengo ese hueco disponible.\n\n¿La cita es para ti o para otra persona?\n1) Para mí\n2) Para otra persona`;
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
const max = sess.slotsTop?.length || 0;
if (!Number.isFinite(idx) || idx < 1 || idx > max) return `Responde 1${max >= 2 ? " o 2" : ""} 🙂`;


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
    // ✅ si el user mandó nueva preferencia, reintenta Y RESPONDE EN EL MISMO TURNO
if (t.includes("hoy") || t.includes("manana") || /\d{1,2}:\d{2}/.test(t)) {
  const prefs = parseWhen(body);

  const next: Session = {
    ...sess,
    createdAtMs: Date.now(),
    stage: "ASK_WHEN",
    preferences: prefs,
  };

  await setSession(fromE164, next, SESSION_TTL_SECONDS);

  // 🔥 ejecutar la búsqueda ya, sin esperar otro mensaje
  return await handleInboundWhatsApp({
    fromE164,
    body: "__USE_SAVED_PREFS__",
    clinicId,
    clinicRecordId,
    rules,
  });
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
// Stage: ASK_BOOKING_FOR
if (sess.stage === "ASK_BOOKING_FOR") {
  const t = normalizeText(body);

  if (t === "1" || t.includes("para mi")) {
    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      bookingFor: "SELF",
      stage: "ASK_PATIENT_NAME",
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return "Perfecto 🙂 ¿Cuál es tu nombre y apellido?";
  }

  if (t === "2" || t.includes("otra")) {
    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      bookingFor: "OTHER",
      stage: "ASK_OTHER_PHONE",
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return "Pásame el número en formato internacional 🙂 Ej: +34600111222";
  }

  return "Responde 1 (para mí) o 2 (para otra persona).";
}

if (sess.stage === "ASK_OTHER_PHONE") {
  const t = normalizeText(body);

  const saidNoPhone =
    t.includes("no tiene") ||
    t.includes("sin telefono") ||
    t.includes("sin teléfono");

  if (saidNoPhone) {
    const next: Session = {
      ...sess,
      createdAtMs: Date.now(),
      useTutorPhone: true,
      otherPhoneE164: undefined,
      stage: "ASK_PATIENT_NAME",
    };
    await setSession(fromE164, next, SESSION_TTL_SECONDS);
    return "Perfecto 🙂 ¿Cuál es el nombre y apellido de la persona?";
  }

  const phone = body.trim();
  const isE164 = /^\+\d{8,15}$/.test(phone);
  if (!isE164) return "Pásamelo así porfa: +346XXXXXXXX 🙂 o responde *no tiene*";

  const next: Session = {
    ...sess,
    createdAtMs: Date.now(),
    otherPhoneE164: phone,
    useTutorPhone: false,
    stage: "ASK_PATIENT_NAME",
  };
  await setSession(fromE164, next, SESSION_TTL_SECONDS);

  return "Perfecto 🙂 ¿Cuál es el nombre y apellido de la persona?";
}

if (sess.stage === "ASK_PATIENT_NAME") {
  const name = body.trim();
  if (name.length < 3) return "¿Me lo repites? Nombre y apellido 🙂";

  if (!sess.pendingHoldId || !sess.pendingStart || !sess.pendingEnd) {
    await deleteSession(fromE164);
    return "Ese hueco ya no está disponible 😕 Escribe 'cita mañana' y te doy nuevas opciones.";
  }

  // 📌 cuál teléfono usar para el paciente
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

    const out = await confirmHoldToAppointment({
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

    return (
      `✅ Cita creada.\n\n` +
      `Paciente: ${name}\n` +
      `Tratamiento: ${sess.treatmentName}\n` +
      `Inicio: ${formatTime(sess.pendingStart)}`
    );
  } catch (e) {
    console.error("[ASK_PATIENT_NAME] confirm failed", e);
    await deleteSession(fromE164);
    return "Ese hueco ya no está disponible 😕 Escribe 'cita mañana' y te doy nuevas opciones.";
  }
}


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


