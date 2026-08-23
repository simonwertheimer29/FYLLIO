// app/lib/db/types.ts
// El tipo Kysely del esquema REAL. Es el que importa la aplicación.
//
// ─── Cómo está partido, y por qué ───────────────────────────────────────────
//
// El grueso lo genera `scripts/db-schema-spec.mjs` en `types-generado.ts`, desde
// la misma fuente que 001_esquema_negocio.sql y 002_rls.sql: SQL y tipos no
// pueden divergir.
//
// Pero el generador **solo conoce las migraciones 001 y 002**. Todo lo que
// añadieron las posteriores —tablas nuevas y columnas sueltas— se escribe aquí,
// A MANO, y este archivo **el generador no lo escribe nunca**.
//
// Antes los dos eran el mismo archivo, y la trampa era ésta: regenerar borraba
// lo añadido a mano **en silencio**, sin que nada fallara hasta que alguien
// usaba una de esas tablas. La cabecera avisaba, que es la peor defensa que
// existe — funciona mientras alguien se acuerde de leerla. Ahora no hay nada que
// recordar: el generador escribe en otro archivo, así que no puede llevárselo.
//
// Lo que SÍ sigue haciendo falta: **al añadir una migración que crea una tabla o
// una columna, declararla abajo.** Eso lo comprueba `npm run qa:tipos`, que lee
// las migraciones y este archivo y compara. No es opcional: `sugerencias_categoria`
// (016) estuvo tres días sin tipo y nadie se enteró porque se usaba con `sql`
// crudo y un `any`.

import type { Generated } from "kysely";
import type {
  DBGenerado,
  Tabla_alertas_enviadas,
  Tabla_configuracion_automatizaciones,
  Tabla_pacientes,
  Tabla_presupuestos,
  Tabla_mensajes_whatsapp,
  Tabla_configuracion_waba,
  Tabla_cola_envios,
} from "./types-generado";

// Todo lo generado se reexporta desde aquí: quien importa tipos importa de
// `db/types` y no tiene que saber de esta partición.
export * from "./types-generado";

// ─── Tablas creadas por migraciones posteriores a la 002 ────────────────────

/** Alertas ocultas hasta una fecha. Solo posponer, nunca descartar (011). */
export interface Tabla_alertas_pospuestas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string;
  tipo_alerta: string;
  oculta_hasta: string;
  pospuesta_por: string;
  pospuesta_por_nombre: string | null;
  created_at: Generated<Date>;
}

/** Casos que la coordinadora ya miró hoy y decidió que no requieren acción (013).
 *  Dura un día; no cambia el estado del caso. */
export interface Tabla_seguimiento_vistos {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  tipo_caso: string;
  caso_id: string;
  dia: string;
  visto_por: string;
  visto_por_nombre: string | null;
  created_at: Generated<Date>;
}

/** Log append-only de eventos sobre la automatización de un caso (014):
 *  decisiones humanas y, desde la 020, aplazamientos del agente. No guarda
 *  estado: el estado se deriva y solo se combina con los eventos de aquí.
 *  Ver `lib/automatizacion/estado.ts`. */
