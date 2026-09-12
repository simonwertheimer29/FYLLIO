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
    nombre: "RETENCION_CONVERSACIONES_DIAS",
    rompe:
      "La caducidad de conversaciones por plazo (MEJORAS 147): sin plazo declarado el cron de retención no borra nada. El plazo lo fija la consulta legal; hasta entonces solo existe el borrado por petición (derecho de supresión).",
    nivel: "funcional",
  },
  {
    nombre: "LOG_DRAIN_URL",
    rompe:
      "El envío de logs fuera de Vercel (MEJORAS 162): los errores de producción solo viven un día en la consola de Vercel y «el martes contestó mal» no se puede investigar. Ingesta HTTP con array JSON (Axiom, Better Stack…); LOG_DRAIN_TOKEN opcional como Bearer.",
    nivel: "funcional",
  },
  {
    nombre: "QSTASH_TOKEN",
    rompe:
      "La cola de trabajos (MEJORAS 164): sin ella cada turno del agente corre dentro de after() del webhook, sin reintento — el que muere por timeout solo lo recupera el barrido (163). Con el token hacen falta también QSTASH_CURRENT_SIGNING_KEY (y NEXT) y una URL pública: COLA_URL_BASE, o la de producción que Vercel expone.",
    nivel: "funcional",
  },
  {
    nombre: "QSTASH_CURRENT_SIGNING_KEY",
    rompe:
      "La verificación de firma de /api/cola/*: sin ella la ruta rechaza TODO (fail-closed) y cada trabajo de la cola acaba en incidencias como reintentos agotados.",
    nivel: "funcional",
  },
  {
    nombre: "GOOGLE_SERVICE_ACCOUNT_JSON",
    rompe:
      "La lectura de agendas externas (nivel 2, Google Calendar): las conectadas dejan de refrescarse y lo dicen.",
    nivel: "funcional",
  },
  // ─── WhatsApp (WABA de Meta) ──────────────────────────────────────────────
  //
  // El canal ENTERO, entrada y salida, y hasta hoy el contrato declaraba una
  // variable que no se usa (`META_WHATSAPP_TOKEN`, que solo lee
  // `lib/whatsapp/outbound.ts`, un módulo muerto que se borra en este mismo
  // cambio) y ninguna de las que deciden de verdad. El guard `qa:sin-fallbacks`
  // lo cazó al quitarla: o la variable está declarada, o el código que decide
  // con ella no existe. Consecuencia: el día que caduque el token de
  // Meta —el de pruebas dura 24 h— `/api/salud` seguiría diciendo que todo va
  // bien mientras cada envío devuelve 401. Es exactamente el agujero del
  // portal del paciente y el de las llamadas de voz, por tercera vez.
  //
  // `soloEnProduccion` en todas: en el portátil no llega ningún webhook de
  // Meta ni se envía nada real, y un contrato que grita en falso todos los
  // días acaba ignorado justo cuando importa.
  {
    nombre: "WABA_PHONE_NUMBER_ID",
    rompe:
      "WhatsApp entero: sin el número de la clínica no sale ningún mensaje, y los que entran se descartan porque no se reconocen como nuestros.",
    nivel: "funcional",
    soloEnProduccion: true,
  },
  {
    nombre: "WABA_ACCESS_TOKEN",
    rompe:
      "El envío por WhatsApp: la bandeja da error al enviar. Es el que CADUCA (el token de pruebas de Meta, a las 24 h), así que su ausencia es lo más probable que rompa el canal un día cualquiera.",
    nivel: "funcional",
    soloEnProduccion: true,
  },
  {
    nombre: "WABA_VERIFY_TOKEN",
    rompe:
      "El alta del webhook en Meta: sin él no se puede dar de alta ni volver a verificar la conexión, y Meta la desactiva si deja de responder.",
    nivel: "funcional",
    soloEnProduccion: true,
  },
  {
    nombre: "META_APP_SECRET",
    rompe:
      "La recepción de WhatsApp: sin él el webhook rechaza TODO lo que llega (fail-closed, no se salta la firma ni en desarrollo). Los mensajes de los pacientes no entran.",
    nivel: "funcional",
    soloEnProduccion: true,
  },
  {
    nombre: "WABA_BUSINESS_ACCOUNT_ID",
    rompe:
      "La recepción y el envío: hoy no se usa para llamar a Meta, pero el webhook exige las cinco credenciales juntas y sin ella responde 503 a todo.",
    nivel: "funcional",
    soloEnProduccion: true,
  },
  {
    nombre: "WABA_ENABLED",
    rompe:
      "El proceso de lo que entra. Es el peor de todos porque NO parece roto: si no vale exactamente «true», el webhook acepta cada mensaje con un 200, Meta lo da por entregado, y no se guarda ni se contesta nada.",
    nivel: "funcional",
    soloEnProduccion: true,
  },
  {
    nombre: "WABA_CLIENTE",
    rompe:
      "El destino de lo que entra: sin declarar de qué cliente es el número, los mensajes se ignoran (fail-closed) en vez de caer en un cliente equivocado.",
    nivel: "funcional",
    soloEnProduccion: true,
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
