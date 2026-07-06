// app/lib/pagos-format.ts
//
// Sprint B — exports PUROS de pagos (tipos + helpers de formato), SIN dependencia
// de Airtable. Se separan de pagos.ts para que los componentes cliente (p.ej.
// Paciente360View) puedan importar `formatTipo` sin arrastrar la capa de datos
// (airtable.ts → node:async_hooks) al bundle del navegador. pagos.ts re-exporta
// todo esto, así que el código de servidor lo sigue importando desde pagos.ts.

/**
 * Método de pago. Union de valores conocidos (hint de autocompletado) + string
 * libre, porque es configurable por clínica (Configuraciones_Clinica.Metodos_Pago).
 */
export type MetodoPago =
  | "Efectivo"
  | "Tarjeta"
  | "Transferencia"
  | "Bizum"
  | "Financiacion"
  | "Otro"
  | (string & {});

/** Tipo de pago como hito comercial (Señal / Primer pago de plan / Liquidación). */
export type TipoPago = "Senal" | "Primer_Pago_Plan" | "Liquidacion";

/** Opciones válidas para validación en endpoints/UI. */
export const TIPOS_PAGO: TipoPago[] = ["Senal", "Primer_Pago_Plan", "Liquidacion"];
export const METODOS_PAGO: MetodoPago[] = [
  "Efectivo",
  "Tarjeta",
  "Transferencia",
  "Bizum",
  "Financiacion",
  "Otro",
];

/** Label legible para TipoPago. Resuelve también valores legacy pre-migración. */
export function formatTipo(tipo: string): string {
  switch (tipo) {
    case "Senal":
      return "Señal";
    case "Primer_Pago_Plan":
      return "Primer pago de plan";
    case "Liquidacion":
      return "Liquidación";
    case "Pago_Unico":
      return "Pago único";
    case "Cuota":
      return "Cuota";
    default:
      return tipo;
  }
}

export type Pago = {
  id: string;
  pacienteId: string;
  fechaPago: string; // ISO date YYYY-MM-DD
  importe: number;
  metodo: MetodoPago;
  tipo: TipoPago;
  nota: string | null;
  createdAt: string; // ISO datetime
  /** id del Usuario Fyllio que registró el pago; null para pagos migrados. */
  usuarioCreadorId: string | null;
};
