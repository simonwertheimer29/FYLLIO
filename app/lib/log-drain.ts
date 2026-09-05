// app/lib/log-drain.ts
//
// EL ENVÍO DE LOGS FUERA DE VERCEL (plan maestro fase 0.4, MEJORAS 162). Vercel
// Hobby retiene los logs un día y no ofrece drains: los 265 `console.error`
// del código no los podría leer nadie cuando RB dijera «el martes contestó
// mal». Aquí se envuelven `console.error` y `console.warn` UNA vez, al
// arrancar (instrumentation.ts), y cada línea viaja además a un destino HTTP
// (Axiom, Better Stack o cualquier ingesta que acepte un array JSON con
// Bearer). Sin `LOG_DRAIN_URL` no hace nada: inerte hasta que Simon cree el
// destino — declarado en lib/entorno como capacidad funcional.
//
// Reglas: NUNCA lanza, NUNCA bloquea, NUNCA se llama a sí mismo (un fallo del
// envío no produce otro log). Los errores salen en el acto con `keepalive`
// (en serverless la función puede congelarse tras la respuesta: un lote
// diferido se perdería); los warns se agrupan.

type Linea = {
  _time: string;
  nivel: "error" | "warn";
  mensaje: string;
  entorno: string | null;
  region: string | null;
  despliegue: string | null;
};

const TOPE_MENSAJE = 4000;
const TOPE_LOTE = 20;
const ESPERA_MS = 1500;

function formatear(x: unknown): string {
  if (x instanceof Error) {
    const pila = (x.stack ?? "").split("\n").slice(1, 5).join("\n");
    return `${x.name}: ${x.message}${pila ? `\n${pila}` : ""}`;
  }
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

let instalado = false;

/** Devuelve el host del destino si quedó instalado; null si no hay destino. */
export function instalarLogDrain(): string | null {
  if (instalado) return null;
  const url = process.env.LOG_DRAIN_URL;
  if (!url) return null;
  const token = process.env.LOG_DRAIN_TOKEN;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null; // una URL rota no puede instalar nada — y no se avisa aquí, se vería en entorno
  }
  instalado = true;

  const cola: Linea[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const enviar = (lote: Linea[]) => {
    if (lote.length === 0) return;
    try {
      void fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(lote),
        keepalive: true,
        signal: AbortSignal.timeout(3000),
      }).catch(() => {
        /* el drain nunca produce otro log */
      });
    } catch {
      /* idem */
    }
  };
  const vaciar = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    enviar(cola.splice(0, cola.length));
  };
  const programar = () => {
    if (timer) return;
    timer = setTimeout(vaciar, ESPERA_MS);
    (timer as { unref?: () => void }).unref?.();
  };

  const envolver = (nivel: "error" | "warn") => {
    const original = console[nivel].bind(console);
    console[nivel] = (...args: unknown[]) => {
      original(...args);
      try {
        cola.push({
          _time: new Date().toISOString(),
          nivel,
          mensaje: args.map(formatear).join(" ").slice(0, TOPE_MENSAJE),
          entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
          region: process.env.VERCEL_REGION ?? null,
          despliegue: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        });
        if (nivel === "error" || cola.length >= TOPE_LOTE) vaciar();
        else programar();
      } catch {
        /* nunca */
      }
    };
  };
  envolver("error");
  envolver("warn");
  return host;
}
