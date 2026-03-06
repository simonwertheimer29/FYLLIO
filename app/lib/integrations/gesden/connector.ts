// app/lib/integrations/gesden/connector.ts
// Connector interface for Gesden integration.
// Two implementations: CSV (active now) and API (stub, activate when Gesden provides access).

export interface GesdenPatient {
  nombre: string;
  telefono: string;
  email?: string;
  fechaNacimiento?: string;
  nhc?: string;
  sexo?: string;
}

export interface GesdenAppointment {
  fecha: string;       // ISO date YYYY-MM-DD
  hora: string;        // HH:mm
  duracionMin?: number;
  motivo?: string;     // treatment/reason
  doctor?: string;
  estado?: string;     // "Atendido" | "Cancelado" | etc.
  nhcPaciente?: string;
}

export interface GesdenTreatment {
  nombre: string;
  duracionMin?: number;
  precio?: number;
}

/** Contract that all Gesden connectors must fulfil */
export interface GesdenConnector {
  getPatients(): Promise<GesdenPatient[]>;
  getAppointments(from?: Date, to?: Date): Promise<GesdenAppointment[]>;
  getTreatments(): Promise<GesdenTreatment[]>;
}

// ── CSV implementation (active) ───────────────────────────────────────────────

/**
 * Initialised with pre-parsed data (from the importer UI / API route).
 * The UI parses the CSV and passes the structured arrays here.
 */
export class GesdenCsvConnector implements GesdenConnector {
  constructor(
    private readonly patients: GesdenPatient[],
    private readonly appointments: GesdenAppointment[] = [],
    private readonly treatments: GesdenTreatment[] = []
  ) {}

  async getPatients(): Promise<GesdenPatient[]> {
    return this.patients;
  }

  async getAppointments(): Promise<GesdenAppointment[]> {
    return this.appointments;
  }

  async getTreatments(): Promise<GesdenTreatment[]> {
    return this.treatments;
  }
}

// ── API implementation (stub — activate when Gesden provides credentials) ─────

/**
 * Ready to activate once Gesden provides API credentials.
 * Set GESDEN_API_KEY, GESDEN_API_URL, and GESDEN_CLINIC_ID in .env.local.
 */
export class GesdenApiConnector implements GesdenConnector {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly clinicId: string
  ) {}

  async getPatients(): Promise<GesdenPatient[]> {
    throw new Error(
      "Gesden API connector not yet activated. " +
        "Set GESDEN_API_KEY, GESDEN_API_URL, and GESDEN_CLINIC_ID in your environment."
    );
  }

  async getAppointments(): Promise<GesdenAppointment[]> {
    throw new Error("Gesden API connector not yet activated.");
  }

  async getTreatments(): Promise<GesdenTreatment[]> {
    throw new Error("Gesden API connector not yet activated.");
  }
}

/** Factory: returns the right connector based on env vars */
export function createGesdenConnector(
  csvPatients?: GesdenPatient[],
  csvAppointments?: GesdenAppointment[]
): GesdenConnector {
  const apiKey = process.env.GESDEN_API_KEY;
  const apiUrl = process.env.GESDEN_API_URL;
  const clinicId = process.env.GESDEN_CLINIC_ID;

  if (apiKey && apiUrl && clinicId) {
    return new GesdenApiConnector(apiKey, apiUrl, clinicId);
  }

  return new GesdenCsvConnector(csvPatients ?? [], csvAppointments ?? []);
}
