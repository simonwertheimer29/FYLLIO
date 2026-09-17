"use client";

// PROPONER HORAS Y QUE EL PACIENTE ELIJA (17-09, 060 — cambio de flujo del
// paso 3 dictado por Simon). Nada se reserva hasta que acepta: la
// coordinadora elige horas (las tres que cumplen lo que pidió, o cualquiera
// navegando la agenda), pulsa enviar, y cuando el paciente contesta reserva
// de UN CLIC. No escribe ni una palabra: todos los textos son de código y se
// ven ENTEROS antes de pulsar.
//
// Lo que compone este panel viene de la ficha (`ficha.oferta`, con el
// vencimiento ya aplicado) y de tres rutas que solo traducen a HTTP la
// lógica de lib/agenda/ofertas.ts: /api/agente/oferta (enviar / previsualizar),
// /api/agente/oferta/reservar (el clic) y /api/agente/oferta/sin-huecos.
// Estados: sin propuesta → SELECTOR · abierta → esperando · elegida →
// RESERVAR · caducada → reofertar · elección tardía → comprobar y reservar.
// Si al reservar la hora se ocupó, el servidor devuelve el mensaje corregido
// ya escrito y aquí solo se enseña y se envía.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { fechaCorta } from "../../lib/agenda/fechas";
import { nombreCortoDoctor } from "../../lib/agenda/nombres";
import { AlertTriangle, CalendarDays, ICON_STROKE } from "../icons";
import type { RespuestaHuecos, HuecoDelCaso } from "../../lib/agenda/huecos-del-caso";
import type { OfertaDeLaFicha } from "../../lib/agente/ficha-caso";

type Respuesta = Omit<RespuestaHuecos, "huecos"> & {
  huecos: HuecoDelCaso[];
  lead: { id: string; nombre: string };
};

type Variante = { tipo: "oferta" } | { tipo: "se_ocupo"; ocupada: HuecoDelCaso } | { tipo: "todas_ocupadas" };

const MAX = 4;
const clave = (h: Pick<HuecoDelCaso, "fecha" | "hora" | "doctorId">) => `${h.fecha}|${h.hora}|${h.doctorId}`;
const legible = (h: HuecoDelCaso) => `${fechaCorta(h.fecha)} · ${h.hora} · ${nombreCortoDoctor(h.doctorNombre)}`;
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const diaHoraDe = (iso: string) => new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).replace(",", "");
const sumaDiasISO = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });

const btnPrimario =
  "flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50";
const btnEnlace = "text-[12px] font-medium text-[var(--color-accent)] hover:underline disabled:opacity-50";

