"use client";

// «VER POR QUÉ» — el inspector de decisiones de un turno (plan maestro 2.8,
// MEJORAS 183). Vive en la columna lateral de Mensajería (regla del 11-08:
// todo contexto va a la lateral) y sustituye a la ficha mientras está
// abierto; en móvil, flotante sin oscurecer (§4 ter: el hilo es el contexto
// de lo que se lee aquí). Enseña SOLO lo persistido: nada se recalcula con
// modelo. El orden es el de lo que decide antes: qué entendió, qué recogió,
// qué anotó, qué decidió, el control, el borrador — y lo técnico plegado.

import Link from "next/link";
import { X, Sparkles, AlertTriangle, CheckCircle2, Repeat, ICON_STROKE } from "../icons";
import { fechaClinica, horaClinica } from "../../lib/time";
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

export function PorQuePanel({
  turno,
  telefono,
  onCerrar,
}: {
  turno: TurnoExplicado;
  telefono: string;
  onCerrar: () => void;
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
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-display text-[14px] font-semibold text-[var(--color-foreground)]">
            <Sparkles size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-accent)]" aria-hidden />
            Por qué hizo esto el agente
          </p>
          <p className="mt-0.5 text-[11.5px] tabular-nums text-[var(--color-muted)]">
            {fechaClinica(turno.en, { diaSemana: true })} · {horaClinica(new Date(turno.en))}
          </p>
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

      {banco && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
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
