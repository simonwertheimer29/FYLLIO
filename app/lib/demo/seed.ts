// app/lib/demo/seed.ts
// Single source of truth for demo data used across all API routes when
// Airtable returns insufficient real data (DEMO_MODE fallback).
// These 5 patients appear consistently in HOY, ACCIONES, RIESGO, ROI.

import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso() {
  return DateTime.now().setZone(ZONE).toISODate()!;
}

function tomorrowIso() {
  return DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate()!;
}

function todayAt(hhmm: string): string {
  return DateTime.now().setZone(ZONE).toISODate()! + "T" + hhmm + ":00";
}

function tomorrowAt(hhmm: string): string {
  return tomorrowIso() + "T" + hhmm + ":00";
}

function plusDaysAt(n: number, hhmm: string): string {
  return DateTime.now().setZone(ZONE).plus({ days: n }).toISODate()! + "T" + hhmm + ":00";
}

// ── Patient definitions ───────────────────────────────────────────────────────

export type RiskBreakdown = {
  factor: string;
  score: number;
  max: number;
  description: string;
};

export type DemoPatient = {
  id: string;
  name: string;
  phone: string;
  treatment: string;
  treatmentValue: number;
  noShowRisk: "HIGH" | "MED" | "LOW";
  riskScore: number; // 0-100
  riskBreakdown?: RiskBreakdown[];
  todayAppt?: { time: string; confirmed: boolean; durationMin: number };
  tomorrowAppt?: { time: string; confirmed: boolean; durationMin: number };
  ongoingStatus?: "ALERT" | "WARN" | "OK";
  lastVisitWeeksAgo?: number;
  feedbackScore?: number; // 1-5
  feedbackHoursAgo?: number;
  quoteAmount?: number;
  quoteDaysAgo?: number;
  note: string;
};

export const DEMO_PATIENTS: DemoPatient[] = [
  {
    id: "demo-maria",
    name: "María González",
    phone: "+34666111001",
    treatment: "Implante dental",
    treatmentValue: 1200,
    noShowRisk: "HIGH",
    riskScore: 82,
    riskBreakdown: [
      { factor: "Historial no-shows",     score: 32, max: 40, description: "2 no-shows registrados en los últimos 6 meses" },
      { factor: "Sin confirmar",          score: 22, max: 25, description: "No ha respondido al recordatorio enviado hace 48h" },
      { factor: "Día y hora de la cita",  score: 18, max: 20, description: "Lunes 10:30 — franja de alta tasa de abandono" },
      { factor: "Tipo de tratamiento",    score: 10, max: 15, description: "Implante (alta inversión, más probabilidad de aplazar)" },
    ],
    todayAppt: { time: "10:30", confirmed: false, durationMin: 90 },
    note: "2 no-shows previos — URGENTE confirmar",
  },
  {
    id: "demo-carlos",
    name: "Carlos Ruiz",
    phone: "+34666111002",
    treatment: "Ortodoncia invisible",
    treatmentValue: 2400,
    noShowRisk: "MED",
    riskScore: 65,
    tomorrowAppt: { time: "09:00", confirmed: false, durationMin: 60 },
    note: "Primera vez en este tratamiento, cita mañana temprano",
  },
  {
    id: "demo-ana",
    name: "Ana Martínez",
    phone: "+34666111003",
    treatment: "Prótesis dental",
    treatmentValue: 890,
    noShowRisk: "LOW",
    riskScore: 41,
    ongoingStatus: "ALERT",
    lastVisitWeeksAgo: 6,
    note: "Tratamiento activo — sin cita próxima desde hace 6 semanas",
  },
  {
    id: "demo-luis",
    name: "Luis Fernández",
    phone: "+34666111004",
    treatment: "Revisión general",
    treatmentValue: 60,
    noShowRisk: "LOW",
    riskScore: 22,
    feedbackScore: 1,
    feedbackHoursAgo: 18,
    note: "Valoración 1/5 hace 18h — LLAMAR HOY",
  },
  {
    id: "demo-sofia",
    name: "Sofía Torres",
    phone: "+34666111005",
    treatment: "Blanqueamiento dental",
    treatmentValue: 380,
    noShowRisk: "LOW",
    riskScore: 15,
    quoteAmount: 380,
    quoteDaysAgo: 18,
    note: "Presupuesto sin respuesta 18 días",
  },
];

