// app/lib/scheduler/types.ts
export type Slot = {
  slotId: string;        // id estable para hold
  start: string;         // ISO local
  end: string;           // ISO local
  chairId: number;
  providerId?: string;
};

export type Hold = {
  id: string;
  slot: Slot;
  patientId: string;
  treatmentType: string;
  expiresAtIso: string;
  status: "HELD" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
};

export type Preferences = {
  dateIso: string; // "2026-01-27"
  preferredStartHHMM?: string; // opcional (para filtrar)
  preferredEndHHMM?: string;
  chairId?: number; // si el paciente quiere con X
  providerId?: string; // futuro
};

export type GetAvailableSlotsInput = {
  rules: import("../types").RulesState;
  // tratamiento: se resuelve por type en tu RulesState.treatments
  treatmentType: string;
  preferences: Preferences;
};
