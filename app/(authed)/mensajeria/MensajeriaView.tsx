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
import { useSearchParams } from "next/navigation";
import { useClinic } from "../../lib/context/ClinicContext";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { AvisoFiltroClinica } from "../../components/shared/AvisoFiltroClinica";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { CardListSkeleton } from "../../components/ui/Skeleton";
import { MessageCircle, ICON_STROKE } from "../../components/icons";
import type { Conversacion, FiltroBandeja } from "../../lib/mensajeria/conversaciones";
import {
  ListaConversaciones,
  BandaSinAsignar,
  FiltrosBandeja,
  Buscador,
  filtrarPorBusqueda,
  FILTROS,
} from "./ListaConversaciones";
import { ContextoConversacion } from "./ContextoConversacion";
import { ComposerConversacion } from "./ComposerConversacion";
import { useCasoDeConversacion } from "./useCasoDeConversacion";
import { toast } from "sonner";
import { Phone } from "../../components/icons";
import { HiloMensajes, type MensajeHilo } from "./HiloMensajes";

type RespuestaLista = {
  conversaciones: Conversacion[];
  sinClinica: number;
  accesoDeRed: boolean;
  totalDelFiltro: number;
};

export function MensajeriaView() {
  const { selectedClinicaId, setSelectedClinicaId, clinicas } = useClinic();
  const params = useSearchParams();

  // La bandeja se abre desde fuera: la columna «Necesitan persona» de /red
  // enlaza aquí con su filtro y su clínica. Sin esto el clic llevaría a la
  // bandeja sin filtrar y el número de /red no cuadraría con lo que se ve —
  // que es justo lo que la columna promete al ser un enlace.
  const filtroDeUrl = params.get("filtro");
  const [filtro, setFiltro] = useState<FiltroBandeja>(
    FILTROS.some((f) => f.id === filtroDeUrl)
      ? (filtroDeUrl as FiltroBandeja)
      : "pendientes",
  );

  // La clínica de la URL manda sobre la del selector, una sola vez al llegar.
  // Después el selector vuelve a ser el que manda: si no, cambiarlo no haría
  // nada y parecería roto.
  const [busqueda, setBusqueda] = useState("");

  const clinicaDeUrl = params.get("clinicaId");
  useEffect(() => {
    if (clinicaDeUrl && clinicaDeUrl !== selectedClinicaId) {
      setSelectedClinicaId(clinicaDeUrl);
    }
    // Solo al llegar con el parámetro puesto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicaDeUrl]);
  const [lista, setLista] = useState<RespuestaLista | null>(null);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  // B2: «Ver la conversación» desde la ficha de Seguimiento llega con
  // ?telefono= — se abre ese hilo directamente (misma doctrina que ?filtro=:
  // el enlace promete llegar a lo que enlaza). La clave es el string exacto
  // del hilo, que el caller ya tiene de la ficha.
  const telefonoDeUrl = params.get("telefono");
  const [abierta, setAbierta] = useState<string | null>(telefonoDeUrl || null);
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

  // ─── §2 · la conversación abierta NO se deriva de la lista ───────────
  //
  // Antes era `lista.conversaciones.find(...)`. Al cambiar de pestaña, la nueva
  // lista podía no contenerla y quedaba `null`: el hilo seguía abierto pero
  // perdía el nombre (caía al teléfono) y el panel derecho se vaciaba. **La
  // misma persona con dos nombres según la pestaña.**
  //
  // Ahora la conversación abierta tiene su propio estado y sobrevive al cambio
  // de filtro. Se ACTUALIZA si la nueva lista la trae —para que el contador de
  // pendientes o el quiebre no se queden viejos— pero nunca se borra por no
  // estar. Cerrar el hilo al cambiar de filtro sería la otra salida, y castiga
  // el gesto normal de mirar lo mismo desde otro contexto.
  const [conversacion, setConversacion] = useState<Conversacion | null>(null);

  useEffect(() => {
    if (!abierta) {
      setConversacion(null);
      return;
    }
    const enLista = lista?.conversaciones.find((c) => c.telefono === abierta);
    if (enLista) setConversacion(enLista);
  }, [lista, abierta]);

  // El caso se pide UNA vez y lo comparten las dos columnas: la derecha para
  // contar qué pasa, el compositor para el borrador y el envío. Dos peticiones
  // serían dos verdades sobre el mismo caso.
  const {
    caso,
    cargando: cargandoCaso,
    error: errorCaso,
    recargar: recargarCaso,
  } = useCasoDeConversacion(conversacion);

  // Llamar es una acción sobre la PERSONA, así que vive en la cabecera de la
  // conversación, no en el cuerpo. Se registra por el camino central de
  // siempre — el mismo `registrar-respuesta` que usa el panel de Seguimiento —
  // para que una llamada hecha desde aquí cuente igual que una hecha desde allí.
  const [llamando, setLlamando] = useState(false);
  async function llamar() {
    if (!conversacion || llamando) return;
    setLlamando(true);
    window.open(`tel:${conversacion.telefono}`, "_self");
    try {
      if (conversacion.presupuestoId) {
        const res = await fetch("/api/presupuestos/intervencion/registrar-respuesta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presupuestoId: conversacion.presupuestoId,
            tipo: "Llamada realizada",
          }),
        });
        if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
        toast.success(`Llamada registrada · ${conversacion.nombre}`);
        recargarCaso();
        cargarLista();
      } else {
        // Sin caso no hay dónde registrarla. Se dice, en vez de dar por hecho
        // que quedó anotada: una llamada que nadie registró es una llamada que
        // el equipo repetirá.
        toast.info("Llamada abierta — sin caso asociado, no queda registrada");
      }
    } catch (e) {
      toast.error(`La llamada no se pudo registrar. ${mensajeDeError(e)}`);
    } finally {
      setLlamando(false);
    }
  }

  // El buscador filtra sobre lo ya cargado: la lista viene acotada, así que es
  // inmediato y no gasta una consulta por tecla.
  const visibles = useMemo(
    () => filtrarPorBusqueda(lista?.conversaciones ?? [], busqueda),
    [lista, busqueda],
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

      </header>

      <div className="flex-1 min-h-0 flex gap-4 px-4 lg:px-6 pb-4 lg:pb-6 pt-3">
        {/* ── Izquierda: la lista ─────────────────────────────────────── */}
        <aside
          className={`flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] md:w-80 md:shrink-0 ${
            abierta ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="shrink-0 border-b border-[var(--color-border)]">
            <Buscador valor={busqueda} onCambiar={setBusqueda} />
            <FiltrosBandeja activo={filtro} onCambiar={setFiltro} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pt-2">
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
                {lista && visibles.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title={
                        busqueda.trim()
                          ? "Nadie con ese nombre ni ese teléfono"
                          : filtro === "agente"
                            ? "El agente todavía no ha contestado nada"
                            : "No hay conversaciones aquí"
                      }
                      hint={
                        busqueda.trim()
                          ? "Prueba con menos letras, o quita el filtro."
                          : filtro === "agente"
                            ? "Aparecerán los mensajes que redacte el agente, los mande él o los mande alguien tal cual."
                            : "Cuando entre o salga un mensaje, aparecerá en esta lista."
                      }
                    />
                  </div>
                ) : (
                  <>
                    <ListaConversaciones
                      conversaciones={visibles}
                      seleccionada={abierta}
                      onSeleccionar={setAbierta}
                      mostrarClinica={!selectedClinicaId}
                    />
                    {/* Un tope que no se declara se lee como «esto es todo lo
                        que hay». La lista es acotada a propósito, pero decirlo
                        es la diferencia entre acotada y engañosa. */}
                    {lista && !busqueda.trim() && lista.totalDelFiltro > lista.conversaciones.length && (
                      <p className="border-t border-[var(--color-border)] px-3 py-2.5 text-[11px] text-[var(--color-muted)]">
                        Se enseñan las {lista.conversaciones.length} más recientes de{" "}
                        {lista.totalDelFiltro}. Afina con el filtro o con la clínica.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── Centro: la conversación ─────────────────────────────────── */}
        <section
          className={`min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] ${
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                    {conversacion?.nombre ?? abierta}
                  </p>
                  {conversacion?.clinicaNombre && (
                    <p className="truncate text-[11px] text-[var(--color-muted)]">
                      {conversacion.clinicaNombre}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={llamar}
                  disabled={llamando}
                  title={`Llamar a ${conversacion?.nombre ?? ""}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                >
                  <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Llamar
                </button>
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
                  <HiloMensajes mensajes={hilo ?? []} />
                )}
              </div>

              {/* La capa de acción y el compositor viven aquí. Enviar desde la
                  bandeja usa las MISMAS rutas que el panel de Seguimiento —no
                  hay una segunda vía de envío—, así que la autoría, el quiebre
                  y la coincidencia se registran igual desde los dos sitios. */}
              {conversacion && (
                <ComposerConversacion
                  conversacion={conversacion}
                  caso={caso}
                  recargarCaso={recargarCaso}
                  onEnviado={cargarLista}
                  ultimoEntrante={
                    [...(hilo ?? [])].reverse().find((m) => m.direccion === "Entrante")
                      ?.contenido ?? null
                  }
                />
              )}
            </>
          )}
        </section>

        {/* ── Derecha: el contexto ────────────────────────────────────── */}
        <aside className="hidden min-h-0 w-72 shrink-0 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:block">
          {/* B2: la ficha del caso sustituye al resumen viejo; el `caso` del
              clasificador sigue alimentando SOLO al compositor (borrador). */}
          <ContextoConversacion
            conversacion={conversacion}
            onCambio={() => {
              recargarCaso();
              void cargarLista();
            }}
          />
        </aside>
      </div>
    </div>
  );
}
