// app/lib/scheduler/types.ts
export type Slot = {
  slotId: string;        // id estable para hold
  start: string;         // ISO local
  end: string;           // ISO local
  chairId: number;
  providerId: string;
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
  dateIso?: string; // ✅ ahora opcional
  preferredStartHHMM?: string;
  preferredEndHHMM?: string;
  chairId?: number;
  providerId?: string;
};


export type GetAvailableSlotsInput = {
  rules: import("../types").RulesState;
  // tratamiento: se resuelve por type en tu RulesState.treatments
  treatmentType: string;
  preferences: Preferences;
  providerIds?: string[];
};