// ── Today's appointment schedule (for HOY module) ─────────────────────────────

export type DemoAppt = {
  recordId: string;
  patientName: string;
  phone: string;
  treatmentName: string;
  start: string;       // HH:mm
  end: string;         // HH:mm
  startIso: string;    // ISO full
  durationMin: number;
  confirmed: boolean;
  isBlock: boolean;
  noShowRisk: "HIGH" | "MED" | "LOW";
  riskBreakdown?: RiskBreakdown[];
};

export function buildDemoTodayAppointments(): DemoAppt[] {
  return [
    { recordId: "demo-a1",    patientName: "Pedro Morales",    phone: "+34666200001", treatmentName: "Limpieza dental",     start: "09:00", end: "09:30", startIso: todayAt("09:00"), durationMin: 30, confirmed: true,  isBlock: false, noShowRisk: "LOW"  },
    { recordId: "demo-a2",    patientName: "Laura Sánchez",    phone: "+34666200002", treatmentName: "Revisión general",    start: "09:45", end: "10:15", startIso: todayAt("09:45"), durationMin: 30, confirmed: true,  isBlock: false, noShowRisk: "LOW"  },
    { recordId: "demo-maria", patientName: "María González",   phone: "+34666111001", treatmentName: "Implante dental",     start: "10:30", end: "12:00", startIso: todayAt("10:30"), durationMin: 90, confirmed: false, isBlock: false, noShowRisk: "HIGH", riskBreakdown: DEMO_PATIENTS[0].riskBreakdown },
    { recordId: "demo-a3",    patientName: "Roberto Díaz",     phone: "+34666200003", treatmentName: "Empaste",             start: "12:15", end: "12:45", startIso: todayAt("12:15"), durationMin: 30, confirmed: true,  isBlock: false, noShowRisk: "LOW"  },
    { recordId: "demo-b1",    patientName: "Marta Iglesias",   phone: "+34666200008", treatmentName: "Revisión urgente",    start: "13:15", end: "14:00", startIso: todayAt("13:15"), durationMin: 45, confirmed: false, isBlock: false, noShowRisk: "HIGH" },
    { recordId: "demo-b2",    patientName: "Javier Romero",    phone: "+34666200009", treatmentName: "Consulta inicial",    start: "14:15", end: "15:00", startIso: todayAt("14:15"), durationMin: 45, confirmed: false, isBlock: false, noShowRisk: "MED"  },
    { recordId: "demo-a4",    patientName: "Carmen López",     phone: "+34666200004", treatmentName: "Blanqueamiento",      start: "16:00", end: "17:00", startIso: todayAt("16:00"), durationMin: 60, confirmed: true,  isBlock: false, noShowRisk: "MED"  },
    { recordId: "demo-a5",    patientName: "Miguel Torres",    phone: "+34666200005", treatmentName: "Ortodoncia revisión", start: "17:15", end: "17:45", startIso: todayAt("17:15"), durationMin: 30, confirmed: true,  isBlock: false, noShowRisk: "LOW"  },
    { recordId: "demo-a6",    patientName: "Isabel Romero",    phone: "+34666200006", treatmentName: "Revisión general",    start: "18:00", end: "18:30", startIso: todayAt("18:00"), durationMin: 30, confirmed: false, isBlock: false, noShowRisk: "MED"  },
    { recordId: "demo-a7",    patientName: "Fernando Jiménez", phone: "+34666200007", treatmentName: "Limpieza dental",     start: "18:45", end: "19:15", startIso: todayAt("18:45"), durationMin: 30, confirmed: true,  isBlock: false, noShowRisk: "LOW"  },
  ];
}

