// app/lib/clinic/demoClinic.ts

export type Provider = {
  id: string;
  name: string;
  treatments?: string[];
};

export const DEMO_PROVIDERS: Provider[] = [
  { id: "p1", name: "Dr. García", treatments: ["Revisión", "Limpieza", "Carillas"] },
  { id: "p2", name: "Dra. Pérez", treatments: ["Implantes", "Endodoncia"] },
  { id: "p3", name: "Higienista", treatments: ["Limpieza"] },
];
