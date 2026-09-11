"use client";

// CÓMO DECIDE TU AGENTE — /agentes/conversacional › Confianza (plan
// maestro 2.4, MEJORAS 179/184/185). Regla A del estándar visual (9-sep):
// una línea explica; el matiz de cada dato va en tooltip y es prescindible.
//
// Dos fuentes que no se mezclan, y se dice: la VARA (sintética: casos escritos
// por nosotros y anotados a ciegas, medida sobre una versión concreta del
// prompt) y TUS CONVERSACIONES REALES (lo que el log persistido dice de cada
// sede en los últimos 30 días completos). Y el cierre del bucle: cuando el
// agente se equivoca, se marca desde «Ver por qué» (2.7) y entra en la
// revisión — así de bien decide, y así lo corriges cuando falla.
//
// Reglas de la pantalla: el denominador siempre a la vista; un conjunto vacío
// no es un 0 %; sin color donde no hay vara declarada (el umbral de modo B es
// provisional y se dice). Solo lo persistido: ni una llamada al modelo.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../ui/Feedback";
import { Gauge, ICON_STROKE } from "../icons";
import { ETIQUETA_CAUSA } from "./etiquetas-agente";
import { ETIQUETA_CLAVE } from "../../lib/automatizacion/aplazamientos";
import { ETIQUETA_COINCIDENCIA } from "../../lib/automatizacion/coincidencia";
import { pct, type ClinicaConfianza, type Confianza } from "../../lib/agente/confianza.tipos";
import { LineaModoB } from "./LineaModoB";

type Datos = Confianza & { esRed: boolean };

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fechaLarga = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const s = (n: number) => (n === 1 ? "" : "s");
const origenVara = (o: string) =>
  o === "sintetico"
    ? "Casos escritos por nosotros y anotados a ciegas; ninguno es una conversación tuya."
    : o === "real"
      ? "Casos reales."
      : "Casos reales y escritos por nosotros.";

/** «66 de 67 · 99 %» — la parte, el todo y la proporción, siempre juntos. */
function DeTotal({ parte, total, sinTotal = "—" }: { parte: number; total: number; sinTotal?: string }) {
  if (total === 0) return <span className="text-[var(--color-muted)]">{sinTotal}</span>;
  return (
    <>
      <b className="font-semibold text-[var(--color-foreground)]">{parte}</b>
      <span className="text-[var(--color-muted)]"> de {total} · </span>
      <b className="font-semibold text-[var(--color-foreground)]">{pct(parte, total)} %</b>
    </>
  );
}

function Cifra({ etiqueta, children, nota }: { etiqueta: string; children: React.ReactNode; nota?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-3.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">{etiqueta}</p>
      <p className="mt-0.5 font-display text-base font-bold tabular-nums text-[var(--color-foreground)]">{children}</p>
      {nota && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-muted)]">{nota}</p>}
    </div>
  );
}

/** Los tres primeros de un reparto, en palabras del producto. */
function top3(rec: Record<string, number>, etiquetas: Record<string, string>): string {
  const filas = Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!filas.length) return "";
  const resto = Object.keys(rec).length - filas.length;
  return filas.map(([k, n]) => `${etiquetas[k] ?? k} ×${n}`).join(" · ") + (resto > 0 ? ` · y ${resto} más` : "");
}