export interface Tabla_eventos_automatizacion {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  /** 020 — `conversacion` usa el teléfono E.164 como `caso_id`: un
   *  aplazamiento puede ocurrir en un hilo que aún no tiene caso. */
  tipo_caso: "presupuesto" | "lead" | "cobro" | "conversacion";
  caso_id: string;
  /** `devuelto_al_agente` se RETIRÓ en la 022 (la derivación no se revierte);
   *  nunca tuvo filas. */
  evento:
    | "quiebre_reconocido"
    | "asumido"
    | "asumido_manual"
    | "mensaje_enviado"
    /** 020 — el agente anotó algo que no puede resolver y SIGUE. `motivo_texto`
     *  dice qué, citando al paciente. Pendiente ⇔ aplazado posterior al último
     *  resuelto de su clave. */
    | "aplazado"
    | "aplazado_resuelto"
    /** 022 — el agente entregó el caso a una persona. No se revierte: «en manos
     *  humanas» ⇔ EXISTS derivado/asumido/asumido_manual posterior al último
     *  cierre del caso. */
    | "derivado"
    /** 024 — los juicios del modelo sobre un turno evaluado. Payload en
     *  `evaluacion_json`; nada derivable se guarda. */
    | "evaluacion"
    /** 026 — una persona cierra el asunto derivado. UN botón para todas las
     *  causas: la causa ya está en el log. */
    | "resuelto_manual"
    /** 026 — suelta el asumido_manual («ya no es mío»). */
    | "soltado"
    /** 026 — sin contacto hasta `hasta`. Suspende agente Y cadencias. */
    | "espera_fijada"
    /** 026 — levanta la espera antes de la fecha. */
    | "espera_levantada";
  actor_id: string | null;
  actor_nombre: string | null;
  motivo_texto: string | null;
  /** Distancia de edición normalizada [0,1]. Se guarda la MEDIDA, no la
   *  categoría: el umbral se calibra después sin perder el histórico. */
  distancia_edicion: number | null;
  largo_sugerido: number | null;
  /** Intención EN EL MOMENTO del envío (015). No se resuelve después: el
   *  clasificador la reescribe y el histórico cambiaría de significado. */
  intencion: string | null;
  /** 021 — clave de taxonomía cerrada del aplazamiento
   *  (`lib/automatizacion/aplazamientos.ts`). Obligatoria en
   *  aplazado/aplazado_resuelto, NULL en el resto (constraint). */
  clave_aplazado:
    | "precio_descuento"
    | "plan_pago"
    | "cobertura_seguro"
    | "cambio_tratamiento"
    | "garantia_condiciones"
    | "dato_presupuesto"
    | "agenda_disponibilidad"
    | "duda_clinica"
    | "otro"
    | null;
  /** 022/023 — por qué el agente entregó el caso. Obligatoria en `derivado`,
   *  NULL en el resto. La COLA no se persiste: prioritaria ⇔ urgencia ∨
   *  antecedente_medico ∨ (peticion_queja ∧ malestar). */
  causa_derivacion:
    | "peticion_queja"
    | "insistencia"
    | "urgencia"
    | "caso_completo"
    | "antecedente_medico"
    | null;
  /** 022 — juicio del modelo al derivar por peticion_queja (¿hay malestar?).
   *  Se guarda el hecho, no la cola, para recalibrar sin perder histórico. */
  malestar: boolean | null;
  /** 024 — solo en evento='evaluacion': los juicios del turno (JSON-string,
   *  forma en lib/agente/persistir-turno.ts). */
  evaluacion_json: string | null;
  /** 024 — waba_message_id del mensaje evaluado. Con el índice parcial único
   *  hace imposible que una doble entrega duplique aplazados. */
  mensaje_id: string | null;
  /** 026 — solo en evento='derivado': qué perseguía el agente al entregar.
   *  Hecho del turno, no derivable después; decide qué hecho del sistema
   *  cierra el asunto (lib/automatizacion/semaforo.ts). NULL pre-026 y en
   *  derivaciones sin objetivo abierto. */
  objetivo_activo: "identificar" | "cita" | "presupuesto" | "cobro" | null;
  /** 026 — solo en evento='espera_fijada': sin contacto hasta esta fecha
   *  (día de clínica, inclusive). Al vencer solo se levanta la pausa. */
  hasta: Date | null;
  created_at: Generated<Date>;
}

/** Categorías que el clasificador propuso en lenguaje natural y que NO están en
 *  el catálogo (016). Se acumulan con su cuenta y un ejemplo real; entrar en el
 *  enum es decisión de una persona, nunca automática. */
export interface Tabla_sugerencias_categoria {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  /** Minúsculas y sin acentos: «Pide Factura» y «pide factura» son la misma. */
  texto_norm: string;
  /** El primero que se vio, tal cual, para poder enseñarlo sin inventar. */
  texto: string;
  veces: Generated<number>;
  primera_vez: Generated<Date>;
  ultima_vez: Generated<Date>;
  estado: Generated<"pendiente" | "aceptada" | "descartada">;
  /** Mensaje real que la provocó: sin él, una etiqueta suelta no se puede juzgar. */
  ejemplo: string | null;
  created_at: Generated<Date>;
}

// ─── Columnas añadidas por migraciones posteriores a tablas que SÍ genera ───
//
// Van como intersección en el mapa `DB` de abajo, no editando la interfaz
// generada — que se reescribe entera en la próxima regeneración.

/** 011 y 012 — foto del momento del envío, para poder responder «¿sirvió el aviso?». */
type ExtraAlertasEnviadas = {
  n_al_enviar: number | null;
  importe_al_enviar: string | number | null;
  coordinadora_destino_nombre: string | null;
};

/** 010 — privado o el nombre de su aseguradora; null = sin tipo (estado válido). */
type ExtraPacientes = {
  tipo_paciente: string | null;
};

/** 014 — cuántos toques antes de dar la cadencia por agotada.
 *  020 — `objetivos`: definición de «caso listo» por etapa, JSON-string con la
 *  forma de `lib/automatizacion/objetivos.ts` (valida al leer, cae al default
 *  del código si no lo entiende). NULL = valores por defecto. */
