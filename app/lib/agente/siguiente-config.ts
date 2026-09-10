// app/lib/agente/siguiente-config.ts
//
// SIGUIENTE CONFIGURACIÓN (plan maestro 2.3, MEJORAS 178): lo que el agente
// aplazó en la ventana —los aplazados por tema de «Qué dicen», con sus frases—
// cruzado con lo que la clínica tiene publicado: «14 conversaciones se
// atascaron en la forma de pago: publica cómo se puede pagar». Puro: sin base
// ni modelo; lo llama la pantalla de Configuración con lo que ya tiene.
//
// Honestidad (§4): no todo aplazado lo arregla una configuración. Lo que va
// al doctor, lo que decide cada caso y el dato que el sistema aún no guarda
// (MEJORAS 89: IVA y validez del presupuesto) se dicen tal cual, sin botón.

import { ETIQUETA_CLAVE, NATURALEZA_DE_CLAVE, type ClaveAplazado } from "../automatizacion/aplazamientos";
import type { ConocimientoClinica } from "./conocimiento";
import type { Cubo } from "../metricas/conversacion.tipos";

export type SeccionConfig = "politicas" | "tratamientos" | "agenda" | "horario";

export type Recomendacion = {
  clave: ClaveAplazado | "otro";
  etiqueta: string;
  /** Conversaciones que se atascaron en este tema en la ventana. */
  n: number;
  ejemplos: string[];
  /** Qué hacer. `null` = ninguna configuración lo cambia (y se dice por qué en `porque`). */
  accion: string | null;
  porque: string | null;
  /** A qué sección de Configuración lleva la acción. */
  seccion: SeccionConfig | null;
  /** Ya está publicado: si sigue aplazándose, el texto no contesta a lo que preguntan. */
  cubierto: boolean;
};

const hayPolitica = (c: ConocimientoClinica, re: RegExp) => c.politicas.some((p) => re.test(`${p.titulo} ${p.texto}`.toLowerCase()));

type Regla = (c: ConocimientoClinica) => { cubierto: boolean; accion: string; siCubierto: string; seccion: SeccionConfig } | { porque: string };

const REGLAS: Record<ClaveAplazado | "otro", Regla> = {
  plan_pago: (c) => ({
    cubierto: hayPolitica(c, /pago|financi|plazo|cuota|señal/),
    accion: "Publica cómo se puede pagar (financiación, plazos, señal): el agente lo contestará tal cual",
    siCubierto: "Ya publicas una política de pago; si sigue aplazándose, revísala con estas frases delante",
    seccion: "politicas",
  }),
  cobertura_seguro: (c) => ({
    cubierto: hayPolitica(c, /segur|mutua|asegurador|cobertura/),
    accion: "Publica con qué aseguradoras trabajáis y qué suelen cubrir (la cobertura de cada persona la confirma tu equipo)",
    siCubierto: "Ya publicas con qué aseguradoras trabajáis; si sigue aplazándose, añade qué suelen cubrir",
    seccion: "politicas",
  }),
  garantia_condiciones: (c) => ({
    cubierto: hayPolitica(c, /garant|condicion|revisi/),
    accion: "Publica las garantías y condiciones (qué incluye, revisiones, duración)",
    siCubierto: "Ya publicas garantías y condiciones; si sigue aplazándose, revísalas con estas frases delante",
    seccion: "politicas",
  }),
  precio_descuento: (c) => ({
    cubierto: hayPolitica(c, /descuento|oferta|promoci|rebaja/),
    accion: "Publica tu política de descuentos y promociones —aunque sea «no hacemos»—: así el agente contesta en vez de aplazar",
    siCubierto: "Ya publicas una política de descuentos; si sigue aplazándose, revísala con estas frases delante",
    seccion: "politicas",
  }),
  agenda_disponibilidad: (c) => ({
    cubierto: c.agendaNivel === 2,
    accion: "Conecta tu agenda (solo lectura): el agente informará de los huecos y tu equipo seguirá reservando",
    siCubierto: "Tu agenda está conectada; si sigue aplazándose, comprueba que la conexión lee bien",
    seccion: "agenda",
  }),
  dato_cita: (c) => ({
    cubierto: c.agendaNivel === 2,
    accion: "Conecta tu agenda (solo lectura): el agente verá el día y la hora de la cita de cada persona",
    siCubierto: "Tu agenda está conectada; si sigue aplazándose, comprueba que la conexión lee bien",
    seccion: "agenda",
  }),
  dato_presupuesto: () => ({ porque: "Preguntan datos del presupuesto (si el importe lleva IVA, hasta cuándo vale) que el sistema todavía no guarda: hoy lo resuelve tu equipo" }),
  cambio_tratamiento: () => ({ porque: "Cambiar un tratamiento lo decide el doctor con cada caso: ninguna configuración lo cambia" }),
  duda_clinica: () => ({ porque: "Las dudas clínicas van siempre al doctor: límite del producto" }),
  otro: () => ({ porque: "Sin tema fijo: léelas y, si se repiten, publica la respuesta como política" }),
};

/** Ordena por lo que más se atasca y se puede arreglar: primero lo accionable sin cubrir, luego lo cubierto, al final lo que no cambia ninguna configuración. */
export function siguienteConfig(preguntas: readonly Cubo[], c: ConocimientoClinica): Recomendacion[] {
  const out: Recomendacion[] = [];
  for (const cubo of preguntas) {
    if (cubo.n <= 0) continue;
    const clave = (cubo.clave in REGLAS ? cubo.clave : "otro") as ClaveAplazado | "otro";
    const r = REGLAS[clave](c);
    const etiqueta = clave === "otro" ? "Otro" : ETIQUETA_CLAVE[clave];
    if ("porque" in r) {
      out.push({ clave, etiqueta, n: cubo.n, ejemplos: cubo.ejemplos, accion: null, porque: r.porque, seccion: null, cubierto: false });
    } else {
      out.push({ clave, etiqueta, n: cubo.n, ejemplos: cubo.ejemplos, accion: r.cubierto ? r.siCubierto : r.accion, porque: null, seccion: r.seccion, cubierto: r.cubierto });
    }
  }
  const rango = (x: Recomendacion) => (x.accion == null ? 2 : x.cubierto ? 1 : 0);
  return out.sort((a, b) => rango(a) - rango(b) || b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

/** La naturaleza, para quien quiera agrupar: «decision» se arregla publicando una política; «dato_ausente», conectando una fuente. */
export const NATURALEZA = NATURALEZA_DE_CLAVE;
