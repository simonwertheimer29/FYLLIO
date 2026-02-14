// app/lib/scheduler/repo/waitlistRepo.ts
import { base, TABLES } from "../../airtable";

export type WaitlistEntry = {
  recordId: string;

  clinicRecordId?: string;
  patientRecordId?: string;
  treatmentRecordId?: string;
  preferredStaffRecordId?: string;

  diasPermitidos: string[]; // ["LUN","MIER","VIE"]
  rangoStart?: string; // Airtable ISO string
  rangoEnd?: string;

  estado?: string; // ACTIVE/OFFERED/...
  prioridad?: string; // Alta/Media/Baja
  urgencia?: string; // LOW/MED/HIGH
  permiteFueraRango?: boolean;

  offerHoldId?: string;
  offerExpiresAt?: string;
  offerCycle?: number;

  lastOfferedSlotKey?: string;
  lastOfferResult?: string;

  citaSeguraRecordId?: string;
  citaCerradaRecordId?: string;

  createdAt?: string;
};

const F = {
  clinic: "Clínica",
  patient: "Paciente",
  treatment: "Tratamiento",
  preferredStaff: "Profesional preferido",

  dias: "Dias_Permitidos",
  start: "Rango_Deseado_Start",
  end: "Rango_Deseado_End",

  estado: "Estado",
  prioridad: "Prioridad",
  urgencia: "Urgencia_Nivel",
  permiteFuera: "Permite_Fuera_Rango",

  offerHoldId: "Offer_Hold_Id",
  offerExpiresAt: "Offer_Expires_At",
  offerCycle: "Offer_Cycle",

  lastSlotKey: "Last_Offered_Slot_Key",
  lastResult: "Last_Offer_Result",

  citaSegura: "Cita_segura",
  citaCerrada: "Cita cerrada",

  createdAt: "Created_At",
  notas: "Notas",
};

