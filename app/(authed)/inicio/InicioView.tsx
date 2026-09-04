"use client";

// INICIO (rediseño dictado 31-08). El criterio: Inicio es OPERATIVO — cada
// número cambia lo que alguien hace hoy; lo analítico vive en KPIs. Una
// pantalla, sin scroll, 5–9 elementos, lo más importante arriba a la izquierda.
//
//   0 · «Desde ayer» — una línea: lo que pasó mientras nadie miraba, desde el
//       último cierre de jornada de la clínica. Cada cifra abre su lista.
//   1 · Dinero parado esperándote (arriba izquierda): total + las cuatro
//       líneas con importe, delta vs la FOTO de hace 7 días, clic a la cola.
//   1 · Tu equipo (arriba derecha): las tres cohortes y el SLA de la cola.
//       Sin ranking de personas, nunca.
//   2 · Qué hizo Fyllio por ti este mes — por PROCESO: el resultado y cuánto
//       LLEGÓ COCINADO. La ventana (30 días) se dice: es política.
//       Expandido: lo específico de la máquina. NO «tiempo ahorrado».
//   3 · Tus clínicas (solo red): ordenadas por «necesitan persona», SOLO la
//       sede que cayó resaltada. Sin gradiente de color.
//
// Regla de los expandibles: lo visible se sostiene solo; lo expandido es
// detalle del MISMO bloque, nunca una métrica nueva.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useClinic } from "../../lib/context/ClinicContext";
import { openCopilot } from "../../components/copilot/openCopilot";
import { ErrorState } from "../../components/ui/Feedback";
import { Card } from "../../components/ui/Card";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";
import { cargarJSON } from "../../lib/fetch-json";
import { eur } from "../../components/shared/Cifra";
import { fechaHoraLegible } from "../../lib/agenda/fechas";
import type { Inicio } from "../../lib/inicio/calcular";
import type { ClinicaFila } from "../../lib/dashboard-red";
import {
  Sparkles,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Building2,
  Users,
  Bot,
  ICON_STROKE,
} from "../../components/icons";

// ── Etiquetas de producto (mismo vocabulario que Seguimiento y la ficha) ──
const ETIQUETA_COHORTE: Record<string, string> = {
  necesita_respuesta: "Necesita respuesta",
  listos_para_cerrar: "Listos para cerrar",
  fuera_de_plazo: "Fuera de plazo",
};
const ETIQUETA_CAUSA: Record<string, string> = {
  caso_completo: "caso completo entregado",
  peticion_queja: "pidió hablar con una persona",
  urgencia: "urgencia",
  insistencia: "insistió sin respuesta",
  antecedente_medico: "mencionó una condición médica",
};
const ETIQUETA_CLAVE: Record<string, string> = {
  precio_descuento: "precio o descuento",
  plan_pago: "plan de pago",
  cobertura_seguro: "cobertura del seguro",
  cambio_tratamiento: "cambio de tratamiento",
  garantia_condiciones: "garantía o condiciones",
  dato_presupuesto: "un dato del presupuesto",
  agenda_disponibilidad: "disponibilidad de agenda",
  dato_cita: "un dato de la cita",
  duda_clinica: "duda clínica",
  otro: "otra cosa",
};
const PROCESO: Record<string, { titulo: string; resultado: (n: number, importe: number | null) => string; cocinado: (n: number, total: number) => string }> = {
  presupuestos: {
    titulo: "Presupuestos",
    resultado: (n, imp) => `${n} aceptado${n === 1 ? "" : "s"}${imp != null && imp > 0 ? ` · ${eur(imp)}` : ""}`,
    cocinado: (n, t) => `${n} de ${t} ${n === 1 ? "llegó" : "llegaron"} con la decisión ya recogida`,
  },
  leads: {
    titulo: "Leads",
    resultado: (n) => `${n} citado${n === 1 ? "" : "s"}`,
    cocinado: (n, t) => `${n} de ${t} ${n === 1 ? "llegó" : "llegaron"} con disponibilidad y motivo ya recogidos`,
  },
  cobros: {
    titulo: "Cobros",
    resultado: (n, imp) => `${n} cobro${n === 1 ? "" : "s"}${imp != null && imp > 0 ? ` · ${eur(imp)}` : ""}`,
    cocinado: (n, t) => `${n} de ${t} ${n === 1 ? "llegó" : "llegaron"} con el pago ya acordado`,
  },
  citas: {
    titulo: "Citas",
    resultado: (n) => `${n} confirmada${n === 1 ? "" : "s"}`,
    cocinado: (n, t) => `${n} de ${t} ${n === 1 ? "la confirmó" : "las confirmó"} Fyllio (voz o recordatorio)`,
  },
};

