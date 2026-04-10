// app/lib/no-shows/demo.ts
// Datos demo para el módulo no-shows — siempre relativos a "hoy"

import { DateTime } from "luxon";
import type { RiskyAppt, RecallAlert, GapSlot } from "./types";

const ZONE = "Europe/Madrid";

function todayIso(): string {
  return DateTime.now().setZone(ZONE).toISODate()!;
}

function workDayIso(offsetWorkDays: number): string {
  // 0 = hoy (o siguiente lunes si es finde), 1 = siguiente día laboral, etc.
  let dt = DateTime.now().setZone(ZONE);
  if (dt.weekday >= 6) {
    dt = dt.startOf("week").plus({ weeks: 1 });
  }
  dt = dt.startOf("day").plus({ days: offsetWorkDays });
  // Skip weekends
  while (dt.weekday >= 6) dt = dt.plus({ days: 1 });
  return dt.toISODate()!;
}

function isoAt(dayIso: string, hhmm: string): string {
  return `${dayIso}T${hhmm}:00`;
}

function addMin(startHHMM: string, min: number): string {
  const [h, m] = startHHMM.split(":").map(Number);
  const total = h * 60 + m + min;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function appt(
  id: string,
  day: string,
  startHHMM: string,
  durationMin: number,
  patientName: string,
  patientPhone: string,
  treatmentName: string,
  riskScore: number,
  confirmed: boolean,
  clinica = "Clínica Madrid Centro",
): RiskyAppt {
  const endHHMM = addMin(startHHMM, durationMin);
  const startIso = isoAt(day, startHHMM);
  const endIso = isoAt(day, endHHMM);
  const riskLevel =
    riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW";
  const histNoShows = riskScore >= 60 ? 2 : riskScore >= 30 ? 1 : 0;
  const histTotal = riskScore >= 60 ? 5 : riskScore >= 30 ? 4 : 6;

  return {
    id,
    patientName,
    patientPhone,
    start: startIso,
    end: endIso,
    startDisplay: startHHMM,
    treatmentName,
    clinica,
    dayIso: day,
    riskScore,
    riskLevel,
    actionDeadline: isoAt(day, "10:00"),
    actionUrgent: false,
    confirmed,
    riskFactors: {
      historicalNoShowRate: histTotal > 0 ? Math.round((histNoShows / histTotal) * 100) / 100 : 0,
      historicalNoShowCount: histNoShows,
      historicalCancelCount: riskScore >= 30 ? 1 : 0,
      historicalTotalAppts: histTotal,
      daysSinceBooked: riskScore >= 60 ? 35 : riskScore >= 30 ? 14 : 3,
      dayOfWeek: DateTime.fromISO(startIso, { zone: ZONE }).weekday,
      hourOfDay: parseInt(startHHMM.split(":")[0]),
      treatmentRisk: riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW",
      dayTimeLabel:
        riskScore >= 60 ? "Lunes por la mañana" :
        riskScore >= 30 ? "Horario tardío" : "",
    },
  };
}

// ─── HOY ─────────────────────────────────────────────────────────────────────

export function buildDemoHoyAppointments(): RiskyAppt[] {
  const day = workDayIso(0);
  return [
    appt("demo-h1", day, "09:00", 60,  "Carmen Rodríguez",  "+34611001001", "Ortodoncia invisible", 78, false),
    appt("demo-h2", day, "10:00", 45,  "Javier López",      "+34611001002", "Revisión general",     65, false),
    appt("demo-h3", day, "10:30", 30,  "María Sánchez",     "+34611001003", "Limpieza dental",      48, false),
    appt("demo-h4", day, "11:00", 45,  "Roberto García",    "+34611001004", "Consulta",             45, false),
    appt("demo-h5", day, "11:30", 60,  "Ana Torres",        "+34611001005", "Empaste",              22, true),
    appt("demo-h6", day, "12:00", 90,  "David Martín",      "+34611001006", "Implante dental",      18, true),
    appt("demo-h7", day, "13:30", 45,  "Elena Flores",      "+34611001007", "Periodoncia",          15, true),
    appt("demo-h8", day, "16:00", 45,  "Pablo Díaz",        "+34611001008", "Extracción dental",    42, false),
    appt("demo-h9", day, "17:00", 30,  "Isabel Fernández",  "+34611001009", "Revisión general",     70, false),
    appt("demo-h10", day, "17:30", 60, "Miguel Herrera",    "+34611001010", "Endodoncia",           20, true),
  ];
}

export function buildDemoHoyGaps(): GapSlot[] {
  const day = workDayIso(0);
  return [
    {
      dayIso: day,
      startIso: isoAt(day, "08:00"),
      endIso: isoAt(day, "09:00"),
      startDisplay: "08:00",
      endDisplay: "09:00",
      durationMin: 60,
      clinica: "Clínica Madrid Centro",
    },
    {
      dayIso: day,
      startIso: isoAt(day, "14:00"),
      endIso: isoAt(day, "16:00"),
      startDisplay: "14:00",
      endDisplay: "16:00",
      durationMin: 120,
      clinica: "Clínica Madrid Centro",
    },
  ];
}

// ─── RIESGO (semana) ──────────────────────────────────────────────────────────

export function buildDemoRiesgoAppointments(): RiskyAppt[] {
  const appts: RiskyAppt[] = [];
  const clinics = ["Clínica Madrid Centro", "Clínica Barcelona Eixample", "Clínica Madrid Norte"];

  const defs = [
    // Lunes
    [0, "09:00", 60,  "Carmen Rodríguez",   "+34611001001", "Ortodoncia invisible",  78, false, 0],
    [0, "10:00", 45,  "Javier López",        "+34611001002", "Revisión general",      65, false, 0],
    [0, "11:00", 45,  "Roberto García",      "+34611001004", "Consulta",              42, false, 1],
    [0, "12:00", 90,  "David Martín",        "+34611001006", "Implante dental",       18, true,  0],
    // Martes
    [1, "09:00", 60,  "Sofía Navarro",       "+34611002001", "Blanqueamiento",        55, false, 1],
    [1, "10:30", 45,  "Tomás Guerrero",      "+34611002002", "Empaste",               35, false, 0],
    [1, "11:00", 30,  "Marta Jiménez",       "+34611002003", "Revisión general",      65, false, 2],
    [1, "12:00", 90,  "Hugo Sánchez",        "+34611002004", "Endodoncia",            22, true,  0],
    [1, "16:00", 45,  "Lucía Molina",        "+34611002005", "Profilaxis",            48, false, 1],
    // Miércoles
    [2, "09:30", 60,  "Felipe Castro",       "+34611003001", "Ortodoncia bracket",    62, false, 0],
    [2, "11:00", 45,  "Valeria Romero",      "+34611003002", "Blanqueamiento",        38, false, 2],
    [2, "12:00", 90,  "Mateo Ortega",        "+34611003003", "Implante dental",       25, true,  0],
    // Jueves
    [3, "10:00", 45,  "Cristina Vega",       "+34611004001", "Revisión general",      70, false, 1],
    [3, "11:30", 60,  "Andrés Peña",         "+34611004002", "Periodoncia",           28, true,  0],
    [3, "16:00", 30,  "Beatriz Ramos",       "+34611004003", "Limpieza dental",       55, false, 0],
    // Viernes (alta tasa — Viernes tarde)
    [4, "09:00", 45,  "Daniel Fuentes",      "+34611005001", "Consulta",              45, false, 2],
    [4, "10:00", 60,  "Natalia Cano",        "+34611005002", "Ortodoncia invisible",  72, false, 0],
    [4, "16:00", 30,  "Ramón Delgado",       "+34611005003", "Revisión general",      82, false, 1],
    [4, "17:00", 45,  "Carmen Iglesias",     "+34611005004", "Profilaxis",            75, false, 0],
  ] as const;

  defs.forEach(([dayOffset, startHH, dur, name, phone, treatment, score, confirmed, clinicIdx], i) => {
    const day = workDayIso(dayOffset as number);
    appts.push(
      appt(
        `demo-r${i}`,
        day,
        startHH as string,
        dur as number,
        name as string,
        phone as string,
        treatment as string,
        score as number,
        confirmed as boolean,
        clinics[clinicIdx as number],
      )
    );
  });

  return appts;
}

// ─── RECALL ALERTS ───────────────────────────────────────────────────────────

export function buildDemoRecallAlerts(): RecallAlert[] {
  const lastWeek = DateTime.now().setZone(ZONE).minus({ weeks: 5 }).toISODate()!;
  const threeWeeksAgo = DateTime.now().setZone(ZONE).minus({ weeks: 3 }).toISODate()!;
  const fourWeeksAgo = DateTime.now().setZone(ZONE).minus({ weeks: 4 }).toISODate()!;

  return [
    {
      patientName: "Sofía Morales",
      patientPhone: "+34611900001",
      treatmentName: "Ortodoncia invisible (12 meses)",
      clinica: "Clínica Madrid Centro",
      lastApptIso: lastWeek,
      weeksSinceLast: 5,
      treatmentDurationMonths: 12,
    },
    {
      patientName: "Alejandro Ruiz",
      patientPhone: "+34611900002",
      treatmentName: "Implante dental (fase 2)",
      clinica: "Clínica Barcelona Eixample",
      lastApptIso: threeWeeksAgo,
      weeksSinceLast: 3,
      treatmentDurationMonths: 6,
    },
    {
      patientName: "Lucía García",
      patientPhone: "+34611900003",
      treatmentName: "Periodoncia activa",
      clinica: "Clínica Madrid Centro",
      lastApptIso: fourWeeksAgo,
      weeksSinceLast: 4,
      treatmentDurationMonths: 3,
    },
  ];
}

export function isDemoModeNoShows(count: number, min = 3): boolean {
  return count < min;
}
