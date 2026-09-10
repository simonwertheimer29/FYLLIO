"use client";

// «VER POR QUÉ» — el inspector de decisiones de un turno (plan maestro 2.8,
// MEJORAS 183). Vive en la columna lateral de Mensajería (regla del 11-08:
// todo contexto va a la lateral) y sustituye a la ficha mientras está
// abierto; en móvil, flotante sin oscurecer (§4 ter: el hilo es el contexto
// de lo que se lee aquí). Enseña SOLO lo persistido: nada se recalcula con
// modelo. El orden es el de lo que decide antes: qué entendió, qué recogió,
// qué anotó, qué decidió, el control, el borrador — y lo técnico plegado.

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { X, Sparkles, AlertTriangle, CheckCircle2, Repeat, Flag, ICON_STROKE } from "../icons";
import { fechaClinica, horaClinica } from "../../lib/time";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import {
  FALLOS_CANDIDATO,
  FALLOS_CON_TEXTO_OBLIGATORIO,
  TOPE_CORRECCION,
  ETIQUETA_ESTADO_CANDIDATO,
  etiquetaFallo,
  motivoCorreccionInvalida,
  type CandidatoMarcado,
  type FalloCandidato,
} from "../../lib/agente/candidatos-eval.tipos";
import { ETIQUETA_CLAVE, type ClaveAplazado } from "../../lib/automatizacion/aplazamientos";
import { legibleCampo } from "./FichaCasoPanel";
import { ETIQUETA_TEMA, ETIQUETA_CAUSA, ETIQUETA_MOTIVO_JUEZ, Bloque, Tag } from "./etiquetas-agente";
import type { TurnoExplicado } from "../../lib/agente/por-que";

const ETIQUETA_IDIOMA: Record<string, string> = {
  ca: "escribe en catalán",
  en: "escribe en inglés",
  otro: "escribe en otro idioma",
};

const s = (n: number) => (n === 1 ? "" : "s");

/** Titular y fecha del turno: los pinta este panel en escritorio y el cascarón
 *  común en la hoja móvil (MEJORAS 216). */
export function cabeceraPorQue(turno: { en: string }) {
  return {
    titulo: (
      <>
        <Sparkles size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-accent)]" aria-hidden />
        Por qué hizo esto el agente
      </>
    ),
    subtitulo: `${fechaClinica(turno.en, { diaSemana: true })} · ${horaClinica(new Date(turno.en))}`,
  };
}