// ── Today's gaps ───────────────────────────────────────────────────────────────

export function buildDemoTodayGaps() {
  return [
    {
      start: "13:00",
      end: "14:30",
      startIso: todayAt("13:00"),
      durationMin: 90,
      candidates: [
        { type: "WAITLIST" as const, patientName: "Ana Martínez", phone: "+34666111003", label: "Prótesis dental", waitingLabel: "6 semanas esperando", priorityBadge: "🔴" },
        { type: "RECALL" as const,   patientName: "Sofía Torres",  phone: "+34666111005", label: "Revisión semestral", waitingLabel: "7 meses sin visita" },
      ],
    },
    {
      start: "15:00",
      end: "16:00",
      startIso: todayAt("15:00"),
      durationMin: 60,
      candidates: [
        { type: "WAITLIST" as const, patientName: "Carlos Perea",  phone: "+34666300001", label: "Empaste urgente",  waitingLabel: "2 semanas esperando", priorityBadge: "⚡" },
      ],
    },
  ];
}

// ── KPI summary for HOY module ────────────────────────────────────────────────

export const DEMO_TODAY_SUMMARY = {
  confirmedRevenue: 420,   // 7 citas confirmadas × €60
  atRiskRevenue: 240,      // 4 sin confirmar × €60
  gapRevenue: 570,         // 90min + 60min huecos
  confirmedCount: 7,
  unconfirmedCount: 4,
  gapCount: 2,
  totalAppointments: 11,
};

// ── ROI / stats data ──────────────────────────────────────────────────────────

export const DEMO_STATS = {
  whatsappConversations: 45,
  timeSavedMin: 225,         // 45 × 5 min
  confirmedViaWhatsApp: 8,
  waitlistRevenue: 480,      // 8 × €60
  googleReviews: 22,
  noShowsThisWeek: 0,
  noShowRateClinic: 4.2,     // %
  noShowRateSector: 12.0,    // %
  totalValueWeek: 1580,
};

// ── Revenue data ──────────────────────────────────────────────────────────────

export const DEMO_REVENUE = {
  today: 420,
  thisWeek: 2940,
  lastWeek: 2640,
  thisMonth: 7800,
  projectedMonth: 9800,
  avgTicket: 60,
  weekDelta: +11.4,   // %
  monthDelta: +8.2,   // %
};

// ── Feedback / reputation data ────────────────────────────────────────────────

export const DEMO_FEEDBACK = {
  avgScore: 4.6,
  totalReviews: 22,
  distribution: { 5: 14, 4: 5, 3: 2, 2: 0, 1: 1 },
  negativeAlerts: [
    {
      patientName: "Luis Fernández",
      phone: "+34666111004",
      score: 1,
      hoursAgo: 18,
      treatment: "Revisión general",
      note: "No recibí respuesta a mi mensaje",
    },
  ],
};

// ── Risk panel patients (for RIESGO module) ───────────────────────────────────

