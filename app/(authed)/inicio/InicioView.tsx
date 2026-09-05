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
import type { Inicio, ClinicaInicio, PuntoDinero } from "../../lib/inicio/calcular";
import { BASE_MINIMA_COHORTE, UMBRAL_COHORTE_ABIERTA } from "../../lib/dashboard-red";
import { BarraProporcion, BarraApilada, Bullet, Sparkline, CifraConBarra, FilaBarra } from "./micro";
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
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Los últimos `n` días de una línea del dinero parado, para su sparkline.
 *  Un día sin esa línea en la foto es un hueco (null), no un cero. */
const serieLinea = (serie: PuntoDinero[], tipo: string, n = 8): Array<number | null> =>
  serie.slice(-n).map((p) => (tipo in p.lineas ? p.lineas[tipo] : null));
const CLASE_DETALLE = "mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)]";
const CLASE_EYEBROW = "text-[10px] font-medium uppercase tracking-wider";

export function InicioView() {
  const { selectedClinicaId, selectedClinicaNombre, isHydrated, setSelectedClinicaId } = useClinic();
  const [data, setData] = useState<Inicio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [detalleDinero, setDetalleDinero] = useState(false);
  const [detalleEquipo, setDetalleEquipo] = useState(false);

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
                      ? <>vs hace 7 días<br /><span className="tabular-nums">(foto del {ddmm(data.dineroParado.comparadoConDia)})</span></>
                      : <>sin comparación aún<br />{data.dineroParado.primeraFotoDia ? <span className="tabular-nums">fotos desde el {ddmm(data.dineroParado.primeraFotoDia)}</span> : "primera foto hoy"}</>}
                  </p>
                </div>
                {/* Bullet de Few: barra = parado hoy · marca = hace 7 días · bandas =
                    rango del último mes (mín–máx de las fotos) · rojo = vencidos. */}
                {(() => {
                  const totales = data.dineroParado.serie.map((p) => p.total);
                  const conRango = totales.length >= 2;
                  return (
                    <Bullet
                      hoy={data.dineroParado.total}
                      hace7={data.dineroParado.hace7Total}
                      bandaMin={conRango ? Math.min(...totales) : null}
                      bandaMax={conRango ? Math.max(...totales) : null}
                      rojo={data.dineroParado.cobros}
                      etiquetaMarca={data.dineroParado.hace7Total != null ? `hace 7 d · ${eur(data.dineroParado.hace7Total)}` : null}
                      formato={eur}
                    />
                  );
                })()}
                <ul className={`${data.dineroParado.hace7Total != null ? "mt-8" : "mt-3"} divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]`}>
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
                        {/* Sparkline de los últimos 7 días + el neto, en vez de solo el texto. */}
                        <span className="flex w-44 shrink-0 items-center justify-end gap-2 whitespace-nowrap text-right text-[11.5px] tabular-nums" title={data.dineroParado.comparadoConDia ? `Comparado con la foto del ${data.dineroParado.comparadoConDia}` : "Todavía no hay foto de hace 7 días"}>
                          <Sparkline valores={serieLinea(data.dineroParado.serie, l.tipo)} rojo={(l.delta7d ?? 0) > 0} />
                          {l.delta7d == null ? (
                            <span className="text-[var(--color-muted)]">sin foto aún</span>
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
                <button type="button" onClick={() => setDetalleDinero((v) => !v)} aria-expanded={detalleDinero} className={CLASE_DETALLE}>
                  {detalleDinero ? <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden /> : <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />}
                  {detalleDinero ? "Ocultar el detalle del dinero parado" : "Ver el detalle del dinero parado"}
                </button>
                {detalleDinero && (() => {
                  // Detalle del MISMO bloque: cómo llegó hasta aquí, de qué está
                  // hecho y qué se movió. Ninguna métrica nueva.
                  const serie = data.dineroParado.serie;
                  const totales = serie.map((p) => p.total);
                  const conImporte = data.dineroParado.lineas.filter((l) => l.importe != null);
                  const maxImporte = Math.max(0, ...conImporte.map((l) => l.importe ?? 0));
                  return (
                    <div className="mt-3 grid gap-4 border-t border-[var(--color-border)] pt-3 text-[12.5px] text-[var(--color-muted)] sm:grid-cols-3">
                      <div>
                        <p className={CLASE_EYEBROW}>Evolución del mes</p>
                        {serie.length >= 2 ? (
                          <>
                            <Sparkline valores={totales} ancho={300} alto={56} className="mt-1 h-14 w-full" />
                            <p className="mt-1 tabular-nums">
                              Presupuestos parados, una foto al día · máximo <b className="font-semibold text-[var(--color-foreground)]">{eur(Math.max(...totales))}</b> · mínimo{" "}
                              <b className="font-semibold text-[var(--color-foreground)]">{eur(Math.min(...totales))}</b> · {serie.length} día{s(serie.length)} con foto.
                            </p>
                          </>
                        ) : (
                          <p className="mt-1">Todavía {serie.length === 0 ? "no hay fotos" : "hay una sola foto"}: se guarda una al día y la curva aparece con la segunda.</p>
                        )}
                      </div>
                      <div>
                        <p className={CLASE_EYEBROW}>De qué está hecho</p>
                        <ul className="mt-1">
                          {conImporte.map((l) => (
                            <FilaBarra key={l.tipo} etiqueta={l.titulo} valor={l.importe ?? 0} max={maxImporte} texto={eur(l.importe ?? 0)} rojo={l.tipo === "vencidos"} />
                          ))}
                          {data.dineroParado.lineas.filter((l) => l.importe == null).map((l) => (
                            <li key={l.tipo} className="flex items-baseline justify-between gap-2 py-0.5">
                              <span className="truncate">{l.titulo}</span>
                              <b className="font-semibold tabular-nums text-[var(--color-foreground)]">{l.n} sin importe</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className={CLASE_EYEBROW}>Qué se movió en 7 días</p>
                        <ul className="mt-1 space-y-0.5 tabular-nums">
                          {data.dineroParado.lineas.map((l) => (
                            <li key={l.tipo} className="flex items-baseline justify-between gap-2">
                              <span className="truncate">{l.titulo}</span>
                              <b className={`shrink-0 font-semibold ${l.delta7d == null ? "text-[var(--color-muted)]" : l.delta7d > 0 ? "text-[var(--color-danger)]" : l.delta7d < 0 ? "text-[var(--color-success)]" : "text-[var(--color-foreground)]"}`}>
                                {l.delta7d == null ? "sin foto" : l.delta7d === 0 ? "igual" : `${l.delta7d > 0 ? "+" : "−"}${l.importe != null ? eur(Math.abs(l.delta7d)) : Math.abs(l.delta7d)}`}
                              </b>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-[11px]">
                          Neto por línea frente a la foto{data.dineroParado.comparadoConDia ? ` del ${ddmm(data.dineroParado.comparadoConDia)}` : " de hace 7 días"}. Lo que entró y lo que salió por separado no se guarda todavía.
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </section>

              <section className="lg:col-span-2" data-bloque="equipo">
                <Card padding="lg" className="h-full">
                  <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[var(--color-foreground)]">
                    <Users size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                    Tu equipo
                  </h2>
                  {/* La cola de un golpe: qué parte está fuera de plazo se ve antes de leer. */}
                  <BarraApilada
                    className="mt-3"
                    partes={[
                      { n: data.equipo.porCohorte.necesita_respuesta ?? 0, color: "var(--color-warning)", etiqueta: ETIQUETA_COHORTE.necesita_respuesta },
                      { n: data.equipo.porCohorte.listos_para_cerrar ?? 0, color: "var(--color-accent)", etiqueta: ETIQUETA_COHORTE.listos_para_cerrar },
                      { n: data.equipo.porCohorte.fuera_de_plazo ?? 0, color: "var(--color-danger)", etiqueta: ETIQUETA_COHORTE.fuera_de_plazo },
                    ]}
                  />
                  <ul className="mt-2 space-y-1">
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
                  <button type="button" onClick={() => setDetalleEquipo((v) => !v)} aria-expanded={detalleEquipo} className={CLASE_DETALLE}>
                    {detalleEquipo ? <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden /> : <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />}
                    {detalleEquipo ? "Ocultar el detalle del equipo" : "Ver el detalle del equipo"}
                  </button>
                  {detalleEquipo && (() => {
                    // Detalle del MISMO bloque: cómo ha ido la cola, cuánto espera
                    // cada caso y en qué sede. Sin ranking de personas, nunca.
                    const serie = data.equipo.serie;
                    const e = data.equipo.edades;
                    const maxEdad = Math.max(1, e.menosDeUnDia, e.de1a3, e.masDe3);
                    const maxSede = Math.max(1, ...data.equipo.porClinica.map((c) => c.n));
                    return (
                      <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3 text-[12.5px] text-[var(--color-muted)]">
                        <div>
                          <p className={CLASE_EYEBROW}>La cola este mes</p>
                          {serie.length >= 2 ? (
                            <>
                              <Sparkline valores={serie.map((p) => p.total)} ancho={300} alto={44} rojo className="mt-1 h-11 w-full" />
                              <p className="mt-1 tabular-nums">
                                Casos esperando a alguien, una foto al día. El {ddmm(serie[0].dia)} eran <b className="font-semibold text-[var(--color-foreground)]">{serie[0].total}</b>; hoy{" "}
                                <b className="font-semibold text-[var(--color-foreground)]">{data.equipo.total}</b>.
                              </p>
                            </>
                          ) : (
                            <p className="mt-1">Todavía {serie.length === 0 ? "no hay fotos de la cola" : "hay una sola foto de la cola"}: se guarda una al día y la curva aparece con la segunda.</p>
                          )}
                        </div>
                        <div>
                          <p className={CLASE_EYEBROW}>Cuánto llevan esperando</p>
                          <ul className="mt-1">
                            <FilaBarra etiqueta="Menos de un día" valor={e.menosDeUnDia} max={maxEdad} texto={String(e.menosDeUnDia)} />
                            <FilaBarra etiqueta="De 1 a 3 días" valor={e.de1a3} max={maxEdad} texto={String(e.de1a3)} />
                            <FilaBarra etiqueta="Más de 3 días" valor={e.masDe3} max={maxEdad} texto={String(e.masDe3)} rojo={e.masDe3 > 0} />
                          </ul>
                        </div>
                        {data.esRed && data.equipo.porClinica.length > 0 && (
                          <div>
                            <p className={CLASE_EYEBROW}>Por sede</p>
                            <ul className="mt-1">
                              {data.equipo.porClinica.map((c) => (
                                <FilaBarra key={c.clinicaId} etiqueta={c.nombre ?? "Sin clínica asignada"} valor={c.n} max={maxSede} texto={String(c.n)} />
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                        {/* La proporción, en forma: con cocinado = 0 el carril queda
                            vacío y se ve a la primera (antes las cuatro cifras pesaban igual). */}
                        {p.resultado > 0 && p.cocinado != null && <BarraProporcion n={p.cocinado} total={p.resultado} className="mt-2" />}
                        <p className="mt-1 text-[12px] leading-snug tabular-nums text-[var(--color-muted)]">
                          {p.resultado === 0 ? (
                            "Nada cerrado este mes todavía."
                          ) : p.cocinado == null ? (
                            <span title="Confirmadas antes de que Fyllio registrara quién confirma.">Quién las confirmó no consta todavía.</span>
                          ) : (
                            <><span className={`font-semibold ${p.cocinado === 0 ? "text-[var(--color-muted)]" : "text-[var(--color-accent)]"}`}>{def.cocinado(p.cocinado, p.resultado)}</span>{p.sinDato > 0 ? ` · ${p.sinDato} sin dato` : ""}</>
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
/** ¿La cohorte del mes ya dice algo? Misma regla que el bloque de negocio
 *  (`conversionDe`): base mínima Y no más del 20 % todavía abierto. La primera
 *  semana de cada mes casi todo está abierto y un «0 %» se lee como «no vende». */
const cohorteComparable = (c: ClinicaInicio) =>
  c.presentadosMes >= BASE_MINIMA_COHORTE && c.abiertosMes / c.presentadosMes <= UMBRAL_COHORTE_ABIERTA;

function TablaClinicas({ filas, onClinica }: { filas: ClinicaInicio[]; onClinica: (id: string) => void }) {
  const [detalle, setDetalle] = useState(false);
  const ordenadas = [...filas].sort((a, b) => (b.necesitanPersona ?? -1) - (a.necesitanPersona ?? -1) || (a.tendenciaPct ?? Infinity) - (b.tendenciaPct ?? Infinity));
  // La que cayó: la peor evolución NEGATIVA con muestra suficiente. Una sola.
  const caida = filas
    .filter((c) => !c.muestraCorta && c.tendenciaPct != null && c.tendenciaPct < 0)
    .sort((a, b) => (a.tendenciaPct ?? 0) - (b.tendenciaPct ?? 0))[0];
  // Longitud = ranking: las barras de € comparten escala por columna.
  const maxAceptado = Math.max(0, ...filas.map((c) => Math.max(c.aceptadoMes, c.aceptadoMesPrevio)));
  const maxVencido = Math.max(0, ...filas.map((c) => c.vencido));
  const maxAgente = Math.max(1, ...filas.map((c) => c.agenteAtendidas));
  const porAceptado = [...filas].sort((a, b) => b.aceptadoMes - a.aceptadoMes);
  const porVencido = [...filas].filter((c) => c.vencido > 0).sort((a, b) => b.vencido - a.vencido);
  const porAgente = [...filas].sort((a, b) => b.agenteAtendidas - a.agenteAtendidas);
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
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Aceptados de presentados</th>
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
                      {/* MEJORAS 156: «aceptados de presentados» con barra; el % solo
                          cuando la cohorte ya dice algo. Nunca «0 %» de una cohorte abierta. */}
                      {c.presentadosMes === 0 ? (
                        <span className="text-[var(--color-muted)]">sin presupuestos este mes</span>
                      ) : (
                        <span className="inline-flex min-w-[6.5rem] flex-col items-end gap-0.5">
                          <span><b className="font-semibold text-[var(--color-foreground)]">{c.aceptadosMes}</b> de {c.presentadosMes}</span>
                          <BarraProporcion n={c.aceptadosMes} total={c.presentadosMes} className="w-24" />
                          <span className="text-[10px] text-[var(--color-muted)]">
                            {cohorteComparable(c)
                              ? `${c.conversionPct ?? 0} %`
                              : `${c.abiertosMes} abierto${s(c.abiertosMes)}${c.presentadosMes < BASE_MINIMA_COHORTE ? " · muestra corta" : ""}`}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <CifraConBarra valor={c.aceptadoMes} max={maxAceptado}>
                        <span className={c.aceptadoMes > 0 ? "font-semibold text-[var(--color-foreground)]" : "text-[var(--color-muted)]"}>{eur(c.aceptadoMes)}</span>
                      </CifraConBarra>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.vencido > 0 ? (
                        <CifraConBarra valor={c.vencido} max={maxVencido} rojo>
                          <span className="font-semibold text-[var(--color-danger)]">{eur(c.vencido)}</span>
                        </CifraConBarra>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
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
        <div className="px-4 pb-3">
          <button type="button" onClick={() => setDetalle((v) => !v)} aria-expanded={detalle} className={CLASE_DETALLE}>
            {detalle ? <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden /> : <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />}
            {detalle ? "Ocultar el detalle de las clínicas" : "Ver el detalle de las clínicas"}
          </button>
          {detalle && (
            // Detalle del MISMO bloque: la comparativa que la tabla resume en un
            // %, los vencidos que suma, y lo que el agente hizo en cada sede.
            <div className="mt-3 grid gap-4 border-t border-[var(--color-border)] pt-3 text-[12.5px] text-[var(--color-muted)] sm:grid-cols-3">
              <div>
                <p className={CLASE_EYEBROW}>€ aceptado · este mes vs el mismo tramo del anterior</p>
                <ul className="mt-1">
                  {porAceptado.map((c) => (
                    <li key={c.id} className="py-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">{c.nombre}</span>
                        <b className="shrink-0 font-semibold tabular-nums text-[var(--color-foreground)]">
                          {eur(c.aceptadoMes)} <span className="font-normal text-[var(--color-muted)]">· antes {eur(c.aceptadoMesPrevio)}</span>
                        </b>
                      </div>
                      <div className="mt-0.5 h-[5px] overflow-hidden rounded-sm bg-[var(--color-border)]"><div className="h-full rounded-sm bg-[var(--color-accent)]" style={{ width: `${maxAceptado > 0 ? (c.aceptadoMes / maxAceptado) * 100 : 0}%` }} /></div>
                      <div className="mt-0.5 h-[5px] overflow-hidden rounded-sm bg-[var(--color-border)] opacity-50"><div className="h-full rounded-sm bg-[var(--color-accent)]" style={{ width: `${maxAceptado > 0 ? (c.aceptadoMesPrevio / maxAceptado) * 100 : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px]">Barra intensa: este mes. Tenue: los mismos días del mes pasado.</p>
              </div>
              <div>
                <p className={CLASE_EYEBROW}>Cobros vencidos por sede</p>
                {porVencido.length === 0 ? (
                  <p className="mt-1">Ninguna sede tiene cobros fuera de plazo.</p>
                ) : (
                  <ul className="mt-1">
                    {porVencido.map((c) => (
                      <FilaBarra key={c.id} etiqueta={c.nombre} valor={c.vencido} max={maxVencido} texto={eur(c.vencido)} rojo />
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className={CLASE_EYEBROW}>El agente por sede, este mes</p>
                <ul className="mt-1">
                  {porAgente.map((c) => (
                    <FilaBarra key={c.id} etiqueta={c.nombre} valor={c.agenteAtendidas} max={maxAgente} texto={`${c.agenteAtendidas} atendida${s(c.agenteAtendidas)} · ${c.agenteEntregadas} entregada${s(c.agenteEntregadas)}`} />
                  ))}
                </ul>
                <p className="mt-1 text-[11px]">Conversaciones que el agente evaluó y casos que entregó completos. La sede es la del último mensaje del hilo.</p>
              </div>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