export function OfertaPanel({ telefono, oferta, onHecho }: { telefono: string; oferta: OfertaDeLaFicha | null; onHecho: () => void }) {
  // Lo que se le puede mandar YA ESCRITO cuando la hora elegida se ocupó.
  const [corregido, setCorregido] = useState<{ texto: string; restantes: HuecoDelCaso[]; variante: "se_ocupo" | "todas_ocupadas" | "sin_huecos"; ocupada: HuecoDelCaso } | null>(null);
  const [reofertando, setReofertando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [indiceManual, setIndiceManual] = useState<number | null>(null);
  // Punto 5 del encargo: los huecos NO van fijos en la ficha; se despliegan al
  // pulsar «Proponer horas».
  const [proponiendo, setProponiendo] = useState(false);

  useEffect(() => {
    setCorregido(null);
    setReofertando(false);
    setIndiceManual(null);
    setGuardando(false); // una ficha recargada no hereda un «en marcha» viejo
    setProponiendo(false);
  }, [oferta?.id, oferta?.estado, oferta?.eleccion]);

  async function reservar(indice: number | null) {
    if (guardando) return;
    setGuardando(true);
    try {
      const r = await cargarJSON<{
        ok: boolean;
        motivo?: string;
        alternativa?: HuecoDelCaso;
        confirmacion?: { ok: boolean; simulado?: boolean; mensaje?: string };
        texto?: string;
        restantes?: HuecoDelCaso[];
        variante?: "se_ocupo" | "todas_ocupadas" | "sin_huecos";
        ocupada?: HuecoDelCaso;
      }>(`/api/agente/oferta/reservar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefono, indice }) });
      if (r.ok && r.alternativa) {
        const c = r.confirmacion;
        if (c?.ok) toast.success(c.simulado ? `Cita reservada y confirmación registrada (hilo simulado) — ${legible(r.alternativa)}` : `Cita reservada y confirmada al paciente — ${legible(r.alternativa)}`);
        else toast.error(`La cita está reservada, pero la confirmación no salió: ${c?.mensaje ?? "sin detalle"}`);
        onHecho();
      }
    } catch (e: unknown) {
      const cuerpo = (e as { cuerpo?: Record<string, unknown> })?.cuerpo ?? null;
      if (cuerpo && cuerpo["motivo"] === "ocupado" && typeof cuerpo["texto"] === "string") {
        setCorregido({
          texto: cuerpo["texto"] as string,
          restantes: (cuerpo["restantes"] as HuecoDelCaso[]) ?? [],
          variante: cuerpo["variante"] as "se_ocupo" | "todas_ocupadas" | "sin_huecos",
          ocupada: cuerpo["ocupada"] as HuecoDelCaso,
        });
      } else {
        toast.error(mensajeDeError(e));
      }
    } finally {
      setGuardando(false);
    }
  }

  async function enviarSinHuecos(texto: string) {
    if (guardando) return;
    setGuardando(true);
    try {
      const r = await cargarJSON<{ ok: true; simulado: boolean }>(`/api/agente/oferta/sin-huecos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefono, texto }) });
      toast.success(r.simulado ? "Aviso registrado (hilo simulado). El caso vuelve a ti en cuanto abra la clínica." : "Aviso enviado. El caso vuelve a ti en cuanto abra la clínica.");
      onHecho();
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  // ── El mensaje corregido tras un clic que llegó tarde ──
  if (corregido) {
    if (corregido.variante === "sin_huecos") {
      return (
        <Caja tono="warning" titulo={`${legible(corregido.ocupada)} se acaba de ocupar y no hay otras horas en los próximos días. No se ha enviado nada.`}>
          <Mensaje texto={corregido.texto} />
          <button type="button" disabled={guardando} onClick={() => void enviarSinHuecos(corregido.texto)} className={`${btnPrimario} mt-2`}>
            {guardando ? "Enviando…" : "Avisarle y quedármelo"}
          </button>
          <button type="button" onClick={() => { setCorregido(null); setReofertando(true); }} className={`${btnEnlace} mt-2`}>
            Buscar horas en toda la agenda
          </button>
        </Caja>
      );
    }
    return (
      <Selector
        telefono={telefono}
        inicial={corregido.restantes}
        variante={corregido.variante === "se_ocupo" ? { tipo: "se_ocupo", ocupada: corregido.ocupada } : { tipo: "todas_ocupadas" }}
        aviso={`${legible(corregido.ocupada)} se acaba de ocupar. No se ha enviado nada: este es el mensaje corregido.`}
        onEnviado={onHecho}
        onCancelar={() => setCorregido(null)}
      />
    );
  }

  // ── Sin propuesta (o ya cerrada) → el selector ──
  const cerrada = !oferta || oferta.estado === "reservada" || oferta.estado === "reemplazada";
  if (cerrada && !reofertando && !proponiendo) {
    return (
      <button type="button" onClick={() => setProponiendo(true)} className={btnPrimario}>
        <CalendarDays size={14} strokeWidth={ICON_STROKE} aria-hidden />
        Proponer horas
      </button>
    );
  }
  if (cerrada || reofertando) {
    return (
      <Selector
        telefono={telefono}
        inicial={reofertando && oferta ? oferta.alternativas : []}
        variante={{ tipo: "oferta" }}
        aviso={reofertando && oferta ? "Propuesta nueva: sustituye a la anterior. Las horas de la lista se vuelven a comprobar al enviar." : null}
        onEnviado={onHecho}
        onCancelar={() => { setReofertando(false); setProponiendo(false); }}
      />
    );
  }

  // ── Abierta: esperando ──
  if (oferta.estado === "abierta") {
    return (
      <Caja tono="neutro" titulo={`Horas propuestas el ${diaHoraDe(oferta.enviadaEnISO)} · esperando su respuesta`}>
        <Mensaje texto={oferta.texto} />
        <p className="mt-1.5 text-[11.5px] text-[var(--color-muted)]">Si no contesta, la propuesta caduca el {diaHoraDe(oferta.caducaEnISO)} y el caso vuelve a ti para proponer otras.</p>
        <button type="button" onClick={() => setReofertando(true)} className={`${btnEnlace} mt-2`}>Cambiar la propuesta</button>
      </Caja>
    );
  }

  // ── Caducada sin respuesta: reofertar ──
  if (oferta.estado === "caducada" && oferta.eleccion == null && !oferta.eleccionEnISO) {
    return (
      <Caja tono="warning" titulo={`La propuesta del ${diaHoraDe(oferta.enviadaEnISO)} caducó sin respuesta.`}>
        <button type="button" onClick={() => setReofertando(true)} className={`${btnPrimario} mt-1`}>
          <CalendarDays size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Volver a proponer horas
        </button>
      </Caja>
    );
  }

  // ── Elegida (a tiempo o tarde): reservar de un clic ──
  const elegida = oferta.eleccion != null ? oferta.alternativas[oferta.eleccion] ?? null : null;
  const tardia = oferta.estado === "caducada" || oferta.eleccionTardia;
  const titulo = elegida
    ? tardia
      ? `Contestó tarde (${oferta.eleccionEnISO ? diaHoraDe(oferta.eleccionEnISO) : ""}) a una propuesta caducada: eligió ${oferta.eleccion! + 1}) ${legible(elegida)}. Se comprueba al reservar.`
      : `Eligió ${oferta.eleccion! + 1}) ${legible(elegida)}`
    : "Contestó a la propuesta pero no consta cuál eligió. Léelo en el chat y elige tú:";
  return (
    <Caja tono={tardia ? "warning" : "accent"} titulo={titulo}>
      {!elegida && (
        <ul className="mt-1.5 grid gap-1.5">
          {oferta.alternativas.map((h, i) => (
            <li key={clave(h)}>
              <Opcion activa={indiceManual === i} onClick={() => setIndiceManual(i === indiceManual ? null : i)} h={h} n={i + 1} />
            </li>
          ))}
        </ul>
      )}
      {oferta.acuseEnviadoEnISO && (
        <p className="mt-1.5 text-[11.5px] text-[var(--color-muted)]">A las {horaDe(oferta.acuseEnviadoEnISO)} se le contestó que lo estábamos comprobando.</p>
      )}
      <button
        type="button"
        disabled={guardando || (!elegida && indiceManual == null)}
        onClick={() => void reservar(elegida ? null : indiceManual)}
        className={`${btnPrimario} mt-2`}
      >
        <CalendarDays size={14} strokeWidth={ICON_STROKE} aria-hidden />
        {(() => {
          // El botón dice lo que HACE, con la hora (visto por Simon el 17-09:
          // un «Comprobando…» gris le dice que espere, y lo que tiene que
          // hacer es actuar). Solo mientras la petición está en vuelo cambia.
          const cual = elegida ?? (indiceManual != null ? oferta.alternativas[indiceManual] ?? null : null);
          const hora = cual ? `${fechaCorta(cual.fecha)} a las ${cual.hora}` : "la hora elegida";
          if (guardando) return `Reservando ${hora}…`;
          return tardia ? `Comprobar y reservar ${hora}` : `Reservar ${hora} y confirmar`;
        })()}
      </button>
      <button type="button" onClick={() => setReofertando(true)} className={`${btnEnlace} mt-2`}>Proponer otras horas</button>
    </Caja>
  );
}

