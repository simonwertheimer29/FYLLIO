// app/lib/types.ts

export type TreatmentOrder = "MIXED" | "LONG_MORNING_SHORT_AFTERNOON" | "CUSTOM";

export type AllowedWindow = { startHHMM: string; endHHMM: string };

export type TreatmentScheduleRule = {
  type: string;
  durationMin: number;
 bufferMin?: number; // 0 = sin buffer para este tratamiento (override del global)

  allowedWindows?: AllowedWindow[]; // ✅ nuevo: ventanas permitidas
};



export type Appointment = {
  id: string;          // ✅ antes number
  patientName: string;
  start: string;
  end: string;
  type: string;
  chairId?: number;
  providerId?: string;
  patientPhone?: string;
};



export type RulesState = {
  // Clinic core
  dayStartTime: string;       // "08:30"
  dayEndTime: string;         // "19:00"
    lunchStartTime?: string; // "13:30"
  lunchEndTime?: string;   // "14:30"
    enableLunch?: boolean;

  minBookableSlotMin: number; // mínimo hueco = “tiempo disponible”
  chairsCount: number;        // 1..N
  workSat: boolean;

  // ✅ Global toggles (IA usa esto para proponer buffers/breaks)
 
  enableBuffers: boolean;
 bufferMin: number; // 0 permitido (significa sin buffers)


  longGapThreshold: number;
  maxRescheduleShiftMin: number;
  maxGapPanels: number;
  maxReschedules: number;

  adminMinPerAutoAction: number;
  workdaysPerMonth: number;
  minPerMessageOrCallAvoided: number;

  treatmentOrder: TreatmentOrder;

  /** ✅ SOLO duración por tratamiento */
  treatments: TreatmentScheduleRule[];

  extraRulesText?: string;
};

export type GapAlternativeType =
  | "RECALL_PATIENTS"
  | "PERSONAL_TIME"
  | "INTERNAL_MEETING"
  | "WAIT"
  | "ADVANCE_APPOINTMENTS";

  export type SwitchOffer = {
  fromApptId: string;     // cita que se movería (ej: Maria 4:00–4:30)
  toStart: string;        // nuevo inicio (ej: 3:30)
  toEnd: string;          // nuevo fin (ej: 4:00)
  newPatientName: string; // interesado que entra al slot liberado
  newType?: string;
  newStart: string;       // (normalmente el slot ocupado original)
  newEnd: string;
  reason: string;         // texto tipo “hay interesado en 4:00–4:30”
};

export type GapMeta = {
  gapKey: string;
  start: string;
  end: string;
  durationMin: number;

  chairId: number;

  hasRequestsNow: boolean;
  hasRecallCandidates: boolean;

  fillProbability: "LOW" | "MEDIUM" | "HIGH";
  recommendation: "FILL_WITH_REQUESTS" | "RECALL_PATIENTS" | "PERSONAL_TIME" | "WAIT_OR_RESCHEDULE";

  rationale: string;
  nextSteps: string[];

    status: "OPEN" | "CONTACTING" | "FAILED" | "FILLED" | "BLOCKED_INTERNAL" | "BLOCKED_PERSONAL";
  switchOffer?: SwitchOffer | null;
    contactedCount: number;
  responsesCount: number;

  // ✅ simulación 30s + contadores visibles
  messagesCount?: number;
  callsCount?: number;
  contactingStartedAtIso?: string;
  contactingEndsAtIso?: string;
  contactingProgressPct?: number; // 0..100

  alternatives: { type: GapAlternativeType; title: string; primary?: boolean }[];

  isEndOfDay?: boolean;
  isStartOfDay?: boolean;
  switchRequested?: boolean;
switchContext?: {
  requestedByPatientName: string;
  requestedSlotStart: string; // ej: 15:30
};

};

export type AiActionType =
  | "RESCHEDULE"
  | "ADD_BUFFER"
  | "BLOCK_BREAK"
  | "CONFIRM"
  | "FILL_GAP"
  | "BLOCK_PERSONAL"
  | "GAP_PANEL";

export type AiAction = {
  id: string;
  title: string;
  type: AiActionType;
  impact?: { minutesSaved?: number; stressDelta?: number };
  meta?: GapMeta;
  changes: {
    appointmentId: string;
    newStart: string | null;
    newEnd: string | null;
    note?: string;
  }[];
};

export type AiResult = {
  summary: string;
  stressLevel: "LOW" | "MEDIUM" | "HIGH";
  insights: string[];

  /** ✅ agenda creada por IA */
  appointments: Appointment[];

  /** panels/confirmaciones, etc */
  actions: AiAction[];
};

export type AgendaItem =
  | {
      kind: "APPOINTMENT";
      id: string;
      patientName: string;
      start: string;
      end: string;
      type: string;
      durationMin: number;
      chairId: number;
      changed?: boolean;
      sourceActionId?: string;
      providerId?: string; // ✅ NUEVO (en APPOINTMENT, GAP, AI_BLOCK)

    }
  | {
      kind: "AI_BLOCK";
      id: string;
      start: string;
      end: string;
      label: string;
      note?: string;
      durationMin: number;
      sourceActionId?: string;
      blockType: "BREAK" | "BUFFER" | "PERSONAL" | "INTERNAL";
      chairId: number;
      providerId?: string;

      // ✅ NUEVO: para que impacto/historial cuente mensajes/llamadas aunque ya no exista el GAP
      meta?: GapMeta;

    }
  | {
      kind: "GAP";
      id: string;
      start: string;
      end: string;
      durationMin: number;
      label?: string;
      meta?: GapMeta;
      chairId: number;
      providerId?: string; // ✅ NUEVO (en APPOINTMENT, GAP, AI_BLOCK)

    };