export function PorQuePanel({
  turno,
  telefono,
  onCerrar,
  sinCabecera = false,
  onMarcado,
}: {
  turno: TurnoExplicado;
  telefono: string;
  onCerrar: () => void;
  /** En la hoja móvil la cabecera la pinta el cascarón común (`cabeceraPorQue`). */
  sinCabecera?: boolean;
  /** 2.7: tras guardar «se equivocó aquí», recargar los turnos para enseñar la marca. */
  onMarcado: () => void;
}) {
  const j = turno.juicio;
  const t = turno.tecnico;
  // Sin entrante en el hilo no hay nada que reproducir (el mensaje no está).
  const banco = turno.entranteId
    ? `/agentes/conversacional?replay=${encodeURIComponent(telefono)}&hasta=${encodeURIComponent(turno.clave)}`
    : null;
  const conSenal = j && (j.urgenciaMedica || j.peticionOQueja || j.mencionaAntecedenteMedico || j.pideNoContacto || (j.idioma != null && j.idioma !== "es"));

  return (
    <div className="flex h-full flex-col">
      {!sinCabecera && (
        <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-display text-[14px] font-semibold text-[var(--color-foreground)]">{cabeceraPorQue(turno).titulo}</p>
            <p className="mt-0.5 text-[11.5px] tabular-nums text-[var(--color-muted)]">{cabeceraPorQue(turno).subtitulo}</p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-foreground)]">
        {turno.sinJuicio ? (
          <Bloque titulo="Qué entendió">
            No pudo leer el mensaje (un audio, una foto o un documento): no contesta ni inventa — lo entrega a una persona.
          </Bloque>
        ) : j ? (
          <Bloque titulo="Qué entendió">
            Habla de {ETIQUETA_TEMA[j.tema] ?? j.tema}
            {conSenal && (
              <span className="mt-1 block">
                {j.urgenciaMedica && <Tag tono="danger">urgencia médica</Tag>}
                {j.peticionOQueja && <Tag tono="danger">{j.malestar ? "queja con malestar" : "pide persona"}</Tag>}
                {j.mencionaAntecedenteMedico && <Tag tono="warning">antecedente médico</Tag>}
                {j.pideNoContacto && <Tag tono="warning">pide que no le escriban</Tag>}
                {j.idioma != null && j.idioma !== "es" && <Tag tono="neutro">{ETIQUETA_IDIOMA[j.idioma] ?? j.idioma}</Tag>}
              </span>
            )}
            {j.vuelveSobreAplazado && (
              <span className="mt-1 block text-[var(--color-muted)]">
                Vuelve sobre algo ya anotado: {ETIQUETA_CLAVE[j.vuelveSobreAplazado as ClaveAplazado] ?? j.vuelveSobreAplazado}.
              </span>
            )}
            {j.hiloTruncado && (
              <span className="mt-1 block text-[var(--color-muted)]">
                Solo vio el final de la conversación: puede faltarle algo que la persona ya dijo.
              </span>
            )}
          </Bloque>
        ) : (
          <Bloque titulo="Qué entendió">
            <span className="text-[var(--color-muted)]">De este turno no quedó juicio guardado.</span>
          </Bloque>
        )}

        {turno.recogidos.length > 0 && (
          <Bloque titulo="Qué recogió en este mensaje">
            {turno.recogidos.map((r) => (
              <div key={r.objetivo} className="mt-1.5 first:mt-0">
                <p className="text-[11px] font-medium text-[var(--color-muted)]">Para {ETIQUETA_TEMA[r.objetivo] ?? r.objetivo}</p>
                <dl className="space-y-0.5">
                  {r.campos.map((c) => (
                    <div key={c.clave} className="flex items-baseline justify-between gap-2">
                      <dt className="text-[11.5px] text-[var(--color-muted)]">{legibleCampo(c.clave)}</dt>
                      <dd className="text-right text-[12px] font-medium">{c.valor}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </Bloque>
        )}

        {turno.aplazados.length > 0 && (
          <Bloque titulo="Qué anotó para tu equipo">
            {turno.aplazados.map((a, i) => (
              <span key={i} className="block">
                · {ETIQUETA_CLAVE[a.clave as ClaveAplazado] ?? a.clave}
                {a.motivo ? ` — ${a.motivo}` : ""}
              </span>
            ))}
          </Bloque>
        )}

        <Bloque titulo="Qué decidió">
          {turno.entrega ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <AlertTriangle size={13} strokeWidth={ICON_STROKE} className="text-[var(--color-danger)]" aria-hidden />
              Pasó el caso a tu equipo — {ETIQUETA_CAUSA[turno.entrega.causa] ?? turno.entrega.causa}
              {turno.entrega.cola === "prioritaria" && <Tag tono="danger">prioritario</Tag>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 size={13} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" aria-hidden />
              Siguió la conversación él
            </span>
          )}
          {turno.entrega?.motivo && <span className="mt-1 block text-[var(--color-muted)]">{turno.entrega.motivo}</span>}
          {turno.espera.fijadaHasta && (
            <span className="mt-1 block">La persona pidió tiempo: sin contacto proactivo hasta el {fechaClinica(turno.espera.fijadaHasta)}.</span>
          )}
          {turno.espera.levantada && <span className="mt-1 block">Se levantó la espera: {turno.espera.levantada}.</span>}
        </Bloque>

        {(turno.descarte || turno.etiquetasDescartadas.length > 0) && (
          <Bloque titulo="El control de seguridad">
            {turno.descarte && (
              <span className="block text-[var(--color-danger)]">
                Descartó el borrador del agente porque {ETIQUETA_MOTIVO_JUEZ[turno.descarte.motivo] ?? "infringía una regla"}
                {turno.descarte.frase ? ` («${turno.descarte.frase}»)` : ""}. Respondió con la fórmula segura.
              </span>
            )}
            {turno.etiquetasDescartadas.length > 0 && (
              <span className="block text-[var(--color-muted)]">
                {turno.etiquetasDescartadas.length} etiqueta{s(turno.etiquetasDescartadas.length)} del modelo fuera de vocabulario, descartada
                {s(turno.etiquetasDescartadas.length)} en el borde: {turno.etiquetasDescartadas.join(", ")}.
              </span>
            )}
          </Bloque>
        )}

        {turno.borrador && (
          <Bloque titulo={turno.salienteId ? "Lo que propuso (y una persona envió)" : "Lo que propuso, sin llegar a enviarse"}>
            <p className="whitespace-pre-wrap text-[12px] text-[var(--color-muted)]">{turno.borrador}</p>
          </Bloque>
        )}

        {/* Lo técnico, plegado: versión (168), modelo, latencia, coste, señales
            y lo que vio el modelo (169). Existe para poder atribuir un juicio a
            una versión; no es lo que lee la coordinadora primero. */}
        <details className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[11.5px] text-[var(--color-muted)]">
          <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide">Detalles técnicos</summary>
          <dl className="mt-1.5 space-y-0.5 tabular-nums">
            <Fila k="Modelo" v={t.modelo ?? "sin dato"} />
            <Fila k="Tardó" v={t.latenciaMs != null ? `${t.latenciaMs} ms` : "sin dato"} />
            <Fila k="Costó" v={t.costeUsd != null ? `${t.costeUsd.toFixed(4)} $` : "sin dato"} />
            {t.version ? (
              <>
                <Fila k="Versión del evaluador" v={t.version.evaluador} />
                <Fila k="Versión del control" v={t.version.juez} />
                <Fila k="Conocimiento" v={t.version.conocimiento ?? "ninguno publicado"} />
                <Fila k="Objetivos" v={t.version.objetivos ?? "ninguno abierto"} />
              </>
            ) : t.sembrado ? (
              // Hilos jugados (10-09): el segundo testigo. Un turno sembrado por
              // el seed no tiene versión porque nadie lo juzgó; decirlo evita
              // leer una traza inventada como si fuera del agente.
              <Fila k="Versión" v="sembrado: este turno no lo juzgó el agente" />
            ) : (
              <Fila k="Versión" v="anterior al registro de versiones" />
            )}
            {t.senales && (
              <>
                <Fila k="Desde el último mensaje nuestro" v={t.senales.minutosDesdeUltimoSaliente != null ? `${t.senales.minutosDesdeUltimoSaliente} min` : "ninguno"} />
                <Fila k="Nuestros sin respuesta antes" v={String(t.senales.salientesSinRespuestaAntes)} />
                <Fila k="Hora local" v={`${t.senales.horaLocal}${t.senales.enHorario ? "" : " (fuera de horario)"}`} />
              </>
            )}
          </dl>
          {t.entrada && (
            <>
              <p className="mt-2 text-[10px] font-medium uppercase tracking-wide">Lo que vio el modelo</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 text-[11px] leading-snug text-[var(--color-foreground)]">
                {t.entrada}
              </pre>
            </>
          )}
        </details>
      </div>

      {/* Las dos acciones sobre el turno: marcarlo como error (2.7) y
          reproducirlo en el banco. El formulario crece aquí, así que el pie
          scrollea si hace falta en vez de aplastar la lectura de arriba. */}
      <div className="max-h-[70%] shrink-0 space-y-3 overflow-y-auto border-t border-[var(--color-border)] px-4 py-3">
        <CorreccionDelTurno key={turno.clave} turno={turno} telefono={telefono} onMarcado={onMarcado} />
        {banco && (
          <div>
            <Link
              href={banco}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <Repeat size={14} strokeWidth={ICON_STROKE} aria-hidden />
              Reproducir en el banco de pruebas
            </Link>
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-muted)]">
              Vuelve a pasar este mensaje por el agente con la configuración de hoy, sin tocar la conversación real. Gasta un mensaje de prueba.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// «EL AGENTE SE EQUIVOCÓ AQUÍ» (plan maestro 2.7, MEJORAS 182). La persona
// dice qué falló —en sus palabras, código cerrado por debajo— y qué debería
// haber hecho; el servidor copia lo persistido del turno y lo guarda como
// caso candidato, que una persona revisa antes de que entre en la vara. Va
// con `key={turno.clave}`: el estado del formulario es de ESTE turno y se
// reinicia al cambiar de turno sin un efecto (lint: set-state-in-effect).
function CorreccionDelTurno({
  turno,
  telefono,
  onMarcado,
}: {
  turno: TurnoExplicado;
  telefono: string;
  onMarcado: () => void;
}) {
  const marcado = turno.correccion ?? null;
  const decision = turno.entrega ? "entrego" : "siguio";
  const [editando, setEditando] = useState(false);
  const [fallo, setFallo] = useState<FalloCandidato | null>(null);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Solo las opciones que tienen sentido en este turno: sin borrador no se
  // puede corregir el borrador; sin datos recogidos, tampoco un dato.
  const opciones = FALLOS_CANDIDATO.filter(
    (f) => (f !== "borrador" || turno.borrador != null) && (f !== "recogida" || turno.recogidos.length > 0),
  );
  const textoObligatorio = fallo != null && FALLOS_CON_TEXTO_OBLIGATORIO.has(fallo);
  const motivoInvalido = fallo != null ? motivoCorreccionInvalida(fallo, texto) : null;

  const abrir = () => {
    setFallo(marcado?.fallo ?? null);
    setTexto(marcado?.correccion ?? "");
    setEditando(true);
  };

  const guardar = async () => {
    if (fallo == null || motivoInvalido) return;
    setGuardando(true);
    try {
      await cargarJSON<{ marcado: CandidatoMarcado }>("/api/agente/candidatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, clave: turno.clave, fallo, correccion: texto.trim() || null }),
      });
      toast.success("Guardado. Una persona lo revisa antes de cambiar nada en el agente.");
      setEditando(false);
      onMarcado();
    } catch (e) {
      toast.error(`No se pudo guardar. ${mensajeDeError(e)}`);
    } finally {
      setGuardando(false);
    }
  };

  if (!editando && marcado) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[12px] text-[var(--color-foreground)]">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          <Flag size={11} strokeWidth={ICON_STROKE} aria-hidden />
          Marcado como error del agente
        </p>
        <p className="mt-1 font-medium">{etiquetaFallo(marcado.fallo, decision)}</p>
        {marcado.correccion && <p className="mt-0.5 whitespace-pre-wrap text-[var(--color-muted)]">{marcado.correccion}</p>}
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          {marcado.porNombre ?? "Alguien del equipo"} · {fechaClinica(marcado.en)} · {ETIQUETA_ESTADO_CANDIDATO[marcado.estado]}
        </p>
        <button type="button" onClick={abrir} className="mt-1.5 text-[12px] font-medium text-[var(--color-accent)] hover:underline">
          Cambiar
        </button>
      </div>
    );
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)]"
      >
        <Flag size={14} strokeWidth={ICON_STROKE} aria-hidden />
        El agente se equivocó aquí
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void guardar();
      }}
      className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[var(--color-foreground)]"
    >
      <fieldset>
        <legend className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">¿Qué falló?</legend>
        <div className="mt-1.5 space-y-1.5">
          {opciones.map((f) => (
            <label key={f} className="flex cursor-pointer items-start gap-2 text-[12.5px] leading-snug">
              <input
                type="radio"
                name={`fallo-${turno.clave}`}
                value={f}
                checked={fallo === f}
                onChange={() => setFallo(f)}
                className="mt-0.5 shrink-0 accent-[var(--color-accent)]"
              />
              <span>{etiquetaFallo(f, decision)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-2.5 block text-[11px] font-medium text-[var(--color-muted)]">
        ¿Qué debería haber hecho o dicho?{textoObligatorio ? "" : " (opcional)"}
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          maxLength={TOPE_CORRECCION}
          className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12.5px] font-normal text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </label>
      {motivoInvalido && texto.trim() === "" && textoObligatorio ? (
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">{motivoInvalido}</p>
      ) : (
        <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">Sirve para que el agente mejore. Una persona lo revisa antes de cambiar nada.</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={guardando || fallo == null || motivoInvalido != null}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => setEditando(false)}
          disabled={guardando}
          className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt>{k}</dt>
      <dd className="text-right font-medium text-[var(--color-foreground)]">{v}</dd>
    </div>
  );
}
