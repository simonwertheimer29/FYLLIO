// app/lib/metricas/definiciones.ts
//
// LAS DEFINICIONES DE LAS MÉTRICAS, PURAS: ni base de datos, ni Node, ni
// nada que no pueda viajar al navegador. Un Client Component (Analíticas ›
// Antes y después) las necesita para etiquetar, formatear y colorear; si las
// importara de `diarias.ts` arrastraría `db/context` → `pg` entero al bundle de
// cliente y el build de Vercel muere con «Can't resolve 'dns'» (pasó el 7-sep
// con a583fb1, y el 6-sep con be26b8e por el mismo motivo en Inicio).
//
// Regla (lección §22 + §24 del skill de ingeniería): lo que un componente de
// cliente necesita de un módulo de servidor se saca a un módulo PURO como
// este, y `qa:frontera` comprueba que ningún "use client" alcance servidor.

export const DEFINICION_V = 1;

export const METRICAS_V1 = [
  "tiempo_respuesta_mediana_min",
  "entrantes",
  "salientes",
  "salientes_del_agente",
  "leads_nuevos",
  "leads_citados",
  "leads_convertidos",
  "presupuestos_presentados_n",
  "presupuestos_presentados_eur",
  "aceptados_n",
  "aceptados_eur",
  "perdidos_n",
  "pagos_eur",
  "evaluaciones",
  "derivaciones",
  "derivaciones_caso_completo",
  "aplazados",
  "coste_usd",
  "modelo_errores",
  "descartes_juez",
  "modelo_latencia_mediana_ms",
] as const;
export type Metrica = (typeof METRICAS_V1)[number];
export type ValorMetrica = { valor: number; n: number };
export type DiaCalculado = Partial<Record<Metrica, ValorMetrica>>;

/** Cómo se agrega una métrica sobre varios días (2.6, antes/después): las
 *  cuentas y los euros se SUMAN; las medianas diarias se promedian ponderando
 *  por su n (no es la mediana del periodo, y se dice así en pantalla). */
export type Agregacion = "suma" | "mediana_ponderada";
export const AGREGACION: Record<Metrica, Agregacion> = {
  tiempo_respuesta_mediana_min: "mediana_ponderada",
  modelo_latencia_mediana_ms: "mediana_ponderada",
  entrantes: "suma",
  salientes: "suma",
  salientes_del_agente: "suma",
  leads_nuevos: "suma",
  leads_citados: "suma",
  leads_convertidos: "suma",
  presupuestos_presentados_n: "suma",
  presupuestos_presentados_eur: "suma",
  aceptados_n: "suma",
  aceptados_eur: "suma",
  perdidos_n: "suma",
  pagos_eur: "suma",
  evaluaciones: "suma",
  derivaciones: "suma",
  derivaciones_caso_completo: "suma",
  aplazados: "suma",
  coste_usd: "suma",
  modelo_errores: "suma",
  descartes_juez: "suma",
};

export type Unidad = "n" | "eur" | "min" | "ms" | "usd";
export const UNIDAD: Record<Metrica, Unidad> = {
  tiempo_respuesta_mediana_min: "min",
  modelo_latencia_mediana_ms: "ms",
  presupuestos_presentados_eur: "eur",
  aceptados_eur: "eur",
  pagos_eur: "eur",
  coste_usd: "usd",
  entrantes: "n",
  salientes: "n",
  salientes_del_agente: "n",
  leads_nuevos: "n",
  leads_citados: "n",
  leads_convertidos: "n",
  presupuestos_presentados_n: "n",
  aceptados_n: "n",
  perdidos_n: "n",
  evaluaciones: "n",
  derivaciones: "n",
  derivaciones_caso_completo: "n",
  aplazados: "n",
  modelo_errores: "n",
  descartes_juez: "n",
};

/** Qué dirección es «mejor» al comparar. `neutro` = informativa, no se colorea. */
export type Sentido = "mas_mejor" | "menos_mejor" | "neutro";
export const SENTIDO: Record<Metrica, Sentido> = {
  tiempo_respuesta_mediana_min: "menos_mejor",
  modelo_latencia_mediana_ms: "menos_mejor",
  perdidos_n: "menos_mejor",
  modelo_errores: "menos_mejor",
  coste_usd: "menos_mejor",
  leads_nuevos: "mas_mejor",
  leads_citados: "mas_mejor",
  leads_convertidos: "mas_mejor",
  presupuestos_presentados_n: "mas_mejor",
  presupuestos_presentados_eur: "mas_mejor",
  aceptados_n: "mas_mejor",
  aceptados_eur: "mas_mejor",
  pagos_eur: "mas_mejor",
  entrantes: "neutro",
  salientes: "neutro",
  salientes_del_agente: "neutro",
  evaluaciones: "neutro",
  derivaciones: "neutro",
  derivaciones_caso_completo: "neutro",
  aplazados: "neutro",
  descartes_juez: "neutro",
};

export const ETIQUETA_METRICA: Record<Metrica, string> = {
  tiempo_respuesta_mediana_min: "Tiempo de respuesta (mediana, min laborables)",
  entrantes: "Mensajes entrantes",
  salientes: "Mensajes salientes",
  salientes_del_agente: "Salientes redactados por el agente",
  leads_nuevos: "Leads nuevos",
  leads_citados: "Leads citados",
  leads_convertidos: "Leads convertidos",
  presupuestos_presentados_n: "Presupuestos presentados",
  presupuestos_presentados_eur: "Presupuestos presentados (€)",
  aceptados_n: "Presupuestos aceptados",
  aceptados_eur: "Presupuestos aceptados (€)",
  perdidos_n: "Presupuestos perdidos",
  pagos_eur: "Pagos cobrados (€)",
  evaluaciones: "Turnos evaluados por el agente",
  derivaciones: "Derivaciones a persona",
  derivaciones_caso_completo: "Derivaciones con el caso completo",
  aplazados: "Aplazados",
  coste_usd: "Coste del modelo ($)",
  modelo_errores: "Errores del modelo",
  descartes_juez: "Borradores descartados por el juez",
  modelo_latencia_mediana_ms: "Latencia del modelo (mediana, ms)",
};
