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
    nombre: "GOOGLE_SERVICE_ACCOUNT_JSON",
    rompe:
      "La lectura de agendas externas (nivel 2, Google Calendar): las conectadas dejan de refrescarse y lo dicen.",
    nivel: "funcional",
  },
  {
    nombre: "WABA_PHONE_NUMBER_ID",
    rompe: "El envío de WhatsApp: falta el número emisor.",
    nivel: "funcional",
  },
  // El portal del paciente vive en KV y NO estaba declarado aquí: por eso nadie
  // se enteró de que el store al que apuntaban las variables ya no existía
  // (DNS ENOTFOUND, 2026-07-29). Es la única pantalla que ve un cliente de
  // nuestro cliente, y sin KV el enlace no se puede ni generar ni abrir.
  //
  // Con PREFIJO `FYLLIO_`, que es lo que Vercel exige en este proyecto. El
  // singleton de `@vercel/kv` lee los nombres sin prefijo, así que el cliente se
  // construye en `lib/kv` — el único sitio del código que conoce estos nombres.
  // Los `KV_REST_*` sin prefijo NO se leen en ningún sitio: un fallback "una u
  // otra" es un camino que funciona en un entorno y no en el otro.
  {
    nombre: "FYLLIO_KV_REST_API_URL",
    rompe: "El portal del paciente: no se puede generar ni abrir un enlace de presupuesto.",
    nivel: "funcional",
  },
  {
    nombre: "FYLLIO_KV_REST_API_TOKEN",
    rompe: "El portal del paciente: falta la credencial del almacén de enlaces.",
    nivel: "funcional",
  },

  // Las llamadas de voz (Vapi) tampoco estaban declaradas, y es el MISMO
  // agujero que dejó el portal del paciente sin avisar: /llamadas se veía como
  // una pantalla en marcha —doce llamadas con su duración, su resultado y su
  // coste— mientras cualquier intento de llamar moría en "VAPI_API_KEY no
  // configurada". Declararlo es lo que hace que la pantalla pueda DECIRLO
  // (`llamadasOperativas()`), en vez de que se descubra pulsando un botón.
  // Es una integración pendiente de activar, no algo averiado: por eso es
  // funcional y no crítica, y por eso el registro histórico se sigue viendo.
  {
    nombre: "VAPI_API_KEY",
    rompe: "Las llamadas de voz con IA: no se puede iniciar ninguna. El registro de las anteriores se sigue viendo.",
    nivel: "funcional",
  },
  {
    nombre: "VAPI_PHONE_NUMBER_ID",
    rompe: "Las llamadas de voz con IA: falta el número desde el que se llama.",
    nivel: "funcional",
  },
];

/** ¿Se pueden iniciar llamadas de voz? Lo consultan la UI y la ruta de
 *  reintento para no prometer lo que el entorno no puede cumplir. */
export function llamadasOperativas(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VAPI_API_KEY?.trim() && env.VAPI_PHONE_NUMBER_ID?.trim());
}

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
