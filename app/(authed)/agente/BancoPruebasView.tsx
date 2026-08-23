"use client";

// FASE E — PONLO A PRUEBA: una conversación de mentira con el agente REAL de
// la clínica seleccionada. Escribes como si fueras un paciente; al lado se ve
// QUÉ HA HECHO POR DENTRO (qué entendió, qué persigue, qué anotó, qué
// decidió, y si el control descartó su borrador). Lo que impresiona no es
// que conteste bien: es que se vea que DECIDE.
//
// Nada de lo que pase aquí toca producción (regla dura, vigilada por
// qa:banco): el hilo vive en esta pantalla y muere con ella. Cada mensaje
// usa la configuración VIGENTE — ajustas en la pestaña de al lado y el
// siguiente mensaje ya responde con lo nuevo: ese es el ciclo.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../../components/ui/Feedback";
import {
  Sparkles,
  Send,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ICON_STROKE,
} from "../../components/icons";
import { ETIQUETA_CLAVE, type ClaveAplazado } from "../../lib/automatizacion/aplazamientos";
import { legibleCampo } from "../../components/agente/FichaCasoPanel";
import type { EvaluacionTurno } from "../../lib/agente/evaluador";
import type { EscenarioPrueba } from "../../lib/agente/banco-pruebas";

type Turno = {
  direccion: "Entrante" | "Saliente";
  contenido: string;
  /** Solo en las respuestas del agente. */
  evaluacion?: EvaluacionTurno;
};

const ESCENARIOS: Array<{ tipo: EscenarioPrueba["tipo"]; etiqueta: string; detalle: string }> = [
  { tipo: "lead_nuevo", etiqueta: "Lead nuevo", detalle: "Alguien que escribe por primera vez — el agente averigua quién es y busca la cita" },
  { tipo: "presupuesto", etiqueta: "Presupuesto pendiente", detalle: "Tiene un presupuesto sin decidir — el agente lo lleva a una decisión" },
  { tipo: "cobro", etiqueta: "Pago pendiente", detalle: "Debe un importe — el agente confirma que va a pagar, cómo y cuándo" },
  { tipo: "al_dia", etiqueta: "Paciente al día", detalle: "Sin nada abierto — el agente conversa sin perseguir nada" },
];

const ETIQUETA_TEMA: Record<string, string> = {
  cobro: "su pago pendiente",
  presupuesto: "su presupuesto",
  cita: "una cita",
  identificar: "quién es",
  otro: "otra cosa (logística, agradecimiento…)",
  ninguno: "no se entiende",
};

const ETIQUETA_CAUSA: Record<string, string> = {
  peticion_queja: "pidió una persona o se quejó",
  urgencia: "urgencia médica",
  insistencia: "insistió sobre algo aplazado",
  caso_completo: "caso completo — lo entrega listo",
  antecedente_medico: "mencionó un antecedente médico con cita próxima",
};

const ETIQUETA_MOTIVO_JUEZ: Record<string, string> = {
  clinica: "afirmaba algo clínico",
  economica: "comprometía dinero no decidido",
  datos_sensibles: "soltaba un dato de salud no pedido",
  promesa: "prometía algo que nadie iba a hacer",
  agenda: "afirmaba huecos que no ve, o se comprometía a reservar la cita",
  sin_categoria: "infringía una regla dura",
  juez_no_respondio: "el control no respondió (se descartó por seguridad)",
};

