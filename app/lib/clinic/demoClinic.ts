// app/lib/clinic/demoClinic.ts

export type Provider = {
  id: string;
  name: string;
  treatments?: string[];
};

export const DEMO_PROVIDERS: Provider[] = [
  { id: "STF_001", name: "Dr. García", treatments: ["Revisión", "Limpieza", "Carillas"] },
  { id: "STF_002", name: "Dra. Pérez", treatments: ["Implantes", "Endodoncia"] },
  { id: "STF_003", name: "Higienista", treatments: ["Limpieza"] },
];
