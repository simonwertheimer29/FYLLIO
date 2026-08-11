"use client";

// app/(authed)/mensajeria/MensajeriaView.tsx
//
// La bandeja. Tres columnas: lista · conversación · contexto.
//
// ─── Qué la diferencia de Seguimiento ──────────────────────────────────────
//
// Seguimiento responde «¿qué hago ahora?»: filtra, prioriza y solo enseña lo
// que exige criterio. Esto responde «¿qué está pasando?». Son la misma fuente
// —`mensajes_whatsapp` y el mismo estado de automatización— leída de dos
// formas, sin sincronización de por medio: responder aquí retira el caso de la
// cola de allí porque el estado se DERIVA de los mismos mensajes, no porque
// nadie marque nada. Si algún día divergen, es el patrón paralelo que llevamos
// dos meses matando.
//
// ─── Qué la diferencia de un WhatsApp Web ──────────────────────────────────
//
// La capa de acción encima del compositor: qué pasa con este caso, la
// recomendación, y si está quebrado, el motivo y el compositor vacío con su
// explicación. Un WhatsApp Web enseña mensajes; esto enseña mensajes y dice qué
// hacer con ellos.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { MessageCircle, ICON_STROKE } from "../../components/icons";
import { Burbujas } from "../../components/shared/panel-accion-ui";
import type { MensajeWhatsApp } from "../../lib/presupuestos/types";
import type { Conversacion, FiltroBandeja } from "../../lib/mensajeria/conversaciones";
import { ListaConversaciones, BandaSinAsignar, FILTROS } from "./ListaConversaciones";
import { ContextoConversacion } from "./ContextoConversacion";
import { ComposerBandeja } from "./ComposerBandeja";

type RespuestaLista = {
  conversaciones: Conversacion[];
  sinClinica: number;
  accesoDeRed: boolean;
};

type MensajeHilo = {
  id: string;
  contenido: string;
  direccion: "Entrante" | "Saliente";
  timestamp: string;
  autor: string | null;
  sugeridoPorIa: boolean;
  presupuestoId: string | null;
  leadId: string | null;
  pacienteId: string | null;
};