// ─── El selector: acumula horas, enseña el mensaje entero, envía ────────────

function Selector({
  telefono,
  inicial,
  variante,
  aviso,
  onEnviado,
  onCancelar,
}: {
  telefono: string;
  inicial: HuecoDelCaso[];
  variante: Variante;
  aviso: string | null;
  onEnviado: () => void;
  onCancelar: (() => void) | null;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tratamientoId, setTratamientoId] = useState<string | null>(null);
  const [todosLosDoctores, setTodosLosDoctores] = useState(false);
  const [seleccion, setSeleccion] = useState<HuecoDelCaso[]>(inicial);
  const [agenda, setAgenda] = useState<{ desde: string; huecos: HuecoDelCaso[] } | null>(null);
  const [cargandoAgenda, setCargandoAgenda] = useState(false);
  const [texto, setTexto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [ocupadas, setOcupadas] = useState<HuecoDelCaso[]>([]);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ telefono });
      if (tratamientoId) qs.set("tratamientoId", tratamientoId);
      if (todosLosDoctores) qs.set("doctorId", "todos");
      const d = await cargarJSON<Respuesta>(`/api/agente/huecos?${qs.toString()}`);
      setDatos(d);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, [telefono, tratamientoId, todosLosDoctores]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const tratamientoEfectivo = datos?.tratamiento?.id ?? null;

  const cargarAgenda = useCallback(
    async (desde: string) => {
      setCargandoAgenda(true);
      try {
        const qs = new URLSearchParams({ telefono, todos: "1", desde, dias: "7", doctorId: "todos" });
        if (tratamientoEfectivo) qs.set("tratamientoId", tratamientoEfectivo);
        const d = await cargarJSON<Respuesta>(`/api/agente/huecos?${qs.toString()}`);
        setAgenda({ desde, huecos: d.huecos });
      } catch (e) {
        toast.error(mensajeDeError(e));
      } finally {
        setCargandoAgenda(false);
      }
    },
    [telefono, tratamientoEfectivo],
  );

  // El texto EXACTO que saldría, del servidor, cada vez que cambia la lista.
  useEffect(() => {
    let vivo = true;
    if (seleccion.length === 0) {
      setTexto(null);
      return;
    }
    void cargarJSON<{ texto: string }>(`/api/agente/oferta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono, alternativas: seleccion, tratamientoId: tratamientoEfectivo, variante, previsualizar: true }),
    })
      .then((r) => vivo && setTexto(r.texto))
      .catch((e) => vivo && toast.error(mensajeDeError(e)));
    return () => {
      vivo = false;
    };
    // `variante` es un objeto nuevo en cada render del padre; su tipo basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefono, seleccion, tratamientoEfectivo, variante.tipo]);

  const seleccionadas = useMemo(() => new Set(seleccion.map(clave)), [seleccion]);
  const ocupadasSet = useMemo(() => new Set(ocupadas.map(clave)), [ocupadas]);

  function alternar(h: HuecoDelCaso) {
    setOcupadas([]);
    setSeleccion((s) => {
      if (s.some((x) => clave(x) === clave(h))) return s.filter((x) => clave(x) !== clave(h));
      if (s.length >= MAX) {
        toast.error(`Como mucho ${MAX} horas por mensaje: más es marear al paciente.`);
        return s;
      }
      return [...s, h].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
    });
  }

  async function enviar() {
    if (!datos || !texto || guardando) return;
    setGuardando(true);
    try {
      const r = await cargarJSON<{ ok: true; simulado: boolean }>(`/api/agente/oferta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, alternativas: seleccion, tratamientoId: tratamientoEfectivo, variante, texto }),
      });
      toast.success(r.simulado ? "Propuesta registrada (hilo simulado). Cuando conteste, la reservas de un clic." : "Propuesta enviada. Cuando conteste, la reservas de un clic.");
      onEnviado();
    } catch (e: unknown) {
      const cuerpo = (e as { cuerpo?: Record<string, unknown> })?.cuerpo ?? null;
      if (cuerpo && cuerpo["motivo"] === "ocupadas" && Array.isArray(cuerpo["ocupadas"])) {
        const oc = cuerpo["ocupadas"] as HuecoDelCaso[];
        setOcupadas(oc);
        setSeleccion((s) => s.filter((x) => !oc.some((o) => clave(o) === clave(x))));
        toast.error("Alguna hora se acaba de ocupar. No se ha enviado nada: se ha quitado de la lista.");
      } else {
        toast.error(mensajeDeError(e));
      }
    } finally {
      setGuardando(false);
    }
  }

  if (error) {
    return (
      <p className="text-[12.5px] text-[var(--color-danger)]">
        No se pudieron calcular los huecos: {error}{" "}
        <button type="button" onClick={() => void cargar()} className="font-medium underline">Reintentar</button>
      </p>
    );
  }
  if (!datos) return <div className="fyllio-skeleton h-20" />;
  const g = datos.garantia;
  const nombre = datos.lead.nombre.split(" ")[0];

  return (
    <div className="space-y-2">
      {aviso && (
        <p className="flex items-start gap-1.5 text-[12px] text-amber-800 dark:text-amber-200">
          <AlertTriangle size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
          <span>{aviso}</span>
        </p>
      )}
      <p className={`text-[12px] ${g.frescura === "en_vivo" ? "text-[var(--color-success,#1f7a4d)]" : "text-amber-700 dark:text-amber-300"}`}>{g.texto}</p>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-muted)]">
        <label className="flex items-center gap-1.5">
          Tipo de cita
          <select
            value={datos.tratamiento?.id ?? ""}
            onChange={(e) => { setTratamientoId(e.target.value || null); setAgenda(null); }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[12px] text-[var(--color-foreground)]"
          >
            <option value="">— elegir —</option>
            {datos.catalogo.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre} · {t.duracionMin} min</option>
            ))}
          </select>
        </label>
        {datos.doctorFiltrado && !todosLosDoctores && (
          <button type="button" onClick={() => setTodosLosDoctores(true)} className="underline">
            solo {nombreCortoDoctor(datos.doctorFiltrado.nombre)} · ver todos
          </button>
        )}
      </div>

      {datos.nota && <p className="text-[12px] text-[var(--color-muted)]">{datos.nota}</p>}
      {datos.huecos.length > 0 && (
        <p className="text-[12px] text-[var(--color-muted)]">Marca las horas que quieras proponerle (hasta {MAX}); el mensaje se compone solo.</p>
      )}
      {datos.doctorFueraDeClinica && <p className="text-[12px] text-[var(--color-muted)]">El doctor asignado ({nombreCortoDoctor(datos.doctorFueraDeClinica)}) es de otra clínica: se ofrecen los de esta.</p>}

      {/* Las que cumplen lo que pidió. */}
      {datos.huecos.length > 0 && (
        <ul className="grid gap-1.5">
          {datos.huecos.map((h) => (
            <li key={clave(h)}>
              <Opcion casilla activa={seleccionadas.has(clave(h))} ocupada={ocupadasSet.has(clave(h))} onClick={() => alternar(h)} h={h} />
            </li>
          ))}
        </ul>
      )}

      {/* Toda la agenda, por semanas. */}
      {!agenda ? (
        <button type="button" disabled={cargandoAgenda || !tratamientoEfectivo} onClick={() => void cargarAgenda(hoyISO())} className={btnEnlace}>
          {cargandoAgenda ? "Cargando…" : "Ver más horas en la agenda"}
        </button>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] p-2">
          <div className="flex items-center justify-between text-[12px] text-[var(--color-muted)]">
            <button type="button" disabled={cargandoAgenda || agenda.desde <= hoyISO()} onClick={() => void cargarAgenda(sumaDiasISO(agenda.desde, -7))} className={btnEnlace}>← semana anterior</button>
            <span>{fechaCorta(agenda.desde)} – {fechaCorta(sumaDiasISO(agenda.desde, 6))}</span>
            <button type="button" disabled={cargandoAgenda} onClick={() => void cargarAgenda(sumaDiasISO(agenda.desde, 7))} className={btnEnlace}>semana siguiente →</button>
          </div>
          {agenda.huecos.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-[var(--color-muted)]">Sin huecos esta semana.</p>
          ) : (
            <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {Object.entries(
                agenda.huecos.reduce<Record<string, HuecoDelCaso[]>>((acc, h) => {
                  (acc[h.fecha] ??= []).push(h);
                  return acc;
                }, {}),
              ).map(([fecha, hs]) => (
                <div key={fecha}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{fechaCorta(fecha)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {hs.map((h) => (
                      <button
                        key={clave(h)}
                        type="button"
                        onClick={() => alternar(h)}
                        title={nombreCortoDoctor(h.doctorNombre)}
                        className={`rounded-md border px-2 py-0.5 text-[12px] transition-colors ${
                          seleccionadas.has(clave(h))
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-foreground)]"
                            : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                        }`}
                      >
                        {h.hora} <span className="text-[var(--color-muted)]">{nombreCortoDoctor(h.doctorNombre)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* La lista que va en el mensaje, y el mensaje ENTERO antes del clic.
          Siempre a la vista, también vacía: es el sitio donde se ve qué se va a
          mandar y el botón que lo manda. */}
      {(
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {seleccion.length === 0 ? `Propuesta para ${nombre}: ninguna hora marcada` : `${seleccion.length} de ${MAX} · lo que recibirá ${nombre} por WhatsApp`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {seleccion.map((h, i) => (
              <li key={clave(h)} className="flex items-center justify-between text-[12px] text-[var(--color-foreground)]">
                <span>{i + 1}) {legible(h)}</span>
                <button type="button" onClick={() => alternar(h)} className="text-[var(--color-muted)] hover:underline">quitar</button>
              </li>
            ))}
          </ul>
          {seleccion.length > 0 && (texto ? <Mensaje texto={texto} /> : <div className="fyllio-skeleton mt-1.5 h-10" />)}
          <button type="button" disabled={guardando || seleccion.length === 0 || !texto || !g.puedeReservar} onClick={() => void enviar()} className={`${btnPrimario} mt-2`}>
            {guardando ? "Enviando…" : seleccion.length === 0 ? "Enviar la propuesta (marca alguna hora)" : `Enviar la propuesta con ${seleccion.length} ${seleccion.length === 1 ? "hora" : "horas"}`}
          </button>
          {!g.puedeReservar && <p className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-300">Sin la agenda en Fyllio no se proponen horas como reales.</p>}
        </div>
      )}
      {onCancelar && (
        <button type="button" onClick={onCancelar} className={btnEnlace}>Cerrar sin enviar</button>
      )}
    </div>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

function Opcion({ h, n, activa, ocupada, casilla, onClick }: { h: HuecoDelCaso; n?: number; activa: boolean; ocupada?: boolean; casilla?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupada}
      role={casilla ? "checkbox" : undefined}
      aria-checked={casilla ? activa : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-50 ${
        activa
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-foreground)]"
          : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        {casilla && (
          <span
            aria-hidden
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
              activa ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"
            }`}
          >
            {activa ? "✓" : ""}
          </span>
        )}
        {n != null ? `${n}) ` : ""}{fechaCorta(h.fecha)} · {h.hora}
      </span>
      <span className="text-[var(--color-muted)]">{ocupada ? "se ocupó" : nombreCortoDoctor(h.doctorNombre)}</span>
    </button>
  );
}

function Mensaje({ texto }: { texto: string }) {
  return <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-[var(--color-surface)] px-2.5 py-2 text-[12.5px] text-[var(--color-foreground)]">{texto}</p>;
}

function Caja({ tono, titulo, children }: { tono: "neutro" | "accent" | "warning"; titulo: string; children: React.ReactNode }) {
  const borde =
    tono === "warning"
      ? "border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10"
      : tono === "accent"
        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
        : "border-[var(--color-border)]";
  return (
    <div className={`rounded-lg border p-3 ${borde}`}>
      <p className="text-[12.5px] font-medium text-[var(--color-foreground)]">{titulo}</p>
      {children}
    </div>
  );
}