function firstId(x: any): string | undefined {
  return Array.isArray(x) ? x[0] : undefined;
}
function str(x: any): string {
  return typeof x === "string" ? x : x ? String(x) : "";
}
function bool(x: any): boolean {
  return typeof x === "boolean" ? x : Boolean(x);
}
function num(x: any): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = str(x).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function esc(s: string) {
  return String(s).replace(/'/g, "\\'");
}

/**
 * Lista waitlist ACTIVE por tratamiento (recordId Airtable).
 * (Opcional) filtra por clínica si la pasas.
 */
export async function listActiveWaitlistByTreatment(params: {
  treatmentRecordId: string;
  clinicRecordId?: string;
  maxRecords?: number;
}): Promise<WaitlistEntry[]> {
  const { treatmentRecordId, clinicRecordId, maxRecords = 200 } = params;

  const parts: string[] = [
    `{${F.estado}}='ACTIVE'`,
    `FIND('${esc(treatmentRecordId)}', ARRAYJOIN({${F.treatment}}))`,
  ];

  if (clinicRecordId) {
    parts.push(`FIND('${esc(clinicRecordId)}', ARRAYJOIN({${F.clinic}}))`);
  }

  const formula = `AND(${parts.join(",")})`;

  const recs = await base(TABLES.waitlist)
    .select({ filterByFormula: formula, maxRecords })
    .all();

  return recs.map((r: any) => {
    const f: any = r.fields || {};
    return {
      recordId: r.id,

      clinicRecordId: firstId(f[F.clinic]),
      patientRecordId: firstId(f[F.patient]),
      treatmentRecordId: firstId(f[F.treatment]),
      preferredStaffRecordId: firstId(f[F.preferredStaff]),

      diasPermitidos: Array.isArray(f[F.dias]) ? f[F.dias].map(String) : [],
      rangoStart: str(f[F.start]) || undefined,
      rangoEnd: str(f[F.end]) || undefined,

      estado: str(f[F.estado]) || undefined,
      prioridad: str(f[F.prioridad]) || undefined,
      urgencia: str(f[F.urgencia]) || undefined,
      permiteFueraRango: bool(f[F.permiteFuera]),

      offerHoldId: str(f[F.offerHoldId]) || undefined,
      offerExpiresAt: str(f[F.offerExpiresAt]) || undefined,
      offerCycle: num(f[F.offerCycle]),

      lastOfferedSlotKey: str(f[F.lastSlotKey]) || undefined,
      lastOfferResult: str(f[F.lastResult]) || undefined,

      citaSeguraRecordId: firstId(f[F.citaSegura]),
      citaCerradaRecordId: firstId(f[F.citaCerrada]),

      createdAt: str(f[F.createdAt]) || undefined,
    } as WaitlistEntry;
  });
}

export async function listWaitlist(params: {
  clinicRecordId?: string;
  preferredStaffRecordId?: string;
  estados?: string[]; // default ["ACTIVE","OFFERED"]
  maxRecords?: number;
}): Promise<WaitlistEntry[]> {
  const {
    clinicRecordId,
    preferredStaffRecordId,
    estados = ["ACTIVE", "OFFERED"],
    maxRecords = 200,
  } = params;

  const parts: string[] = [];

  // estados
  if (estados.length === 1) {
    parts.push(`{${F.estado}}='${esc(estados[0])}'`);
  } else if (estados.length > 1) {
    parts.push(`OR(${estados.map((s) => `{${F.estado}}='${esc(s)}'`).join(",")})`);
  }

  // clinica
  if (clinicRecordId) {
    parts.push(`FIND('${esc(clinicRecordId)}', ARRAYJOIN({${F.clinic}}))`);
  }

  // profesional preferido
  if (preferredStaffRecordId) {
    parts.push(`FIND('${esc(preferredStaffRecordId)}', ARRAYJOIN({${F.preferredStaff}}))`);
  }

  const formula = parts.length ? `AND(${parts.join(",")})` : "";

  const recs = await base(TABLES.waitlist)
    .select({ filterByFormula: formula || undefined, maxRecords })
    .all();

  return recs.map((r: any) => {
    const f: any = r.fields || {};
    return {
      recordId: r.id,

      clinicRecordId: firstId(f[F.clinic]),
      patientRecordId: firstId(f[F.patient]),
      treatmentRecordId: firstId(f[F.treatment]),
      preferredStaffRecordId: firstId(f[F.preferredStaff]),

      diasPermitidos: Array.isArray(f[F.dias]) ? f[F.dias].map(String) : [],
      rangoStart: str(f[F.start]) || undefined,
      rangoEnd: str(f[F.end]) || undefined,

      estado: str(f[F.estado]) || undefined,
      prioridad: str(f[F.prioridad]) || undefined,
      urgencia: str(f[F.urgencia]) || undefined,
      permiteFueraRango: bool(f[F.permiteFuera]),

      offerHoldId: str(f[F.offerHoldId]) || undefined,
      offerExpiresAt: str(f[F.offerExpiresAt]) || undefined,
      offerCycle: num(f[F.offerCycle]),

      lastOfferedSlotKey: str(f[F.lastSlotKey]) || undefined,
      lastOfferResult: str(f[F.lastResult]) || undefined,

      citaSeguraRecordId: firstId(f[F.citaSegura]),
      citaCerradaRecordId: firstId(f[F.citaCerrada]),

      createdAt: str(f[F.createdAt]) || undefined,
    } as WaitlistEntry;
  });
}


export async function getOfferedEntryByPhone(params: {
  phoneE164: string;
}): Promise<WaitlistEntry | null> {
  // buscamos en Pacientes por Teléfono o Tutor teléfono, y luego la waitlist OFFERED linkeada a ese paciente.
  // Para MVP: hacemos 2 pasos.
  const phone = params.phoneE164;

  const patientFormula = `OR({Teléfono}='${esc(phone)}',{Tutor teléfono}='${esc(phone)}')`;
  const patients = await base(TABLES.patients)
    .select({ filterByFormula: patientFormula, maxRecords: 1 })
    .firstPage();

  const patient = patients?.[0];
  if (!patient) return null;

  const waitFormula = `AND({${F.estado}}='OFFERED',FIND('${esc(patient.id)}', ARRAYJOIN({${F.patient}})))`;
  const wait = await base(TABLES.waitlist)
    .select({ filterByFormula: waitFormula, maxRecords: 1 })
    .firstPage();

  const r = wait?.[0];
  if (!r) return null;

  const f: any = r.fields || {};
  return {
    recordId: r.id,
    clinicRecordId: firstId(f[F.clinic]),
    patientRecordId: firstId(f[F.patient]),
    treatmentRecordId: firstId(f[F.treatment]),
    preferredStaffRecordId: firstId(f[F.preferredStaff]),
    diasPermitidos: Array.isArray(f[F.dias]) ? f[F.dias].map(String) : [],
    rangoStart: str(f[F.start]) || undefined,
    rangoEnd: str(f[F.end]) || undefined,
    estado: str(f[F.estado]) || undefined,
    prioridad: str(f[F.prioridad]) || undefined,
    urgencia: str(f[F.urgencia]) || undefined,
    permiteFueraRango: bool(f[F.permiteFuera]),
    offerHoldId: str(f[F.offerHoldId]) || undefined,
    offerExpiresAt: str(f[F.offerExpiresAt]) || undefined,
    offerCycle: num(f[F.offerCycle]),
    lastOfferedSlotKey: str(f[F.lastSlotKey]) || undefined,
    lastOfferResult: str(f[F.lastResult]) || undefined,
    citaSeguraRecordId: firstId(f[F.citaSegura]),
    citaCerradaRecordId: firstId(f[F.citaCerrada]),
    createdAt: str(f[F.createdAt]) || undefined,
  };
}

export async function markWaitlistOffered(params: {
  waitlistRecordId: string;
  holdId: string;
  expiresAtIso: string; // Airtable ISO
  slotKey: string;
}) {
  await base(TABLES.waitlist).update([
    {
      id: params.waitlistRecordId,
      fields: {
        [F.estado]: "OFFERED",
        [F.offerHoldId]: params.holdId,
        [F.offerExpiresAt]: params.expiresAtIso,
        [F.lastSlotKey]: params.slotKey,
        [F.lastResult]: "SENT",
      },
    },
  ]);
}

export async function markWaitlistActiveWithResult(params: {
  waitlistRecordId: string;
  result: "REJECTED" | "EXPIRED";
}) {
  await base(TABLES.waitlist).update([
    {
      id: params.waitlistRecordId,
      fields: {
        [F.estado]: params.result === "EXPIRED" ? "EXPIRED" : "ACTIVE",
        [F.lastResult]: params.result,
      },
    },
  ]);
}

export async function markWaitlistBooked(params: {
  waitlistRecordId: string;
  appointmentRecordId: string;
}) {
  await base(TABLES.waitlist).update([
    {
      id: params.waitlistRecordId,
      fields: {
        [F.estado]: "BOOKED",
        [F.lastResult]: "ACCEPTED",
        [F.citaCerrada]: [params.appointmentRecordId],
      },
    },
  ]);
}

/** Utilidad: obtener nombre/teléfono desde Paciente link (para mensajes) */
export async function getPatientContact(params: { patientRecordId: string }) {
  const r = await base(TABLES.patients).find(params.patientRecordId);
  const f: any = r.fields || {};
  return {
    name: str(f["Nombre"]) || "Paciente",
    phone: str(f["Teléfono"]) || "",
    tutorPhone: str(f["Tutor teléfono"]) || "",
  };
}

/** Utilidad: leer tratamiento (duración/buffers/nombre) por recordId */
export async function getTreatmentMeta(params: { treatmentRecordId: string }) {
  const r = await base(TABLES.treatments).find(params.treatmentRecordId);
  const f: any = r.fields || {};
  return {
    name: str(f["Categoria"]) || "Tratamiento",
    durationMin: typeof f["Duración"] === "number" ? f["Duración"] : Number(str(f["Duración"]) || 30),
    bufferBeforeMin: typeof f["Buffer antes"] === "number" ? f["Buffer antes"] : Number(str(f["Buffer antes"]) || 0),
    bufferAfterMin: typeof f["Buffer despues"] === "number" ? f["Buffer despues"] : Number(str(f["Buffer despues"]) || 0),
  };
}

export async function updateWaitlistEntry(params: {
  waitlistRecordId: string;
  patch: {
    estado?: string;
    ultimoContacto?: string;
  };
}) {
  const { waitlistRecordId, patch } = params;

  const fields: any = {};

  if (patch.estado !== undefined) {
    fields["Estado"] = patch.estado;
  }

  if (patch.ultimoContacto !== undefined) {
    fields["Último contacto"] = patch.ultimoContacto;
  }

  await base(TABLES.waitlist).update([
    {
      id: waitlistRecordId,
      fields,
    },
  ]);
}

export async function createWaitlistEntry(params: {
  clinicRecordId: string;
  patientRecordId: string;
  treatmentRecordId: string;
  preferredStaffRecordId?: string;

  diasPermitidos?: string[];        // default LUN..VIE
  rangoStartIso?: string;           // ISO
  rangoEndIso?: string;             // ISO
  prioridad?: "ALTA" | "MEDIA" | "BAJA";
  urgencia?: "LOW" | "MED" | "HIGH";
  permiteFueraRango?: boolean;
  notas?: string;
}) {
  const {
    clinicRecordId,
    patientRecordId,
    treatmentRecordId,
    preferredStaffRecordId,
    diasPermitidos = ["LUN", "MAR", "MIE", "JUE", "VIE"],
    rangoStartIso,
    rangoEndIso,
    prioridad = "MEDIA",
    urgencia = "LOW",
    permiteFueraRango = false,
    notas,
  } = params;

  const fields: any = {
    [F.clinic]: [clinicRecordId],
    [F.patient]: [patientRecordId],
    [F.treatment]: [treatmentRecordId],
    [F.dias]: diasPermitidos,
    [F.estado]: "ACTIVE",
    [F.prioridad]: prioridad,
    [F.urgencia]: urgencia,
    [F.permiteFuera]: permiteFueraRango,
    ...(preferredStaffRecordId ? { [F.preferredStaff]: [preferredStaffRecordId] } : {}),
    ...(rangoStartIso ? { [F.start]: rangoStartIso } : {}),
    ...(rangoEndIso ? { [F.end]: rangoEndIso } : {}),
    ...(notas ? { [F.notas]: notas } : {}),
  };

  const created = await base(TABLES.waitlist).create([{ fields }]);
  const r: any = created?.[0];
  return { recordId: r?.id as string };
}