const s = (n: number) => (n === 1 ? "" : "s");

export function InicioView() {
  const { selectedClinicaId, selectedClinicaNombre, isHydrated, setSelectedClinicaId } = useClinic();
  const [data, setData] = useState<Inicio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [detalleAbierto, setDetalleAbierto] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = selectedClinicaId ? `?clinica=${encodeURIComponent(selectedClinicaId)}` : "";
      const d = await cargarJSON<Inicio>(`/api/inicio${qs}`);
      setData(d);
      setError(null);
    } catch (e) {
      // Conservar lo último bueno + error honesto (§10).
      setError(e instanceof Error ? e.message : "No se pudo cargar Inicio");
    } finally {
      setCargando(false);
    }
  }, [selectedClinicaId]);

  useEffect(() => {
    if (!isHydrated) return;
    void cargar();
  }, [isHydrated, cargar]);

  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;

  if (error && !data) {
    return (
      <div className="p-6">
        <ErrorState title="No se pudo cargar Inicio" detail={error} onRetry={cargar} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)]">
      <div className="mx-auto max-w-screen-2xl p-4 lg:px-6 lg:py-4">
        {/* ── Cabecera + línea 0 · desde ayer ── */}
        <header className="mb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
              {clinicaFiltrada ? selectedClinicaNombre : "Inicio"}
            </h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void cargar()}
                disabled={cargando}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
              >
                <RefreshCw size={14} strokeWidth={ICON_STROKE} className={cargando ? "animate-spin" : ""} aria-hidden />
                {cargando ? "Actualizando…" : "Actualizar"}
              </button>
              {data && (
                <button
                  type="button"
                  onClick={() => {
                    const f = data.fyllioMes;
                    const resumen = [
                      `Dinero parado: ${eur(data.dineroParado.total)} en presupuestos · ${eur(data.dineroParado.cobros)} vencidos · ${data.dineroParado.leadsSinImporte} leads. Líneas: ${data.dineroParado.lineas.map((l) => `${l.titulo}: ${l.importe != null ? eur(l.importe) : l.n}`).join(" · ")}`,
                      `Equipo: ${Object.entries(data.equipo.porCohorte).map(([k, n]) => `${ETIQUETA_COHORTE[k] ?? k} ${n}`).join(" · ")}; el más viejo ${data.equipo.masViejoDias ?? "—"} días.`,
                      `Fyllio este mes: ${f.procesos.map((p) => `${PROCESO[p.proceso].titulo}: ${PROCESO[p.proceso].resultado(p.resultado, p.importe)}${p.cocinado != null ? ` (${p.cocinado} cocinados)` : ""}`).join(" · ")}.`,
                    ].join("\n");
                    openCopilot({
                      context: { kind: "red_admin", summary: resumen },
                      initialAssistantMessage: "He visto tu Inicio. ¿Qué punto quieres que analicemos?",
                    });
                  }}
                  className="fyllio-ia-gradient inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium hover:opacity-90"
                >
                  <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden /> Analiza el mes
                </button>
              )}
            </div>
          </div>
          <div className="min-w-0">
            {data ? (
              <p className="mt-1 text-[13px] text-[var(--color-muted)]" data-desde-ayer>
                <span className="font-medium text-[var(--color-foreground)]">Desde el {fechaHoraLegible(data.desdeAyer.desdeISO).toLowerCase()}</span>
                {" · "}
                <Link href="/mensajeria?filtro=agente" className="hover:underline">
                  <b className="font-semibold text-[var(--color-foreground)] tabular-nums">{data.desdeAyer.atendidas}</b> conversación{s(data.desdeAyer.atendidas) ? "es" : ""} atendida{s(data.desdeAyer.atendidas)} por el agente
                </Link>
                {" · "}
                <Link href="/seguimiento?cohorte=listos_para_cerrar" className="hover:underline">
                  <b className="font-semibold text-[var(--color-foreground)] tabular-nums">{data.desdeAyer.entregadosListos}</b> caso{s(data.desdeAyer.entregadosListos)} entregado{s(data.desdeAyer.entregadosListos)} listo{s(data.desdeAyer.entregadosListos)}
                </Link>
                {" · "}
                <Link href="/seguimiento?cohorte=necesita_respuesta" className="hover:underline">
                  <b className={`font-semibold tabular-nums ${data.desdeAyer.derivadosEsperan > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-foreground)]"}`}>{data.desdeAyer.derivadosEsperan}</b> derivado{s(data.desdeAyer.derivadosEsperan)} que espera{s(data.desdeAyer.derivadosEsperan) ? "n" : ""}
                </Link>
                {" · "}
                <Link href="/envios" className="hover:underline">
                  <b className={`font-semibold tabular-nums ${data.desdeAyer.caducados > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-foreground)]"}`}>{data.desdeAyer.caducados}</b> envío{s(data.desdeAyer.caducados)} caducado{s(data.desdeAyer.caducados)}
                </Link>
              </p>
            ) : (
              <div className="fyllio-skeleton mt-1.5 h-4 w-[34rem] max-w-full" />
            )}
          </div>
        </header>

        {error && data && (
          <p className="mb-3 text-xs font-semibold text-[var(--color-danger)]">
            No se pudo actualizar — cifras anteriores en pantalla.{" "}
            <button type="button" onClick={() => void cargar()} className="underline">Reintentar</button>
          </p>
        )}
        {clinicaFiltrada && (
          <AvisoFiltroClinica
            nombre={selectedClinicaNombre!}
            onVerTodas={() => setSelectedClinicaId(null)}
            ocultaAdemas="La tabla de clínicas solo aparece viendo la red entera."
          />
        )}

        {!data ? (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="fyllio-skeleton h-56" />
              <div className="fyllio-skeleton h-56" />
            </div>
            <div className="fyllio-skeleton h-44" />
          </div>
        ) : (
          <div className={`space-y-3 ${cargando ? "opacity-60" : ""}`}>
            {/* ══ FILA 1 · DINERO PARADO (izq) · TU EQUIPO (der) ══ */}
            <div className="grid gap-3 lg:grid-cols-5">
              <section className="lg:col-span-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-5 py-4" data-bloque="dinero">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="fyllio-label text-[var(--color-accent)]">Parado esperándote</p>
                    <h2 className="mt-1 font-display text-3xl font-bold tracking-tight tabular-nums text-[var(--color-foreground)]">
                      {eur(data.dineroParado.total)}
                      {data.dineroParado.cobros > 0 && (
                        <span className="ml-2 text-lg font-semibold text-[var(--color-danger)]">+ {eur(data.dineroParado.cobros)} vencidos</span>
                      )}
                      {data.dineroParado.leadsSinImporte > 0 && (
                        <span className="ml-2 text-lg font-semibold text-[var(--color-muted)]">+ {data.dineroParado.leadsSinImporte} lead{s(data.dineroParado.leadsSinImporte)}</span>
                      )}
                    </h2>
                  </div>
                  <p className="text-right text-[11px] leading-snug text-[var(--color-muted)]">
                    {data.dineroParado.comparadoConDia
                      ? <>vs hace 7 días<br /><span className="tabular-nums">(foto del {data.dineroParado.comparadoConDia.slice(8, 10)}/{data.dineroParado.comparadoConDia.slice(5, 7)})</span></>
                      : <>sin comparación aún<br />{data.dineroParado.primeraFotoDia ? <span className="tabular-nums">fotos desde el {data.dineroParado.primeraFotoDia.slice(8, 10)}/{data.dineroParado.primeraFotoDia.slice(5, 7)}</span> : "primera foto hoy"}</>}
                  </p>
                </div>
                <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  {data.dineroParado.lineas.length === 0 && (
                    <li className="px-4 py-3 text-sm text-[var(--color-muted)]">Nada en riesgo hoy — las colas están al día.</li>
                  )}
                  {data.dineroParado.lineas.map((l) => (
                    <li key={l.tipo}>
                      <Link href={l.href} className="flex items-center gap-3 px-4 py-1.5 transition-colors hover:bg-[var(--color-surface-muted)]">
                        <span className="w-24 shrink-0 font-display text-base font-bold tabular-nums text-[var(--color-danger)]">
                          {l.importe != null ? eur(l.importe) : l.n}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          <span className="font-medium text-[var(--color-foreground)]">{l.titulo}</span>
                          <span className="text-[var(--color-muted)]"> — {l.detalle}</span>
                        </span>
                        <span className="w-32 shrink-0 whitespace-nowrap text-right text-[11.5px] tabular-nums" title={data.dineroParado.comparadoConDia ? `Comparado con la foto del ${data.dineroParado.comparadoConDia}` : "Todavía no hay foto de hace 7 días"}>
                          {l.delta7d == null ? (
                            <span className="text-[var(--color-muted)]">—</span>
                          ) : l.delta7d === 0 ? (
                            <span className="text-[var(--color-muted)]">igual que hace 7 d</span>
                          ) : (
                            <span className={l.delta7d > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}>
                              {l.delta7d > 0 ? "+" : "−"}{l.importe != null ? eur(Math.abs(l.delta7d)) : Math.abs(l.delta7d)} vs hace 7 d
                            </span>
                          )}
                        </span>
                        <ChevronRight size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="lg:col-span-2" data-bloque="equipo">
                <Card padding="lg" className="h-full">
                  <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[var(--color-foreground)]">
                    <Users size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                    Tu equipo
                  </h2>
                  <ul className="mt-3 space-y-1.5">
                    {(["necesita_respuesta", "listos_para_cerrar", "fuera_de_plazo"] as const).map((k) => (
                      <li key={k}>
                        <Link href={`/seguimiento?cohorte=${k}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--color-surface-muted)]">
                          <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-foreground)]">
                            <span
                              aria-hidden
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ background: k === "fuera_de_plazo" ? "var(--color-danger)" : k === "necesita_respuesta" ? "var(--color-warning)" : "var(--color-accent)" }}
                            />
                            {ETIQUETA_COHORTE[k]}
                          </span>
                          <span className="font-display text-lg font-bold tabular-nums text-[var(--color-foreground)]">{data.equipo.porCohorte[k] ?? 0}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[12.5px] tabular-nums text-[var(--color-muted)]">
                    {data.equipo.total === 0 ? (
                      "Nada esperando a una persona ahora mismo."
                    ) : (
                      <>
                        <span className="font-semibold text-[var(--color-foreground)]">{data.equipo.total}</span> caso{s(data.equipo.total)} esperando a alguien
                        {(data.equipo.porCohorte.fuera_de_plazo ?? 0) > 0 && (
                          <> · <span className="font-semibold text-[var(--color-danger)]">{data.equipo.porCohorte.fuera_de_plazo}</span> fuera de plazo</>
                        )}
                        {data.equipo.masViejoDias != null && (
                          <> · el más viejo lleva <span className="font-semibold text-[var(--color-foreground)]">{data.equipo.masViejoDias === 0 ? "menos de un día" : `${data.equipo.masViejoDias} día${s(data.equipo.masViejoDias)}`}</span></>
                        )}
                      </>
                    )}
                  </p>
                </Card>
              </section>
            </div>

            {/* ══ FILA 2 · QUÉ HIZO FYLLIO POR TI ESTE MES ══ */}
            <section data-bloque="fyllio">
              <Card padding="lg">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[var(--color-foreground)]">
                    <Bot size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
                    Qué hizo Fyllio por ti este mes
                  </h2>
                  {/* La política, dicha (dictado): la ventana de «cocinado». */}
                  <p className="text-[11.5px] text-[var(--color-muted)]">
                    «Llegó cocinado» = el agente entregó el caso completo en los {data.fyllioMes.ventanaCocinadoDias} días anteriores al cierre.
                  </p>
                </div>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {data.fyllioMes.procesos.map((p) => {
                    const def = PROCESO[p.proceso];
                    return (
                      <li key={p.proceso} className="rounded-lg border border-[var(--color-border)] px-3.5 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">{def.titulo}</p>
                        <p className="mt-0.5 font-display text-base font-bold tabular-nums text-[var(--color-foreground)]">{def.resultado(p.resultado, p.importe)}</p>
                        <p className="mt-0.5 text-[12px] leading-snug tabular-nums text-[var(--color-muted)]">
                          {p.resultado === 0 ? (
                            "Nada cerrado este mes todavía."
                          ) : p.cocinado == null ? (
                            <span title="Confirmadas antes de que Fyllio registrara quién confirma.">Quién las confirmó no consta todavía.</span>
                          ) : (
                            <><span className="font-semibold text-[var(--color-accent)]">{def.cocinado(p.cocinado, p.resultado)}</span>{p.sinDato > 0 ? ` · ${p.sinDato} sin dato` : ""}</>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={() => setDetalleAbierto((v) => !v)}
                  aria-expanded={detalleAbierto}
                  className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  {detalleAbierto ? <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden /> : <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />}
                  {detalleAbierto ? "Ocultar el detalle de la máquina" : "Ver el detalle de la máquina"}
                </button>
                {detalleAbierto && (
                  <div className="mt-3 grid gap-3 border-t border-[var(--color-border)] pt-3 text-[12.5px] text-[var(--color-muted)] sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider">Entregas por motivo</p>
                      {Object.keys(data.fyllioMes.detalle.derivacionesPorCausa).length === 0 ? (
                        <p className="mt-1">Ninguna este mes.</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 tabular-nums">
                          {Object.entries(data.fyllioMes.detalle.derivacionesPorCausa).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                            <li key={c}><b className="font-semibold text-[var(--color-foreground)]">{n}</b> {ETIQUETA_CAUSA[c] ?? c}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider">Mensajes enviados</p>
                      <p className="mt-1 tabular-nums"><b className="font-semibold text-[var(--color-foreground)]">{data.fyllioMes.detalle.mensajesRedactadosPorAgente}</b> redactados por el agente (enviados por el equipo)</p>
                      <p className="tabular-nums"><b className="font-semibold text-[var(--color-foreground)]">{data.fyllioMes.detalle.mensajesDelEquipo}</b> escritos por el equipo</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider">Coste del agente</p>
                      {data.fyllioMes.detalle.costeUsd == null ? (
                        <p className="mt-1">Sin turnos tarifados este mes.</p>
                      ) : (
                        <p className="mt-1 tabular-nums"><b className="font-semibold text-[var(--color-foreground)]">{data.fyllioMes.detalle.costeUsd.toFixed(2)} USD</b> en {data.fyllioMes.detalle.turnosTarifados} turno{s(data.fyllioMes.detalle.turnosTarifados)}{data.fyllioMes.detalle.turnosSinTarifa > 0 ? ` · ${data.fyllioMes.detalle.turnosSinTarifa} sin tarifa` : ""}</p>
                      )}
                      {/* «Desde el día X»: política, se dice (dictado). */}
                      {data.fyllioMes.detalle.costeDesdeISO && (
                        <p className="text-[11px]">Medido desde el {fechaHoraLegible(data.fyllioMes.detalle.costeDesdeISO).replace(/ a las .*$/, "")}. Coste del servicio, en dólares.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider">Preguntas que aplazó</p>
                      {Object.keys(data.fyllioMes.detalle.aplazadosPorClave).length === 0 ? (
                        <p className="mt-1">Ninguna este mes.</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 tabular-nums">
                          {Object.entries(data.fyllioMes.detalle.aplazadosPorClave).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                            <li key={k}>aplazó <b className="font-semibold text-[var(--color-foreground)]">{n}</b> pregunta{s(n)} de {ETIQUETA_CLAVE[k] ?? k}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </section>

            {/* ══ FILA 3 · TUS CLÍNICAS (solo red) ══ */}
            {data.esRed && data.clinicas && <TablaClinicas filas={data.clinicas} onClinica={(id) => setSelectedClinicaId(id)} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** La tabla del dashboard, ordenada por «necesitan persona» y con SOLO la
 *  sede que cayó resaltada (dictado). Sin gradiente de color en las filas. */
function TablaClinicas({ filas, onClinica }: { filas: ClinicaFila[]; onClinica: (id: string) => void }) {
  const ordenadas = [...filas].sort((a, b) => (b.necesitanPersona ?? -1) - (a.necesitanPersona ?? -1) || (a.tendenciaPct ?? Infinity) - (b.tendenciaPct ?? Infinity));
  // La que cayó: la peor evolución NEGATIVA con muestra suficiente. Una sola.
  const caida = filas
    .filter((c) => !c.muestraCorta && c.tendenciaPct != null && c.tendenciaPct < 0)
    .sort((a, b) => (a.tendenciaPct ?? 0) - (b.tendenciaPct ?? 0))[0];
  return (
    <section data-bloque="clinicas">
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-2.5 pb-1.5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[var(--color-foreground)]">
            <Building2 size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
            Tus clínicas
          </h2>
          <p className="text-[11px] text-[var(--color-muted)]">
            Ordenadas por conversaciones que necesitan a alguien · clic en una clínica para ver su Inicio
            {caida ? <> · <span className="text-[var(--color-danger)]">resaltada: la sede que cayó</span></> : null}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-4 py-2 text-left font-semibold">Clínica</th>
                <th className="px-2 py-2 text-right font-semibold max-w-[4.5rem]">Necesitan persona</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Conversión</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">€ aceptado</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">€ vencido</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Evolución €</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((c) => {
                const esCaida = caida?.id === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => onClinica(c.id)}
                    className={`cursor-pointer border-b border-[var(--color-border)] last:border-0 transition-colors hover:bg-[var(--color-surface-muted)] ${esCaida ? "bg-[var(--color-danger-soft)]" : ""}`}
                  >
                    <td className="px-4 py-1.5 font-semibold text-[var(--color-foreground)]">
                      {c.nombre}
                      {esCaida && <span className="ml-2 rounded-full bg-[var(--color-danger)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-on-accent)]">cayó</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.necesitanPersona == null ? (
                        <span className="text-[var(--color-muted)]" title="No se pudo consultar.">sin dato</span>
                      ) : c.necesitanPersona === 0 ? (
                        <span className="text-[var(--color-muted)]">—</span>
                      ) : (
                        <Link href={`/mensajeria?filtro=necesitan-de-mi&clinicaId=${c.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-[var(--color-foreground)] underline-offset-2 hover:underline">
                          {c.necesitanPersona}
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className={c.muestraCorta ? "text-[var(--color-muted)]" : "font-semibold text-[var(--color-foreground)]"} title={c.muestraCorta ? `Muestra corta: ${c.presentadosMes} presupuestos este mes.` : undefined}>
                        {c.conversionPct != null ? `${c.conversionPct}%` : "—"}
                      </span>
                      <span className="ml-1 text-[10px] text-[var(--color-muted)]">({c.aceptadosMes} de {c.presentadosMes})</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[var(--color-foreground)]">{eur(c.aceptadoMes)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.vencido > 0 ? <span className="font-semibold text-[var(--color-danger)]">{eur(c.vencido)}</span> : <span className="text-[var(--color-muted)]">—</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.tendenciaPct == null ? (
                        <span className="text-[var(--color-muted)]">—</span>
                      ) : (
                        <span className={esCaida ? "font-semibold text-[var(--color-danger)]" : c.muestraCorta ? "text-[var(--color-muted)]" : "font-semibold text-[var(--color-foreground)]"}>
                          {c.tendenciaPct > 0 ? "+" : c.tendenciaPct < 0 ? "−" : ""}{Math.abs(c.tendenciaPct)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