export function buildDemoRiskPatients() {
  const appts = buildDemoTodayAppointments();
  return [
    {
      recordId: "demo-risk-maria",
      patientName: "María González",
      phone: "+34666111001",
      treatmentName: "Implante dental",
      start: todayAt("10:30"),
      durationMin: 90,
      noShowRisk: "HIGH" as const,
      confirmed: false,
      riskScore: 82,
      riskBreakdown: DEMO_PATIENTS[0].riskBreakdown,
      isBlock: false,
    },
    {
      recordId: "demo-risk-carlos",
      patientName: "Carlos Ruiz",
      phone: "+34666111002",
      treatmentName: "Ortodoncia invisible",
      start: tomorrowAt("09:00"),
      durationMin: 60,
      noShowRisk: "MED" as const,
      confirmed: false,
      riskScore: 65,
      isBlock: false,
    },
    {
      recordId: "demo-risk-roberto",
      patientName: "Roberto Vázquez",
      phone: "+34666222001",
      treatmentName: "Revisión periódica",
      start: tomorrowAt("10:00"),
      durationMin: 30,
      noShowRisk: "HIGH" as const,
      confirmed: false,
      riskScore: 74,
      riskBreakdown: [
        { factor: "Historial cancelaciones", score: 20, max: 40, description: "2 cancelaciones de última hora en los últimos 3 meses" },
        { factor: "Sin confirmar",           score: 22, max: 25, description: "Reservó hace 35 días sin confirmar" },
        { factor: "Tipo de tratamiento",     score: 18, max: 20, description: "Revisión corta — alta tasa de cancelación" },
        { factor: "Día y hora",              score: 14, max: 15, description: "Martes 10:00 — franja media abandono" },
      ],
      isBlock: false,
    },
    {
      recordId: "demo-risk-elena",
      patientName: "Elena Morales",
      phone: "+34666222002",
      treatmentName: "Limpieza dental",
      start: plusDaysAt(2, "16:30"),
      durationMin: 45,
      noShowRisk: "HIGH" as const,
      confirmed: false,
      riskScore: 68,
      riskBreakdown: [
        { factor: "Historial no-shows",      score: 16, max: 40, description: "1 no-show registrado en los últimos 6 meses" },
        { factor: "Sin confirmar",           score: 22, max: 25, description: "No ha respondido al recordatorio" },
        { factor: "Día y hora",              score: 18, max: 20, description: "Viernes 16:30 — franja de mayor abandono" },
        { factor: "Tipo de tratamiento",     score: 12, max: 15, description: "Limpieza — alta tasa de cancelación de último momento" },
      ],
      isBlock: false,
    },
    {
      recordId: "demo-risk-david",
      patientName: "David Sánchez",
      phone: "+34666222003",
      treatmentName: "Empaste",
      start: tomorrowAt("08:30"),
      durationMin: 45,
      noShowRisk: "MED" as const,
      confirmed: false,
      riskScore: 48,
      riskBreakdown: [
        { factor: "Historial no-shows",      score: 0,  max: 40, description: "Sin no-shows previos registrados" },
        { factor: "Sin confirmar",           score: 22, max: 25, description: "Reserva sin confirmar" },
        { factor: "Día y hora",              score: 14, max: 20, description: "Mañana temprano 08:30 — mayor tasa de abandono" },
        { factor: "Tipo de tratamiento",     score: 12, max: 15, description: "Empaste — compromiso medio" },
      ],
      isBlock: false,
    },
    {
      recordId: "demo-risk-isabel",
      patientName: "Isabel López",
      phone: "+34666300010",
      treatmentName: "Revisión semestral",
      start: tomorrowAt("11:30"),
      durationMin: 30,
      noShowRisk: "LOW" as const,
      confirmed: true,
      riskScore: 41,
      isBlock: false,
    },
  ];
}

// ── Ongoing treatments (TRATAMIENTOS ACTIVOS) ────────────────────────────────

export const DEMO_ONGOING = [
  {
    patientName: "Ana Martínez",
    phone: "+34666111003",
    treatmentName: "Prótesis dental",
    treatmentValue: 890,
    lastVisitLabel: "Hace 6 semanas",
    status: "ALERT" as const,
  },
  {
    patientName: "Carlos Ruiz",
    phone: "+34666111002",
    treatmentName: "Ortodoncia invisible",
    treatmentValue: 2400,
    lastVisitLabel: "Hace 3 semanas",
    status: "WARN" as const,
  },
];

// ── isDemoMode helper ─────────────────────────────────────────────────────────

/** Returns true when real data is too sparse to make the demo impressive */
export function isDemoMode(realCount: number, threshold = 3): boolean {
  return realCount < threshold;
}
