// app/lib/metricas/fuga.tipos.ts
//
// EL MAPA DE FUGA (plan maestro 2.2, MEJORAS 177): tipos, constantes y copy,
// PUROS — ni base de datos ni Node. Los importa la pantalla (Client
// Component) y el módulo de servidor `fuga.ts` los reexporta. Regla §22/§24
// del skill de ingeniería: lo que el cliente necesita de un módulo de
// servidor vive en un módulo como este, y `qa:frontera` lo vigila.
//
// La pregunta que responde el mapa: en una ventana de días COMPLETOS hasta
// ayer, ¿cuántos casos SALIERON del flujo lead → cita → presupuesto → cobro,
// en qué etapa, cuánto costaron y qué motivo quedó registrado? Es la lectura
// analítica; lo que está parado HOY (y se puede rescatar hoy) vive en Inicio.

export const VENTANAS_FUGA = [30, 90, 180] as const;
export type VentanaFuga = (typeof VENTANAS_FUGA)[number];
export const VENTANA_FUGA_DEFAULT: VentanaFuga = 90;

/** Con cuántos días de la propia clínica se calcula «cómo cierran tus leads»
 *  (tasa lead → presupuesto aceptado y ticket medio) para el € esperado. */
export const ESTIMACION_DIAS = 180;

/** Aceptados mínimos para que la tasa lead → aceptado sirva de estimación.
 *  Mismo espíritu que `BASE_MINIMA_COHORTE` (Inicio): con 2 aceptados, un
 *  ticket medio multiplicado por una tasa es ruido con dos decimales. */
export const MIN_ACEPTADOS_ESTIMACION = 5;

export type EtapaFuga = "sin_contacto" | "sin_cita" | "presupuesto_perdido" | "cobro_vencido";
export const ORDEN_ETAPAS: readonly EtapaFuga[] = ["sin_contacto", "sin_cita", "presupuesto_perdido", "cobro_vencido"];

/** Casos y, cuando los casos tienen importe, su suma. null = etapa sin €. */
export type Tramo = { n: number; eur: number | null };

export type MotivoFuga = {
  clave: string;
  etiqueta: string;
  n: number;
  /** Σ € de los casos con este motivo; null en etapas sin importe. */
  eur: number | null;
  /** Solo leads: si con este motivo queda algo que intentar (vocabulario 42). */
  reactivable: boolean | null;
};

/** Lo que el agente recogió en la conversación de un caso que se cerró SIN
 *  motivo (o con «otro»): la frase del paciente y, si el mapeo conservador
 *  la reconoce, el motivo del vocabulario que sugiere. */
export type FraseDelAgente = {
  frase: string;
  sugerido: string | null;
  etiquetaSugerida: string | null;
};

/** € esperado de los leads perdidos, con el método a la vista: casos × tasa
 *  (de cada lead captado, cuántos acabaron aceptando) × ticket medio aceptado,
 *  todo de la propia clínica en `dias`. No es dinero que existiera: es lo que
 *  habrían valido si hubieran cerrado como la media. Sin base suficiente, no
 *  se estima y se dice por qué. */
export type Estimado = {
  eur: number | null;
  motivo: string | null;
  tasaPct: number | null;
  ticketMedio: number | null;
  captados: number;
  aceptados: number;
  dias: number;
};

export type EtapaDeFuga = {
  etapa: EtapaFuga;
  titulo: string;
  detalle: string;
  actual: Tramo;
  /** Misma longitud, justo antes; null = no comparable (y `previoMotivo` dice por qué). */
  previo: Tramo | null;
  previoMotivo: string | null;
  /** Motivo registrado por la persona al cerrar, de más a menos frecuente. */
  motivos: MotivoFuga[];
  sinMotivo: number;
  frasesDelAgente: FraseDelAgente[];
  href: string;
  /** Solo leads. */
  estimado: Estimado | null;
  /** Solo «sin cita»: de los contactados que se perdieron, cuántos SÍ habían tenido cita. */
  conCita: number | null;
  /** Solo cobros: lo vencido A DÍA DE HOY, incluidos los que vencieron antes de la ventana. */
  vencidoHoy: Tramo | null;
};

export type Fuga = {
  clinicaId: string | null;
  ventana: { desde: string; hasta: string; dias: number };
  ventanaPrevia: { desde: string; hasta: string };
  etapas: EtapaDeFuga[];
  total: {
    casos: number;
    /** Presupuestos perdidos + cobros vencidos: dinero de documentos reales. */
    eurReal: number;
    /** Σ estimados de las dos etapas de leads; null si ninguna se pudo estimar. */
    eurEstimado: number | null;
  };
  generadoEnISO: string;
};

/** El copy de cada etapa: el QUÉ en 3-6 palabras y el criterio completo. */
export const COPY_ETAPA: Record<EtapaFuga, { titulo: string; detalle: string }> = {
  sin_contacto: {
    titulo: "Se fueron sin que nadie les hablara",
    detalle: "Leads cerrados como «no interesado» sin un mensaje ni una llamada nuestra antes del cierre.",
  },
  sin_cita: {
    titulo: "Hablamos, pero no llegaron a cita",
    detalle: "Leads contactados que se cerraron como «no interesado» sin haber llegado a una primera visita.",
  },
  presupuesto_perdido: {
    titulo: "Presupuestos que se perdieron",
    detalle: "Pasaron a «perdido» en la ventana y siguen perdidos hoy: el importe es el del presupuesto.",
  },
  cobro_vencido: {
    titulo: "Cobros que vencieron sin pagarse",
    detalle: "Tratamientos firmados cuyo plazo de pago se superó en la ventana y siguen pendientes.",
  },
};

export const HREF_ETAPA: Record<EtapaFuga, string> = {
  sin_contacto: "/tablas/leads",
  sin_cita: "/tablas/leads",
  presupuesto_perdido: "/tablas/presupuestos",
  cobro_vencido: "/tablas/cobros?urgencia=vencido",
};

export const MOTIVO_COBRO_NO_COMPARABLE =
  "Los cobros que vencieron antes han tenido más tiempo para pagarse: comparar ventanas no diría nada.";
