// app/lib/demoData.ts
import type { Appointment, RulesState } from "./types";

export const APPOINTMENTS: Appointment[] = [
  { id: "1", patientName: "María López", start: "2025-12-11T09:00:00", end: "2025-12-11T09:30:00", type: "Revisión", chairId: 1 },
  { id: "2", patientName: "Carlos Ruiz", start: "2025-12-11T09:40:00", end: "2025-12-11T10:10:00", type: "Limpieza", chairId: 1 },
];


export const DEFAULT_RULES: RulesState = {
  dayStartTime: "08:30",
  dayEndTime: "19:00",
    lunchStartTime: "",
  lunchEndTime: "",
  // enableLunch: true, // si lo añadiste

  minBookableSlotMin: 30,
  chairsCount: 1,
  workSat: false,
  enableBuffers: true,
  bufferMin: 0,
  longGapThreshold: 35,
  maxRescheduleShiftMin: 120,

  adminMinPerAutoAction: 2,
  workdaysPerMonth: 18,
  minPerMessageOrCallAvoided: 2,

  maxGapPanels: 3,
  maxReschedules: 3,

  treatmentOrder: "MIXED",

  // ✅ NO por default
  treatments: [],

  extraRulesText: "",
};
