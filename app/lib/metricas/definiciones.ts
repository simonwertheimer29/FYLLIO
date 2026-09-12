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
  "podas_juez",
  "modelo_latencia_mediana_ms",
  // 2.5 (MEJORAS 180): cuánto tarda una PERSONA en contestar lo que el agente
  // entrega, por cola. La métrica #1 del plan ofensivo: la única que detecta
  // que el agente haga daño (una promesa al paciente que nadie cumple).
  "respuesta_humana_prioritaria_min",
  "respuesta_humana_normal_min",
  // 2.4 (MEJORAS 185): de los envíos del equipo que salían de un borrador del
  // agente, cuántos salieron TAL CUAL (valor) sobre los medidos (n). Es el
  // disparador declarado del paso de modo A a modo B, y en la serie se puede
  // comparar antes/después de cada cambio de configuración.
  "envios_tal_cual",
] as const;
export type Metrica = (typeof METRICAS_V1)[number];
export type ValorMetrica = { valor: number; n: number };
export type DiaCalculado = Partial<Record<Metrica, ValorMetrica>>;

/** Por debajo de esto una mediana no es una mediana y se dice en pantalla
 *  (antes/después la declara «no comparable»; Inicio avisa «pocos casos»). */
export const N_MIN_MEDIANA = 5;

/** Mediana ponderada por n de varias medianas (varios días, varias sedes):
 *  NO es la mediana del conjunto, y quien la pinta lo dice. null sin casos. */
export function medianaPonderada(puntos: ReadonlyArray<{ valor: number; n: number }>): { valor: number | null; n: number } {
  const n = puntos.reduce((s, p) => s + Number(p.n), 0);
  if (n <= 0) return { valor: null, n: 0 };
  const valor = puntos.reduce((s, p) => s + Number(p.valor) * Number(p.n), 0) / n;
  return { valor: Math.round(valor * 10) / 10, n };
}

/** Cómo se agrega una métrica sobre varios días (2.6, antes/después): las
 *  cuentas y los euros se SUMAN; las medianas diarias se promedian ponderando
 *  por su n (no es la mediana del periodo, y se dice así en pantalla). */
export type Agregacion = "suma" | "mediana_ponderada";
export const AGREGACION: Record<Metrica, Agregacion> = {
  tiempo_respuesta_mediana_min: "mediana_ponderada",
  modelo_latencia_mediana_ms: "mediana_ponderada",
  respuesta_humana_prioritaria_min: "mediana_ponderada",
  respuesta_humana_normal_min: "mediana_ponderada",
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
  podas_juez: "suma",
  envios_tal_cual: "suma",
};

export type Unidad = "n" | "eur" | "min" | "ms" | "usd";
export const UNIDAD: Record<Metrica, Unidad> = {
  tiempo_respuesta_mediana_min: "min",
  modelo_latencia_mediana_ms: "ms",
  respuesta_humana_prioritaria_min: "min",
  respuesta_humana_normal_min: "min",
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
  podas_juez: "n",
  envios_tal_cual: "n",
};

/** Qué dirección es «mejor» al comparar. `neutro` = informativa, no se colorea. */
export type Sentido = "mas_mejor" | "menos_mejor" | "neutro";
export const SENTIDO: Record<Metrica, Sentido> = {
  tiempo_respuesta_mediana_min: "menos_mejor",
  modelo_latencia_mediana_ms: "menos_mejor",
  respuesta_humana_prioritaria_min: "menos_mejor",
  respuesta_humana_normal_min: "menos_mejor",
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
  podas_juez: "neutro",
  envios_tal_cual: "mas_mejor",
};

export const ETIQUETA_METRICA: Record<Metrica, string> = {
  tiempo_respuesta_mediana_min: "Tiempo de respuesta (mediana, min laborables)",
  entrantes: "Mensajes entrantes",
  salientes: "Mensajes salientes",
  salientes_del_agente: "Mensajes redactados por el agente",
  leads_nuevos: "Leads nuevos",
  leads_citados: "Leads citados",
  leads_convertidos: "Leads convertidos",
  presupuestos_presentados_n: "Presupuestos presentados",
  presupuestos_presentados_eur: "Presupuestos presentados (€)",
  aceptados_n: "Presupuestos aceptados",
  aceptados_eur: "Presupuestos aceptados (€)",
  perdidos_n: "Presupuestos perdidos",
  pagos_eur: "Pagos cobrados (€)",
  evaluaciones: "Mensajes atendidos por el agente",
  derivaciones: "Derivaciones a persona",
  derivaciones_caso_completo: "Derivaciones con todos los datos",
  aplazados: "Preguntas pendientes para la clínica",
  coste_usd: "Coste del agente ($)",
  modelo_errores: "Fallos del agente",
  descartes_juez: "Mensajes descartados por la revisión de seguridad",
  podas_juez: "Frases quitadas por la revisión de seguridad (el mensaje sí salió)",
  modelo_latencia_mediana_ms: "Tiempo de respuesta del agente (mediana, ms)",
  respuesta_humana_prioritaria_min: "Respuesta de una persona a lo que entrega el agente · atención inmediata (mediana, min laborables)",
  respuesta_humana_normal_min: "Respuesta de una persona a lo que entrega el agente · atención normal (mediana, min laborables)",
  envios_tal_cual: "Borradores del agente enviados tal cual por el equipo",
};