export function MensajeriaView() {
  const { selectedClinicaId, setSelectedClinicaId, clinicas } = useClinic();

  const [filtro, setFiltro] = useState<FiltroBandeja>("pendientes");
  const [lista, setLista] = useState<RespuestaLista | null>(null);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [hilo, setHilo] = useState<MensajeHilo[] | null>(null);
  const [cargandoHilo, setCargandoHilo] = useState(false);
  const [errorHilo, setErrorHilo] = useState<string | null>(null);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    setErrorLista(null);
    try {
      const params = new URLSearchParams({ filtro });
      if (selectedClinicaId) params.set("clinicaId", selectedClinicaId);
      // `cargarJSON` y no `fetch` + `?? []` (§10): una bandeja vacía por un
      // fallo de red es indistinguible de «no hay conversaciones», y la
      // segunda es la que hace que se deje de mirar.
      const d = await cargarJSON<RespuestaLista>(
        `/api/mensajeria/conversaciones?${params.toString()}`,
      );
      setLista(d);
    } catch (e) {
      setErrorLista(mensajeDeError(e));
    } finally {
      setCargandoLista(false);
    }
  }, [filtro, selectedClinicaId]);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  const cargarHilo = useCallback(async (telefono: string) => {
    setCargandoHilo(true);
    setErrorHilo(null);
    try {
      const d = await cargarJSON<{ mensajes: MensajeHilo[] }>(
        `/api/mensajeria/hilo?telefono=${encodeURIComponent(telefono)}`,
      );
      setHilo(d.mensajes);
    } catch (e) {
      setErrorHilo(mensajeDeError(e));
      setHilo(null);
    } finally {
      setCargandoHilo(false);
    }
  }, []);

  useEffect(() => {
    if (abierta) cargarHilo(abierta);
  }, [abierta, cargarHilo]);

  const conversacion = useMemo(
    () => lista?.conversaciones.find((c) => c.telefono === abierta) ?? null,
    [lista, abierta],
  );

  // `Burbujas` espera el tipo del panel de acción. Se adapta aquí en vez de
  // duplicar el componente: es el mismo hilo, pintado igual en los dos sitios.
  const burbujas = useMemo<MensajeWhatsApp[]>(
    () =>
      (hilo ?? []).map((m) => ({
        id: m.id,
        contenido: m.contenido,
        direccion: m.direccion,
        timestamp: m.timestamp,
      })) as MensajeWhatsApp[],
    [hilo],
  );

  const nombreClinica =
    clinicas.find((c) => c.id === selectedClinicaId)?.nombre ?? null;

  return (
    // ─── Por qué hay una altura fija aquí ───────────────────────────────
    //
    // Las tres columnas tienen que hacer scroll CADA UNA por su lado; si no,
    // esto no es una bandeja, es una lista larguísima con un hilo perdido
    // arriba del todo (con 60 conversaciones la página medía 11.000 px).
    //
    // Y para contener el scroll hace falta una altura DEFINIDA, que el layout
    // de (authed) no da: usa `min-h-screen`, que crece con el contenido. Así
    // que se resta la cabecera global, **medida** (102 px), no estimada.
    //
    // Es frágil y conviene saberlo: si la cabecera cambia de alto, este número
    // se queda corto o largo. El arreglo de fondo sería que el layout diera
    // altura definida (`h-dvh`), pero eso afecta a las trece pantallas y no es
    // trabajo de esta.
    <div className="flex h-[calc(100dvh-102px)] min-h-0 flex-col overflow-hidden bg-[var(--color-background)]">
      <header className="shrink-0 px-4 lg:px-6 pt-4 lg:pt-5">
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
          Mensajería
        </h1>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Todas las conversaciones. Para saber qué toca hacer ahora, Seguimiento.
        </p>
        {nombreClinica && (
          <div className="mt-2">
            <AvisoFiltroClinica
              nombre={nombreClinica}
              onVerTodas={() => setSelectedClinicaId(null)}
              ocultaAdemas={
                (lista?.sinClinica ?? 0) > 0
                  ? `${lista!.sinClinica} conversación(es) sin clínica asignada`
                  : undefined
              }
            />
          </div>
        )}

        {/* Pestañas de filtro. La de «Ha respondido el agente» es la razón de
            ser de la pantalla: ninguna herramienta genérica la tiene. */}
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`whitespace-nowrap px-3 py-2 text-sm font-semibold transition-colors ${
                filtro === f.id
                  ? "border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 min-h-0 flex gap-0 px-4 lg:px-6 pb-4 lg:pb-6 pt-3">
        {/* ── Izquierda: la lista ─────────────────────────────────────── */}
        <aside
          className={`flex min-h-0 w-full flex-col overflow-hidden rounded-l-2xl border border-[var(--color-border)] bg-[var(--color-surface)] md:w-80 md:shrink-0 ${
            abierta ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {cargandoLista && !lista ? (
              <div className="p-3">
                <CardListSkeleton />
              </div>
            ) : errorLista ? (
              <div className="p-3">
                <ErrorState
                  detail={`Las conversaciones no están disponibles ahora mismo. ${errorLista}`}
                  onRetry={cargarLista}
                />
              </div>
            ) : (
              <>
                <BandaSinAsignar
                  n={lista?.sinClinica ?? 0}
                  accesoDeRed={lista?.accesoDeRed ?? false}
                />
                {lista && lista.conversaciones.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title={
                        filtro === "agente"
                          ? "El agente todavía no ha contestado nada"
                          : "No hay conversaciones aquí"
                      }
                      hint={
                        filtro === "agente"
                          ? "Aparecerán los mensajes que redacte el agente, los mande él o los mande alguien tal cual."
                          : "Cuando entre o salga un mensaje, aparecerá en esta lista."
                      }
                    />
                  </div>
                ) : (
                  <ListaConversaciones
                    conversaciones={lista?.conversaciones ?? []}
                    seleccionada={abierta}
                    onSeleccionar={setAbierta}
                    mostrarClinica={!selectedClinicaId}
                  />
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── Centro: la conversación ─────────────────────────────────── */}
        <section
          className={`min-h-0 flex-1 flex-col overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-surface)] ${
            abierta ? "flex" : "hidden md:flex"
          }`}
        >
          {!abierta ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <MessageCircle
                  size={20}
                  strokeWidth={ICON_STROKE}
                  className="mx-auto text-[var(--color-muted)]"
                  aria-hidden
                />
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  Elige una conversación para verla entera.
                </p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setAbierta(null)}
                  className="text-sm font-semibold text-[var(--color-accent)] md:hidden"
                >
                  ← Volver
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                    {conversacion?.nombre ?? abierta}
                  </p>
                  {conversacion?.clinicaNombre && (
                    <p className="truncate text-[11px] text-[var(--color-muted)]">
                      {conversacion.clinicaNombre}
                    </p>
                  )}
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {cargandoHilo && !hilo ? (
                  <CardListSkeleton />
                ) : errorHilo ? (
                  <ErrorState
                    detail={`Esta conversación no se pudo cargar. ${errorHilo}`}
                    onRetry={() => abierta && cargarHilo(abierta)}
                  />
                ) : (
                  <Burbujas mensajes={burbujas} />
                )}
              </div>

              {/* La capa de acción y el compositor viven aquí. Enviar desde la
                  bandeja usa las MISMAS rutas que el panel de Seguimiento —no
                  hay una segunda vía de envío—, así que la autoría, el quiebre
                  y la coincidencia se registran igual desde los dos sitios. */}
              <CapaDeAccion conversacion={conversacion} onEnviado={cargarLista} />
            </>
          )}
        </section>

        {/* ── Derecha: el contexto ────────────────────────────────────── */}
        <aside className="hidden min-h-0 w-72 shrink-0 overflow-y-auto rounded-r-2xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:block">
          <ContextoConversacion conversacion={conversacion} />
        </aside>
      </div>
    </div>
  );
}

/** El compositor con su capa de acción. En un archivo aparte cuando crezca; hoy
 *  es el mínimo honesto: si el caso está quebrado, lo dice y no prepara nada. */
function CapaDeAccion({
  conversacion,
  onEnviado,
}: {
  conversacion: Conversacion | null;
  onEnviado: () => void;
}) {
  if (!conversacion) return null;
  return (
    <div className="shrink-0 border-t border-[var(--color-border)]">
      <ComposerBandeja conversacion={conversacion} onEnviado={onEnviado} />
    </div>
  );
}