function FilaSede({ c, titulo, destacada = false }: { c: ClinicaConfianza; titulo: string; destacada?: boolean }) {
  const descartesPct = pct(c.descartes, c.turnos);
  const exigen = top3(c.exigenPersona, ETIQUETA_CAUSA);
  const aplazo = top3(c.aplazados, ETIQUETA_CLAVE as Record<string, string>);
  return (
    <tr className={`border-t border-[var(--color-border)] align-top ${destacada ? "bg-[var(--color-surface-muted)]" : ""}`}>
      <td className="py-2 pr-3">
        <p className="font-medium text-[var(--color-foreground)]">{titulo}</p>
        {exigen && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-muted)]">Sigue exigiendo persona: {exigen}</p>}
        {aplazo && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-muted)]">Dejó a la clínica: {aplazo}</p>}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-muted)]">{c.turnos}</td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        <DeTotal parte={c.entregasListas} total={c.entregas} sinTotal="sin entregas" />
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums whitespace-nowrap ${descartesPct != null && descartesPct >= 20 ? "text-[var(--color-danger)]" : ""}`}>
        <DeTotal parte={c.descartes} total={c.turnos} sinTotal="sin mensajes" />
      </td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        <DeTotal parte={c.coincidencia.talCual} total={c.coincidencia.total} sinTotal="sin envíos medidos" />
      </td>
      <td className="py-2 text-right tabular-nums whitespace-nowrap">
        {c.marcados.total === 0 ? (
          <span className="text-[var(--color-muted)]">ninguno</span>
        ) : (
          <>
            <b className="font-semibold text-[var(--color-foreground)]">{c.marcados.total}</b>
            {c.marcados.pendientes > 0 && <span className="text-[var(--color-muted)]"> · {c.marcados.pendientes} por revisar</span>}
          </>
        )}
      </td>
    </tr>
  );
}

export function ConfianzaAgentePanel() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const cargar = useCallback(() => setIntento((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    cargarJSON<Datos>("/api/agente/confianza")
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        setError(null);
      })
      .catch((e) => {
        if (vivo) setError(mensajeDeError(e));
      });
    return () => {
      vivo = false;
    };
  }, [intento]);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header className="mb-3">
        <p className="fyllio-label flex items-center gap-1.5 text-[var(--color-muted)]">
          <Gauge size={13} strokeWidth={ICON_STROKE} aria-hidden />
          Cómo decide tu agente
        </p>
        <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
          Las pruebas de calidad miden el agente con casos escritos por nosotros; debajo, tus conversaciones reales por sede. No se mezclan.
        </p>
      </header>

      {error ? (
        <ErrorState detail={`«Cómo decide tu agente» no se pudo leer. ${error}`} onRetry={cargar} />
      ) : !datos ? (
        <div className="space-y-3">
          <div className="fyllio-skeleton h-16" />
          <div className="fyllio-skeleton h-24" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── 1 · La vara ── */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]" title={datos.vara ? origenVara(datos.vara.pasada.origen) : undefined}>
              Pruebas de calidad
              {datos.vara && <> · {datos.vara.pasada.casos} casos · medida el {fechaLarga(datos.vara.pasada.fecha)}</>}
            </p>
            {!datos.vara ? (
              <p className="mt-1 text-[13px] text-[var(--color-muted)]">La última vez que se pasaron las pruebas de calidad no se pudo leer. Hasta que se vuelvan a pasar, aquí no hay número.</p>
            ) : (
              (() => {
                const p = datos.vara.pasada;
                return (
                  <>
                    <ul className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <li><Cifra etiqueta="Decide bien"><DeTotal parte={p.decision.aciertos} total={p.decision.total} /></Cifra></li>
                      <li>
                        <Cifra etiqueta="Entrega con todos los datos cuando toca">
                          {p.listo ? <DeTotal parte={p.listo.aciertos} total={p.listo.total} /> : <span className="text-[var(--color-muted)]">no medido</span>}
                        </Cifra>
                      </li>
                      <li><Cifra etiqueta="Mensajes descartados por la revisión de seguridad"><DeTotal parte={p.descartesJuez.n} total={p.descartesJuez.total} /></Cifra></li>
                      <li>
                        <Cifra etiqueta="Coste por mensaje atendido">
                          {p.costePorTurnoUsd == null ? <span className="text-[var(--color-muted)]">sin medir</span> : `${p.costePorTurnoUsd.toFixed(3)} $`}
                        </Cifra>
                      </li>
                    </ul>
                    {!datos.vara.mideLoQueCorre && (
                      <p className="mt-1.5 text-[12px] text-[var(--color-warning)]">El agente cambió desde esas pruebas: las pruebas de calidad están por volver a pasar.</p>
                    )}
                  </>
                );
              })()
            )}
          </div>

          {/* ── 2 · Tus conversaciones reales ── */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
              Tus conversaciones reales · del {ddmm(datos.desde)} al {ddmm(datos.hasta)}
            </p>
            {datos.clinicas.length === 0 || datos.total.turnos + datos.total.coincidencia.total + datos.total.marcados.total === 0 ? (
              <p className="mt-1 text-[13px] text-[var(--color-muted)]">Sin mensajes atendidos por el agente del {ddmm(datos.desde)} al {ddmm(datos.hasta)}. Cuando conteste, aquí se verá qué hizo con cada sede.</p>
            ) : (
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                      <th className="py-1.5 pr-3 font-semibold">Sede</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Mensajes</th>
                      <th className="py-1.5 pr-3 text-right font-semibold whitespace-nowrap" title="Entregas que llegaron con todos los datos, de todas las entregas a una persona.">Con todos los datos</th>
                      <th className="py-1.5 pr-3 text-right font-semibold whitespace-nowrap" title="Mensajes que la revisión de seguridad descartó.">Revisión de seguridad</th>
                      <th className="py-1.5 pr-3 text-right font-semibold whitespace-nowrap" title="De los envíos que salían de un borrador del agente, cuántos mandó el equipo sin tocar.">Enviado tal cual</th>
                      <th className="py-1.5 text-right font-semibold whitespace-nowrap" title="Se marca desde «Ver por qué» en Mensajería; entra en revisión antes de sumarse a las pruebas de calidad.">Marcado como error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.clinicas.map((c) => (
                      <FilaSede key={c.clinicaId ?? "sin"} c={c} titulo={c.nombre ?? (c.clinicaId ? c.clinicaId : "Sin sede asignada")} />
                    ))}
                    {datos.esRed && datos.clinicas.length > 1 && <FilaSede c={datos.total} titulo="Toda la red" destacada />}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 3 · Marcados como error y el disparador de modo B: dos datos, sin párrafos ── */}
          <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 text-[12.5px] text-[var(--color-muted)] md:grid-cols-2">
            <div>
              <p
                className="text-[10px] font-medium uppercase tracking-wider"
                title="Se marca desde «Ver por qué» en Mensajería: el mensaje se guarda tal cual lo viste y entra en revisión antes de sumarse a las pruebas de calidad."
              >
                Marcados como error
              </p>
              <p className="mt-1 tabular-nums">
                {datos.total.marcados.total === 0 ? (
                  "Ninguno en esta ventana"
                ) : (
                  <>
                    <b className="font-semibold text-[var(--color-foreground)]">{datos.total.marcados.total}</b>
                    {datos.total.marcados.pendientes > 0 ? ` · ${datos.total.marcados.pendientes} por revisar` : ""}
                    {datos.total.marcados.aceptados > 0 ? ` · ${datos.total.marcados.aceptados} aceptado${s(datos.total.marcados.aceptados)} para las pruebas de calidad` : ""}
                    {datos.total.marcados.descartados > 0 ? ` · ${datos.total.marcados.descartados} descartado${s(datos.total.marcados.descartados)}` : ""}
                  </>
                )}
                {" · "}
                <Link href="/mensajeria" className="font-medium text-[var(--color-accent)] hover:underline">Marcar uno en Mensajería</Link>
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider">Enviar solo lo rutinario</p>
              {datos.total.coincidencia.total > 0 && (
                <p className="mt-1 tabular-nums">
                  Hoy: {ETIQUETA_COINCIDENCIA.tal_cual.toLowerCase()} {datos.total.coincidencia.talCual} · {ETIQUETA_COINCIDENCIA.editado.toLowerCase()} {datos.total.coincidencia.editado} · {ETIQUETA_COINCIDENCIA.reescrito.toLowerCase()} {datos.total.coincidencia.reescrito}
                </p>
              )}
              <LineaModoB co={datos.total.coincidencia} className={datos.total.coincidencia.total > 0 ? "mt-0.5" : "mt-1"} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