export function BancoPruebasView() {
  const { selectedClinicaId, clinicas } = useClinic();
  const [estado, setEstado] = useState<{ permitido: boolean; motivo?: string; usados?: number; tope?: number } | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [escenario, setEscenario] = useState<EscenarioPrueba>({ tipo: "lead_nuevo" });
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nombreClinica = clinicas.find((c) => c.id === selectedClinicaId)?.nombre ?? null;

  const cargarEstado = useCallback(async () => {
    if (!selectedClinicaId) return;
    setErrorEstado(null);
    try {
      const d = await cargarJSON<{ permitido: boolean; motivo?: string; usados?: number; tope?: number }>(
        `/api/agente/prueba?clinicaId=${encodeURIComponent(selectedClinicaId)}`,
      );
      setEstado(d);
    } catch (e) {
      setErrorEstado(mensajeDeError(e));
    }
  }, [selectedClinicaId]);

  useEffect(() => {
    setTurnos([]);
    setEstado(null);
    void cargarEstado();
  }, [cargarEstado]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turnos]);

  const derivadoPrevio = turnos.some((t) => t.evaluacion?.decision === "deriva");
  const ultimaEvaluacion = [...turnos].reverse().find((t) => t.evaluacion)?.evaluacion ?? null;
  // El panel enseña el último estado COMPLETO (23-08): tras derivar, un
  // mensaje más devolvía actuar:false y borraba lo recogido — justo cuando
  // el caso entregado ES el resultado de la prueba. El aviso va encima.
  const ultimaConContenido = [...turnos].reverse().find((t) => t.evaluacion?.actuar)?.evaluacion ?? null;

  async function enviar() {
    const mensaje = texto.trim();
    if (!mensaje || enviando || !selectedClinicaId) return;
    setEnviando(true);
    try {
      const r = await cargarJSON<{ evaluacion: EvaluacionTurno; usados: number; tope: number }>(
        "/api/agente/prueba",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinicaId: selectedClinicaId,
            escenario,
            hilo: turnos.map((t) => ({ direccion: t.direccion, contenido: t.contenido })),
            mensaje,
            derivadoPrevio,
          }),
        },
      );
      setTexto("");
      setTurnos((prev) => [
        ...prev,
        { direccion: "Entrante", contenido: mensaje },
        ...(r.evaluacion.actuar && r.evaluacion.respuesta.trim() !== ""
          ? [{ direccion: "Saliente" as const, contenido: r.evaluacion.respuesta, evaluacion: r.evaluacion }]
          : [{ direccion: "Saliente" as const, contenido: "", evaluacion: r.evaluacion }]),
      ]);
      setEstado((e) => (e ? { ...e, usados: r.usados, tope: r.tope } : e));
    } catch (e) {
      // El tope llega aquí con su motivo («has usado los 100…») — se enseña
      // tal cual, nunca un fallo mudo.
      toast.error(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  if (!selectedClinicaId) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center">
        <p className="text-[13.5px] font-semibold text-[var(--color-foreground)]">
          El banco prueba el agente DE una clínica
        </p>
        <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">
          Elige una en el selector de clínica de la cabecera — cada clínica tiene su configuración, y
          probar el agente genérico no prueba nada.
        </p>
      </div>
    );
  }
  if (errorEstado) {
    return <ErrorState detail={`El banco de pruebas no se pudo abrir. ${errorEstado}`} onRetry={cargarEstado} />;
  }
  if (estado && !estado.permitido) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-center">
        <p className="text-[13.5px] text-[var(--color-foreground)]">{estado.motivo}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── El escenario: la situación la eliges tú ─────────────────────── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">
            La situación de la persona que escribe
          </h2>
          {estado?.usados != null && (
            <span className="text-[11.5px] tabular-nums text-[var(--color-muted)]">
              {estado.usados} de {estado.tope} mensajes de prueba hoy
            </span>
          )}
        </div>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ESCENARIOS.map((e) => {
            const on = escenario.tipo === e.tipo;
            return (
              <button
                key={e.tipo}
                type="button"
                onClick={() => {
                  if (escenario.tipo !== e.tipo) {
                    setEscenario({ tipo: e.tipo });
                    setTurnos([]);
                  }
                }}
                aria-pressed={on}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  on
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                <span className="block text-[13px] font-semibold text-[var(--color-foreground)]">{e.etiqueta}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--color-muted)]">{e.detalle}</span>
              </button>
            );
          })}
        </div>
        {(escenario.tipo === "presupuesto" || escenario.tipo === "cobro") && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
            <span>Datos de mentira del escenario:</span>
            {escenario.tipo === "presupuesto" && (
              <>
                <input
                  value={escenario.tratamiento ?? ""}
                  onChange={(e) => setEscenario({ ...escenario, tratamiento: e.target.value || undefined })}
                  placeholder="Ortodoncia invisible"
                  className={INPUT + " w-48"}
                />
                <input
                  type="number"
                  value={escenario.importe ?? ""}
                  onChange={(e) => setEscenario({ ...escenario, importe: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="2400"
                  className={INPUT + " w-24 text-right tabular-nums"}
                />
                <span>€</span>
              </>
            )}
            {escenario.tipo === "cobro" && (
              <>
                <input
                  type="number"
                  value={escenario.deuda ?? ""}
                  onChange={(e) => setEscenario({ ...escenario, deuda: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="600"
                  className={INPUT + " w-24 text-right tabular-nums"}
                />
                <span>€ pendientes</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Chat a la izquierda, panel AL LADO desde md (22-08): el panel es lo
          que se mira MIENTRAS conversas — debajo queda fuera de vista justo
          cuando importa. Sticky: no se va con el scroll del hilo. */}
      {/* OJO sintaxis Tailwind: en valores arbitrarios el separador es `_`,
          no la coma — con coma el CSS salía inválido y el grid JAMÁS aplicó
          (el panel caía debajo en cualquier ancho; bug visto por Simon). */}
      <div className="grid gap-5 md:grid-cols-[1fr_minmax(26rem,34rem)]">
        {/* ── El chat de mentira ──────────────────────────────────────── */}
        <div className="flex min-h-[24rem] flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <p className="text-[12.5px] text-[var(--color-muted)]">
              Escribe como si fueras el paciente · agente de {nombreClinica ?? "la clínica"} · nada de esto
              toca los datos reales
            </p>
            {turnos.length > 0 && (
              <button
                type="button"
                onClick={() => setTurnos([])}
                className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                <RefreshCw size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Empezar de nuevo
              </button>
            )}
          </div>
          <div ref={scrollRef} className="max-h-[55vh] min-h-[16rem] flex-1 space-y-2 overflow-y-auto p-3">
            {turnos.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-[var(--color-muted)]">
                Prueba con «¿Cuánto cuesta una ortodoncia?», «Me duele muchísimo una muela» o
                «¿Trabajáis con Sanitas?» — y mira a la derecha lo que decide.
              </p>
            )}
            {turnos.map((t, i) =>
              t.direccion === "Entrante" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl rounded-br-sm bg-[var(--color-accent)] px-3 py-2 text-[13px] text-white">
                    {t.contenido}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  {t.evaluacion && !t.evaluacion.actuar ? (
                    <div className="max-w-[80%] rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2 text-[12.5px] italic text-[var(--color-muted)]">
                      El agente no contesta: el caso ya es de una persona (así funciona en producción — la
                      derivación no se revierte). Empieza de nuevo para seguir probando.
                    </div>
                  ) : (
                    <div className="max-w-[80%] rounded-xl rounded-bl-sm bg-[var(--color-surface-muted)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                      <span className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-[var(--color-accent)]">
                        <Sparkles size={11} strokeWidth={ICON_STROKE} aria-hidden />
                        Agente
                        {t.evaluacion?.decision === "deriva" && (
                          <span className="ml-1 rounded bg-[var(--color-danger-soft)] px-1 py-px text-[10px] font-semibold text-[var(--color-danger)]">
                            deriva
                          </span>
                        )}
                      </span>
                      {t.contenido}
                    </div>
                  )}
                </div>
              ),
            )}
            {enviando && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-[var(--color-surface-muted)] px-3 py-2 text-[12.5px] text-[var(--color-muted)]">
                  El agente está pensando…
                </div>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2 border-t border-[var(--color-border)] p-3">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              placeholder="Escribe como el paciente…"
              className={INPUT + " max-h-[120px] min-h-[44px] flex-1 resize-none"}
            />
            <button
              onClick={enviar}
              disabled={enviando || !texto.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Send size={14} strokeWidth={ICON_STROKE} aria-hidden />
              Enviar
            </button>
          </div>
        </div>

        {/* ── QUÉ HA HECHO POR DENTRO — lo que impresiona ─────────────── */}
        <aside className="self-start rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:sticky md:top-4">
          <h3 className="font-display text-[14px] font-semibold text-[var(--color-foreground)]">
            Qué ha hecho por dentro
          </h3>
          {ultimaEvaluacion && !ultimaEvaluacion.actuar && (
            <p className="mt-2 rounded-lg border border-dashed border-[var(--color-border)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--color-muted)]">
              El caso ya es de tu equipo: el agente no vuelve a entrar (la derivación no se
              revierte). Abajo, lo que dejó recogido — el resultado de la prueba.
            </p>
          )}
          {!ultimaConContenido ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              Con cada respuesta verás aquí qué entendió, qué persigue, qué anotó para tu equipo, qué
              decidió — y si el control de seguridad descartó su borrador.
            </p>
          ) : (
            <PorDentro ev={ultimaConContenido} />
          )}
          <p className="mt-3 border-t border-[var(--color-border)] pt-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
            Cada mensaje usa la configuración vigente: cambia algo en «Configuración» y el siguiente
            mensaje de esta misma conversación ya responde con lo nuevo.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Qué hará el agente en el SIGUIENTE mensaje — derivado de la evaluación,
 *  por código. Es lo que hace entender que el agente PERSIGUE algo, no que
 *  contesta: se ve que le faltan dos datos concretos y que va a por ellos. */
function siguientePaso(ev: EvaluacionTurno): string {
  if (ev.decision === "deriva") {
    return "Nada — el caso ya es de tu equipo. El agente no vuelve a entrar en esta conversación.";
  }
  if (ev.camposFaltantes.length > 0) {
    return `Ir a por «${legibleCampo(ev.camposFaltantes[0]).toLowerCase()}» — pregunta UN dato por mensaje, como una conversación, no como un formulario.`;
  }
  if (ev.aplazamientos.length > 0) {
    return "Esperar: lo anotado lo resuelve tu equipo, y el agente se lo dirá a la persona cuando conteste.";
  }
  return "Acompañar la conversación — no hay nada abierto que recoger.";
}

/** La evaluación del último turno, ESTRUCTURADA con la forma de la ficha del
 *  caso (22-08): bloques, no párrafo corrido. */
function PorDentro({ ev }: { ev: EvaluacionTurno }) {
  if (ev.fallback) {
    return (
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-danger)]">
        El agente no pudo evaluar este mensaje (fallo del modelo). En producción, el caso subiría a una
        persona — nunca se inventa una respuesta.
      </p>
    );
  }
  const j = ev.juicios;
  const activo = ev.objetivoActivo;
  const recogidos = activo ? Object.entries(ev.camposRecogidos[activo] ?? {}) : [];
  const conValor = recogidos.filter(([, v]) => v != null && v !== "no_aplica");
  return (
    <div className="mt-2.5 space-y-2.5 text-[12.5px] leading-relaxed text-[var(--color-foreground)]">
      <Bloque titulo="Qué persigue ahora">
        {activo ? `Completar ${ETIQUETA_TEMA[activo] ?? activo}` : "Nada — solo conversación"}
        {j && (j.urgenciaMedica || j.peticionOQueja || j.mencionaAntecedenteMedico) && (
          <span className="mt-1 block">
            {j.urgenciaMedica && <Tag tono="danger">urgencia médica</Tag>}
            {j.peticionOQueja && <Tag tono="danger">{j.malestar ? "queja con malestar" : "pide persona"}</Tag>}
            {j.mencionaAntecedenteMedico && <Tag tono="warning">antecedente médico</Tag>}
          </span>
        )}
      </Bloque>
      {conValor.length > 0 && (
        <Bloque titulo="Qué lleva recogido">
          <dl className="space-y-0.5">
            {conValor.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="text-[11.5px] text-[var(--color-muted)]">{legibleCampo(k)}</dt>
                <dd className="text-right text-[12px] font-medium">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </Bloque>
      )}
      {ev.camposFaltantes.length > 0 && (
        <Bloque titulo="Qué le falta">
          {ev.camposFaltantes.map((c) => (
            <span key={c} className="mr-1 inline-block rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[11.5px] text-[var(--color-muted)]">
              {legibleCampo(c)}
            </span>
          ))}
        </Bloque>
      )}
      {/* Lo que más vende: se ve que va A POR lo que falta. */}
      <div className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
          Qué va a hacer en el siguiente mensaje
        </p>
        <p className="mt-0.5 text-[12.5px]">{siguientePaso(ev)}</p>
      </div>
      {ev.aplazamientos.length > 0 && (
        <Bloque titulo="Qué anotó para tu equipo">
          {ev.aplazamientos.map((a, i) => (
            <span key={i} className="block">
              · {ETIQUETA_CLAVE[a.clave as ClaveAplazado] ?? a.clave} — «{a.motivo}»
            </span>
          ))}
        </Bloque>
      )}
      {ev.esperaHasta && (
        <Bloque titulo="Espera pactada">
          La persona pidió tiempo: sin contacto proactivo hasta el {ev.esperaHasta}.
        </Bloque>
      )}
      <Bloque titulo="Qué decidió">
        {ev.decision === "deriva" ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            <AlertTriangle size={13} strokeWidth={ICON_STROKE} className="text-[var(--color-danger)]" aria-hidden />
            Pasa el caso a tu equipo — {ev.causa ? ETIQUETA_CAUSA[ev.causa] ?? ev.causa : "derivado"}
            {ev.cola === "prioritaria" && <Tag tono="danger">prioritario</Tag>}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={13} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" aria-hidden />
            Sigue la conversación él
          </span>
        )}
      </Bloque>
      {ev.borradorDescartado && (
        <Bloque titulo="El control de seguridad actuó">
          <span className="text-[var(--color-danger)]">
            Descartó el borrador del agente porque {ETIQUETA_MOTIVO_JUEZ[ev.borradorDescartado.motivo] ?? "infringía una regla"}
            {ev.borradorDescartado.frase ? ` («${ev.borradorDescartado.frase}»)` : ""}.
          </span>{" "}
          Respondió con la fórmula segura — ese filtro revisa cada mensaje, también en producción.
        </Bloque>
      )}
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{titulo}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Tag({ tono, children }: { tono: "danger" | "warning"; children: React.ReactNode }) {
  const cls =
    tono === "danger"
      ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  return <span className={`ml-1 rounded px-1 py-px text-[10.5px] font-semibold ${cls}`}>{children}</span>;
}

const INPUT =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none";