type ExtraConfiguracionAutomatizaciones = {
  toques_antes_de_agotar: number | null;
  objetivos: string | null;
  /** 025 — interruptor del evaluador por clínica. Default false (apagado);
   *  sin fila = apagado; se lee con evaluadorActivo(), fail-closed. */
  evaluador_activo: boolean | null;
  /** 028 — fase D grupo 2: lo PUBLICADO por la clínica (JSON
   *  ConocimientoClinica). NULL = nada publicado (el agente aplaza todo).
   *  Se valida SIEMPRE con parseConocimiento — ilegible LANZA. */
  conocimiento: string | null;
  /** 029 — fase E: si coordinación puede usar el banco de pruebas. Default
   *  true; sin fila = true; admin puede siempre. */
  pruebas_coordinacion: boolean | null;
};

/** 029 — fase E: contador diario del banco de pruebas, por clínica. La ÚNICA
 *  tabla que el banco escribe (regla dura: nada de producción se toca). */
export interface Tabla_uso_banco_pruebas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string;
  dia: Date;
  turnos: number;
}

/** 016 — el rediseño «decisión primero»: la decisión se guarda aparte de la
 *  categoría, porque son dos preguntas distintas y mezclarlas fue lo que dejó el
 *  clasificador en el 56 %. Las tres estuvieron sin tipo hasta que las encontró
 *  `qa:tipos`, y se leían con un `any` en `presupuestos/pg.ts`. */
type ExtraPresupuestos = {
  /** La decisión: ¿esto lo contesta el sistema o tiene que verlo una persona? */
  requiere_persona: boolean | null;
  /** Por qué quiebra, en lenguaje de coordinadora. */
  motivo_quiebre: string | null;
  /** Categoría que el modelo propuso y que NO está en el catálogo. Aquí se
   *  guarda tal cual; el recuento vive en `sugerencias_categoria`. */
  intencion_propuesta: string | null;
};

/** 018 — los cimientos de Mensajería. `autor` y `sugerido_por_ia` son dos
 *  preguntas distintas: quién pulsó enviar, y de dónde salió el texto. En modo A
 *  el agente escribe y la persona manda, así que hace falta el segundo para
 *  poder responder «qué ha estado diciendo el agente» sin esperar al modo B. */
type ExtraMensajesWhatsApp = {
  autor: "persona" | "agente" | "cadencia" | null;
  sugerido_por_ia: boolean | null;
  /** Nombre de perfil de WhatsApp. Último recurso antes de enseñar un número. */
  nombre_perfil: string | null;
  /** 019 — clínica del mensaje, escrita al recibirlo o enviarlo. NULL NO
   *  significa «todas»: significa «todavía no se sabe», y la bandeja lo trata
   *  como tal (no se enseña a quien tiene acceso limitado). */
  clinica_id: string | null;
};

/** 019 — el número de WhatsApp de esta clínica, para saber a qué clínica llega
 *  un mensaje sin depender de que el remitente esté fichado. */
type ExtraConfiguracionWaba = {
  phone_number_id: string | null;
};

/** 027 — la cola única de envíos (B6): `origen` es el filtro por tipo de la
 *  pantalla; `cita_id`/`lead_id`, la referencia de los orígenes que no son un
 *  presupuesto. `estado` se redeclara entero (no intersección: una intersección
 *  de uniones no puede AÑADIR 'Caducado') — Caducado = la cola es del día y
 *  nadie lo envió; Cancelado = una persona decidió no enviarlo. */
type ExtraColaEnvios = {
  origen: "seguimiento_presupuesto" | "recordatorio_cita" | "reactivacion";
  cita_id: string | null;
  lead_id: string | null;
  estado: "Pendiente" | "Enviado" | "Fallido" | "Cancelado" | "Caducado" | null;
};

// ─── El esquema real ────────────────────────────────────────────────────────

export interface DB
  extends Omit<
    DBGenerado,
    | "alertas_enviadas"
    | "pacientes"
    | "configuracion_automatizaciones"
    | "presupuestos"
    | "mensajes_whatsapp"
    | "configuracion_waba"
    | "cola_envios"
  > {
  // Generadas, con columnas añadidas después.
  alertas_enviadas: Tabla_alertas_enviadas & ExtraAlertasEnviadas;
  pacientes: Tabla_pacientes & ExtraPacientes;
  configuracion_automatizaciones: Tabla_configuracion_automatizaciones &
    ExtraConfiguracionAutomatizaciones;
  presupuestos: Tabla_presupuestos & ExtraPresupuestos;
  mensajes_whatsapp: Tabla_mensajes_whatsapp & ExtraMensajesWhatsApp;
  configuracion_waba: Tabla_configuracion_waba & ExtraConfiguracionWaba;
  cola_envios: Omit<Tabla_cola_envios, "estado"> & ExtraColaEnvios;

  // Creadas después.
  alertas_pospuestas: Tabla_alertas_pospuestas;
  uso_banco_pruebas: Tabla_uso_banco_pruebas;
  seguimiento_vistos: Tabla_seguimiento_vistos;
  eventos_automatizacion: Tabla_eventos_automatizacion;
  sugerencias_categoria: Tabla_sugerencias_categoria;
}
