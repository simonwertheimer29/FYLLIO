// app/lib/llamadas/types.ts
//
// Sprint 17 Bloque 2 — tipos del dominio Llamadas_Vapi.

export type TipoLlamada =
  | "confirmacion_cita"
  | "reactivacion"
  | "recuperacion_presupuesto";

export type EstadoLlamada =
  | "pendiente"
  | "iniciada"
  | "en_curso"
  | "completada"
  | "fallida"
  | "cancelada";

export type ResultadoLlamada =
  | "confirmada"
  | "reagenda_solicitada"
  | "cancelada"
  | "no_contesta"
  | "escalado_humano"
  | "sin_resultado";

export type Llamada = {
  id: string;
  citaId: string | null;
  pacienteId: string;
  tipo: TipoLlamada;
  vapiCallId: string | null;
  estado: EstadoLlamada;
  resultado: ResultadoLlamada;
  iniciadaAt: string;
  finalizadaAt: string | null;
  duracionSegundos: number | null;
  notas: string | null;
  transcripcion: string | null;
  costeUSD: number | null;
  createdAt: string;
  updatedAt: string;
};
