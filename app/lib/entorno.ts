// app/lib/entorno.ts
//
// EL CONTRATO DE ENTORNO. Una sola declaración de qué necesita Fyllio para
// funcionar y qué se rompe sin cada cosa.
//
// Existe por lo que pasó el 2026-07-29: `AIRTABLE_API_KEY` y `AIRTABLE_BASE_ID`
// se retiraron de Vercel al eliminar Airtable, trece archivos decidían su
// comportamiento con ellas, y el producto **degradó en silencio durante
// semanas** — seis escrituras confirmando éxito sin escribir, el motor de
// automatizaciones muerto, la cola de intervención vacía con 28 casos reales.
// En local todo funcionaba porque las variables seguían en `.env.local`.
//
// La regla que queda: **el entorno se declara y se comprueba al arrancar**. Si
// falta algo crítico, el arranque falla con un mensaje que dice qué falta y qué
// deja de funcionar. Nunca se degrada en silencio.

export type Requisito = {
  /** Nombre de la variable. */
  nombre: string;
  /** Qué deja de funcionar si no está. En lenguaje de producto, no de infra. */
  rompe: string;
  /** `critica`: sin esto la app no puede arrancar honestamente.
   *  `funcional`: la app arranca, pero una capacidad concreta no existe y hay
   *  que saberlo — nunca se descubre por una pantalla vacía. */
  nivel: "critica" | "funcional";
  /** Solo se exige en producción (en local se trabaja sin ella a propósito).
   *  Un contrato que grita en falso en el portátil de todos los días acaba
   *  ignorado, y entonces no avisa cuando importa. */
  soloEnProduccion?: boolean;
};

// NOTA (2026-07-29): la primera versión de este contrato incluía
// DATA_BACKEND_PG_CLIENTES y DATA_BACKEND_PG_DOMINIOS como críticas. La propia
// herramienta de verificación las delató: la app funcionaba perfectamente sin
// ellas. Eran los interruptores de la migración Airtable→Postgres y hoy solo
// las usan scripts de QA antiguos, que se las ponen ellos mismos. Fuera.

export const CONTRATO: Requisito[] = [
  {
    nombre: "SUPABASE_DB_URL_APP",
    rompe: "Todo: es la conexión a la base de datos del producto.",
    nivel: "critica",
  },
  {
    nombre: "AUTH_SECRET",
    rompe: "El login y toda la autenticación: nadie puede entrar.",
    nivel: "critica",
  },
  {
    nombre: "CRON_SECRET",
    rompe: "Los crons quedan abiertos o bloqueados (§3): recordatorios y automatizaciones.",
    nivel: "critica",
    soloEnProduccion: true,
  },
  {
    nombre: "ANTHROPIC_API_KEY",
    rompe: "El Copilot y la clasificación de intención de los mensajes.",
    nivel: "funcional",
  },
  {
    nombre: "META_WHATSAPP_TOKEN",
    rompe: "El envío de WhatsApp: los mensajes no salen.",
    nivel: "funcional",
  },
  {
    nombre: "WABA_PHONE_NUMBER_ID",
    rompe: "El envío de WhatsApp: falta el número emisor.",
    nivel: "funcional",
  },
];

export type EstadoEntorno = {
  ok: boolean;
  faltanCriticas: Requisito[];
  faltanFuncionales: Requisito[];
};

export function revisarEntorno(env: NodeJS.ProcessEnv = process.env): EstadoEntorno {
  const enProduccion = env.NODE_ENV === "production";
  const falta = (r: Requisito) =>
    (!r.soloEnProduccion || enProduccion) && (!env[r.nombre] || env[r.nombre]!.trim() === "");
  const faltanCriticas = CONTRATO.filter((r) => r.nivel === "critica" && falta(r));
  const faltanFuncionales = CONTRATO.filter((r) => r.nivel === "funcional" && falta(r));
  return { ok: faltanCriticas.length === 0, faltanCriticas, faltanFuncionales };
}

/** Mensaje para humanos: qué falta y qué deja de funcionar. */
export function informeEntorno(estado: EstadoEntorno): string {
  const linea = (r: Requisito) => `  · ${r.nombre} — ${r.rompe}`;
  const partes: string[] = [];
  if (estado.faltanCriticas.length > 0) {
    partes.push("FALTAN VARIABLES CRÍTICAS:", ...estado.faltanCriticas.map(linea));
  }
  if (estado.faltanFuncionales.length > 0) {
    partes.push("Capacidades desactivadas por falta de configuración:", ...estado.faltanFuncionales.map(linea));
  }
  return partes.join("\n");
}
