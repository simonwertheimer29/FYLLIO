"use client";

// FASE D — CONFIGURACIÓN DEL AGENTE. Por ahora, el grupo 2 (QUÉ SABE EL
// AGENTE): es el único que cambia lo que el agente DICE — con esto cargado
// pasa de aplazar a contestar. Los grupos 1, 3, 4 y 5 se añaden aquí, en
// esta misma pantalla, en el orden del onboarding.
//
// TRES REGLAS DE ESTA PANTALLA (dictadas, PLAN §6):
//   · Cada campo enseña su CONSECUENCIA, no una advertencia: la clínica está
//     decidiendo cuánto trabajo hace la máquina y cuánto su coordinadora.
//   · El BARRIDO de arriba se DERIVA de la config (capacidadesDe, código
//     puro) — jamás se le pregunta al modelo qué cree que puede hacer. En
//     positivo y EN NEGATIVO; los límites del producto, aparte.
//   · El PROMPT es visible: el bloque se calcula con LA MISMA función que
//     usa el evaluador (renderConocimiento) sobre lo que hay en el
//     formulario — lo que lees es lo que entra.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useClinic } from "../../../lib/context/ClinicContext";
import { cargarJSON, mensajeDeError } from "../../../lib/fetch-json";
import { ErrorState } from "../../../components/ui/Feedback";
import {
  Sparkles,
  Check,
  X,
  Plus,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Lock,
  ICON_STROKE,
} from "../../../components/icons";
import {
  capacidadesDe,
  renderConocimiento,
  horarioLegible,
  REGLAS_DURAS,
  SUGERENCIAS_TRATAMIENTOS,
  SUGERENCIAS_POLITICAS,
  type ConocimientoClinica,
} from "../../../lib/agente/conocimiento";

type RespuestaConfig = {
  conocimiento: ConocimientoClinica;
  evaluadorActivo: boolean;
  toquesAntesDeAgotar: number;
  bloquePrompt: string;
  systemPrompt: string;
};

type Cadencia = {
  clinica: string;
  secuenciaDias: number[];
  recordatorioMax: number;
  horaEnvio: string;
  diasRechazoAuto: number;
  activa: boolean;
};

export function AgenteConfigView() {
  const { selectedClinicaId, clinicas, session } = useClinic();
  const [config, setConfig] = useState<ConocimientoClinica | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [evaluadorActivo, setEvaluadorActivo] = useState(false);
  const [toques, setToques] = useState(3);
  // Grupo 5 — la cadencia vive en SU config por clínica (secuencia 3/7/10,
  // hora, tope) y se edita aquí porque es la misma decisión que los plazos:
  // cómo perseguimos un presupuesto. `secuenciaTexto` es el campo editable.
  const [cadencia, setCadencia] = useState<Cadencia | null>(null);
  const [secuenciaTexto, setSecuenciaTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [verPrompt, setVerPrompt] = useState(false);
  const [verSystem, setVerSystem] = useState(false);

  const nombreClinica =
    clinicas.find((c) => c.id === selectedClinicaId)?.nombre ?? null;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = selectedClinicaId ? `?clinicaId=${encodeURIComponent(selectedClinicaId)}` : "";
      const d = await cargarJSON<RespuestaConfig>(`/api/agente/configuracion${params}`);
      setConfig(d.conocimiento);
      setSystemPrompt(d.systemPrompt);
      setEvaluadorActivo(d.evaluadorActivo);
      setToques(d.toquesAntesDeAgotar);
      // La cadencia es POR CLÍNICA (no hay fila de red): solo con una elegida.
      const nombre = clinicas.find((c) => c.id === selectedClinicaId)?.nombre ?? null;
      if (nombre) {
        const r = await cargarJSON<{ configuracion: Cadencia }>(
          `/api/presupuestos/recordatorios/configuracion?clinica=${encodeURIComponent(nombre)}`,
        );
        setCadencia({ ...r.configuracion, clinica: nombre });
        setSecuenciaTexto(r.configuracion.secuenciaDias.join(", "));
      } else {
        setCadencia(null);
      }
    } catch (e) {
      // Conservar lo último bueno + error honesto (§10): el formulario no se
      // vacía — vaciarlo y dejar guardar PISARÍA la config que no se pudo leer.
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [selectedClinicaId, clinicas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    if (!config || guardando) return;
    setGuardando(true);
    try {
      // Las filas COMPLETAMENTE vacías (un «añadir» que quedó sin rellenar)
      // se quitan antes de guardar: no son datos, son huecos del formulario.
      // Una fila a medias (precio sin nombre, política sin texto) NO se
      // quita — el 422 con su motivo es la respuesta honesta.
      const limpio: ConocimientoClinica = {
        ...config,
        tratamientos: config.tratamientos.filter((t) => t.nombre.trim() || t.precio || t.nota),
        politicas: config.politicas.filter((p) => p.titulo.trim() || p.texto.trim()),
        enlaces: config.enlaces.filter((e) => e.etiqueta.trim() || e.url.trim()),
      };
      await cargarJSON("/api/agente/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: selectedClinicaId, conocimiento: limpio, toquesAntesDeAgotar: toques }),
      });
      setConfig(limpio);
      // Grupo 5 — la cadencia va a SU API (por nombre de clínica). Se guarda
      // en la misma acción: para la clínica es UNA decisión, no dos pantallas.
      if (cadencia) {
        const dias = secuenciaTexto
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (dias.length === 0) {
          toast.error("La secuencia de la cadencia necesita al menos un día (p. ej. «3, 7, 10»)");
          return;
        }
        await cargarJSON("/api/presupuestos/recordatorios/configuracion", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...cadencia, secuenciaDias: dias }),
        });
        setCadencia({ ...cadencia, secuenciaDias: dias });
        setSecuenciaTexto(dias.join(", "));
      }
      toast.success("Configuración guardada — el agente la usa desde el próximo mensaje");
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  // El barrido y el bloque, EN VIVO sobre el formulario: la lista cambia
  // mientras escribes, que es como la clínica ve la consecuencia.
  const barrido = useMemo(() => (config ? capacidadesDe(config) : null), [config]);
  const bloque = useMemo(() => (config ? renderConocimiento(config).join("\n") : ""), [config]);

  if (session.rol !== "admin") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-[var(--color-muted)]">
          La configuración del agente la gestiona la administración de la red.
        </p>
      </div>
    );
  }

  return (
    // El contenedor exterior (padding de página) lo pone AgenteView — esta
    // vista vive siempre dentro de su pestaña.
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="font-display flex items-center gap-2 text-xl font-semibold text-[var(--color-foreground)]">
          <Sparkles size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          Configuración del agente
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
          {nombreClinica ? `Para ${nombreClinica}` : "Para toda la red (las clínicas sin configuración propia usan esta)"}
          {" · "}
          {evaluadorActivo
            ? "el agente está encendido y usa esta configuración"
            : "déjalo todo configurado ya — en cuanto se encienda el agente, empieza a usarlo"}
        </p>
      </header>

      {error && (
        <ErrorState detail={`La configuración no se pudo cargar. ${error}`} onRetry={cargar} />
      )}
      {cargando && !config && !error && (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      )}

      {config && barrido && (
        <>
          {/* ── EL BARRIDO: qué puede hacer con ESTA configuración ────── */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">
              Con esta configuración, tu agente…
            </h2>
            <ul className="mt-2.5 space-y-1.5">
              {barrido.puede.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] text-[var(--color-foreground)]">
                  <Check size={15} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-success)]" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
              {barrido.noPuede.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] text-[var(--color-muted)]">
                  <X size={15} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-danger)]" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-[var(--color-border)] pt-2.5">
              {barrido.limites.map((l) => (
                <p key={l} className="flex gap-2 text-[12px] text-[var(--color-muted)]">
                  <ShieldCheck size={14} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{l}</span>
                </p>
              ))}
            </div>
          </section>

          {/* ── GRUPO 1 · Quiénes sois — lo primero del onboarding: lo que
              cualquiera sabe contestar ─────────────────────────────────── */}
          <Seccion
            titulo="Quiénes sois"
            consecuencia="Cómo se presenta el agente y cómo trata a la gente. Sin esto, habla correcto pero genérico; con una o dos frases vuestras, suena a tu clínica."
          >
            <textarea
              value={config.quienesSois.presentacion ?? ""}
              onChange={(e) =>
                setConfig({ ...config, quienesSois: { ...config.quienesSois, presentacion: e.target.value || null } })
              }
              placeholder="Clínica familiar en Chamberí — 20 años cuidando las bocas del barrio, con la Dra. Ruiz al frente."
              rows={2}
              className={INPUT + " w-full max-w-2xl resize-y"}
            />
            <div className="flex items-center gap-4 pt-1">
              {([
                { valor: null, etiqueta: "Tutear (lo habitual)" },
                { valor: "usted" as const, etiqueta: "De usted, siempre" },
              ]).map((o) => (
                <label key={o.etiqueta} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--color-foreground)]">
                  <input
                    type="radio"
                    name="trato"
                    checked={(config.quienesSois.trato === "usted") === (o.valor === "usted")}
                    onChange={() => setConfig({ ...config, quienesSois: { ...config.quienesSois, trato: o.valor } })}
                    className="accent-[var(--color-accent)]"
                  />
                  {o.etiqueta}
                </label>
              ))}
            </div>
          </Seccion>

          {/* ── GRUPO 2 · Qué sabe el agente ──────────────────────────── */}
          <Seccion
            titulo="Tratamientos y precios publicados"
            consecuencia="Si cargas tu tabla de precios, el agente contesta cuánto cuesta; si no, lo aplaza y lo resuelve tu equipo. Un tratamiento sin precio se menciona, pero sin cifra."
          >
            {config.tratamientos.map((t, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={t.nombre}
                  onChange={(e) => setConfig(actualizaLista(config, "tratamientos", i, { ...t, nombre: e.target.value }))}
                  placeholder="Tratamiento (p. ej. Ortodoncia invisible)"
                  className={INPUT + " min-w-[12rem] flex-1"}
                />
                <input
                  value={t.precio ?? ""}
                  onChange={(e) => setConfig(actualizaLista(config, "tratamientos", i, { ...t, precio: e.target.value || null }))}
                  placeholder="Precio publicado (desde 35 €/mes)"
                  className={INPUT + " w-56"}
                />
                <input
                  value={t.nota ?? ""}
                  onChange={(e) => setConfig(actualizaLista(config, "tratamientos", i, { ...t, nota: e.target.value || null }))}
                  placeholder="Nota (financiación 24 meses)"
                  className={INPUT + " w-52"}
                />
                <BotonQuitar onClick={() => setConfig(quitaDeLista(config, "tratamientos", i))} />
              </div>
            ))}
            <BotonAnadir
              etiqueta="Añadir tratamiento"
              onClick={() => setConfig({ ...config, tratamientos: [...config.tratamientos, { nombre: "", precio: null, nota: null }] })}
            />
            {/* SUGERENCIAS, no datos (22-08): un clic las acepta con el
                precio vacío — ese lo pone la clínica. Nada se guarda solo. */}
            <ChipsSugerencia
              titulo="Los habituales — un clic los añade, el precio lo pones tú:"
              opciones={SUGERENCIAS_TRATAMIENTOS.filter(
                (s) => !config.tratamientos.some((t) => t.nombre.trim().toLowerCase() === s.toLowerCase()),
              )}
              onElegir={(s) =>
                setConfig({ ...config, tratamientos: [...config.tratamientos, { nombre: s, precio: null, nota: null }] })
              }
            />
          </Seccion>

          <Seccion
            titulo="Políticas publicadas"
            consecuencia="Vías de pago, seguros con los que trabajáis, cancelaciones… Lo que publiques aquí, el agente lo contesta tal cual. Adaptarlo a una persona concreta (su descuento, su cobertura) siempre lo hace tu equipo."
          >
            {config.politicas.map((p, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={p.titulo}
                  onChange={(e) => setConfig(actualizaLista(config, "politicas", i, { ...p, titulo: e.target.value }))}
                  placeholder="Título (Vías de pago)"
                  className={INPUT + " w-56"}
                />
                <textarea
                  value={p.texto}
                  onChange={(e) => setConfig(actualizaLista(config, "politicas", i, { ...p, texto: e.target.value }))}
                  placeholder={
                    SUGERENCIAS_POLITICAS.find((s) => s.titulo.toLowerCase() === p.titulo.trim().toLowerCase())
                      ?.ejemplo ?? "Texto publicado (lo que el agente puede afirmar tal cual)"
                  }
                  rows={2}
                  className={INPUT + " min-w-[16rem] flex-1 resize-y"}
                />
                <BotonQuitar onClick={() => setConfig(quitaDeLista(config, "politicas", i))} />
              </div>
            ))}
            <BotonAnadir
              etiqueta="Añadir política"
              onClick={() => setConfig({ ...config, politicas: [...config.politicas, { titulo: "", texto: "" }] })}
            />
            <ChipsSugerencia
              titulo="Las típicas — un clic añade el título, el texto lo escribes tú:"
              opciones={SUGERENCIAS_POLITICAS.filter(
                (s) => !config.politicas.some((p) => p.titulo.trim().toLowerCase() === s.titulo.toLowerCase()),
              ).map((s) => s.titulo)}
              onElegir={(titulo) =>
                setConfig({ ...config, politicas: [...config.politicas, { titulo, texto: "" }] })
              }
            />
          </Seccion>

          {/* ── UN SOLO HORARIO (22-08): el mismo dato hace las dos cosas —
              se DICE y MIDE los plazos. Dos campos eran el hallazgo de los
              dos horarios vivo en la pantalla. ─────────────────────────── */}
          <Seccion
            titulo="Horario de la clínica"
            consecuencia="Un solo horario, dos consecuencias: el agente contesta «¿a qué hora abrís?» con él, y el reloj de los plazos de respuesta solo corre cuando estáis abiertos. Sin definirlo, el agente no da horarios y los plazos usan el estándar (L-V de 9:00 a 20:00)."
          >
            {config.plazos.horario == null ? (
              <button
                type="button"
                onClick={() => setConfig({ ...config, plazos: { ...config.plazos, horario: HORARIO_INICIAL() } })}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-surface-muted)]"
              >
                <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Definir el horario
              </button>
            ) : (
              <>
                <div className="space-y-1">
                  {DIAS_SEMANA.map((dia) => {
                    const h = config.plazos.horario![dia.clave];
                    const setDia = (v: Partial<typeof h>) =>
                      setConfig({
                        ...config,
                        plazos: {
                          ...config.plazos,
                          horario: { ...config.plazos.horario!, [dia.clave]: { ...h, ...v } },
                        },
                      });
                    return (
                      <div key={dia.clave} className="flex items-center gap-2 text-[13px] text-[var(--color-foreground)]">
                        <label className="flex w-28 cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={h.activo}
                            onChange={(e) => setDia({ activo: e.target.checked })}
                            className="accent-[var(--color-accent)]"
                          />
                          {dia.etiqueta}
                        </label>
                        {h.activo ? (
                          <>
                            <input type="time" value={h.inicio} onChange={(e) => setDia({ inicio: e.target.value })} className={INPUT + " w-28"} />
                            <span className="text-[var(--color-muted)]">a</span>
                            <input type="time" value={h.fin} onChange={(e) => setDia({ fin: e.target.value })} className={INPUT + " w-28"} />
                          </>
                        ) : (
                          <span className="text-[12px] text-[var(--color-muted)]">cerrado</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[12px] text-[var(--color-muted)]">
                  Así lo dirá el agente: «{horarioLegible(config.plazos.horario)}»
                </p>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, plazos: { ...config.plazos, horario: null } })}
                  className="text-[12px] font-medium text-[var(--color-muted)] underline hover:text-[var(--color-foreground)]"
                >
                  Quitar y volver al estándar
                </button>
              </>
            )}
          </Seccion>

          {/* ── AGENDA: la decisión de los tres niveles (PLAN §11). El nivel
              3 (reservar por su cuenta) está FUERA de A-F: ni se ofrece. ── */}
          <Seccion
            titulo="Agenda"
            consecuencia="Es el aplazamiento más frecuente: «¿tenéis hueco el jueves?». Sin conexión, el agente recoge la disponibilidad de la persona y tu equipo confirma. Conectando tu agenda (solo lectura), pasa a informar de los huecos — reservar lo hace siempre tu equipo."
          >
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3">
              <input type="radio" name="agenda" checked readOnly className="mt-0.5 accent-[var(--color-accent)]" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[var(--color-foreground)]">
                  Sin conexión — recoge disponibilidad
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--color-muted)]">
                  El agente pregunta días y franjas, lo deja recogido en el caso, y tu equipo cierra la cita.
                </span>
              </span>
            </label>
            <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-[var(--color-border)] p-3 opacity-70">
              <Lock size={15} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-muted)]" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[var(--color-foreground)]">
                  Solo lectura — informa de huecos, no reserva
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--color-muted)]">
                  «El jueves hay hueco a las 16:30 y a las 18:00.» Requiere conectar tu agenda — cuando la
                  conexión esté disponible, se activa desde aquí.
                </span>
              </span>
            </div>
          </Seccion>

          {/* ── GRUPO 3 · Hasta dónde llega ───────────────────────────── */}
          <Seccion
            titulo="Hasta dónde llega"
            consecuencia="Qué informa ya lo decide lo publicado de arriba. Aquí decides cuántas veces aplaza un tema antes de pasártelo, y qué pasa con las urgencias."
          >
            <label className="block text-[13px] text-[var(--color-foreground)]">
              <span className="font-medium">Vueltas sobre un tema aplazado antes de derivarlo</span>
              <select
                value={config.alcance.umbralInsistencia ?? 2}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    alcance: { ...config.alcance, umbralInsistencia: Number(e.target.value) === 2 ? null : Number(e.target.value) },
                  })
                }
                className={INPUT + " ml-2 w-auto"}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 2 ? "2 (recomendado)" : String(n)}
                  </option>
                ))}
              </select>
              <span className="ml-2 text-[12px] text-[var(--color-muted)]">
                Con {config.alcance.umbralInsistencia ?? 2}: si pregunta{" "}
                {(config.alcance.umbralInsistencia ?? 2) + 1} veces por lo mismo, el caso pasa a tu equipo.
              </span>
            </label>
            <div className="pt-2">
              <p className="text-[13px] font-medium text-[var(--color-foreground)]">Urgencias</p>
              {/* La única sección que puede acabar en un problema serio: su
                  consecuencia va delante, no en letra pequeña (22-08). */}
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                Si las atiendes, el agente tranquiliza y deriva de inmediato. Si no las atiendes, escribe
                qué le decimos a alguien con dolor — el agente reproduce ese texto literal y no improvisa.
              </p>
              <div className="mt-1.5 flex items-center gap-4">
                {([
                  { atiende: true, etiqueta: "Se atienden" },
                  { atiende: false, etiqueta: "No se atienden aquí" },
                ]).map((o) => (
                  <label key={String(o.atiende)} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--color-foreground)]">
                    <input
                      type="radio"
                      name="urgencias"
                      checked={(config.alcance.urgencias?.atiende ?? true) === o.atiende}
                      onChange={() =>
                        setConfig({
                          ...config,
                          alcance: {
                            ...config.alcance,
                            urgencias: o.atiende
                              ? null
                              : { atiende: false, textoNoAtiende: config.alcance.urgencias?.textoNoAtiende ?? null },
                          },
                        })
                      }
                      className="accent-[var(--color-accent)]"
                    />
                    {o.etiqueta}
                  </label>
                ))}
              </div>
              {config.alcance.urgencias?.atiende === false && (
                <div className="mt-2">
                  <p className="text-[12px] text-[var(--color-muted)]">
                    Obligatorio — lo escribes y lo asumes tú; el agente lo reproduce tal cual y deriva el caso.
                  </p>
                  <textarea
                    value={config.alcance.urgencias.textoNoAtiende ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        alcance: { ...config.alcance, urgencias: { atiende: false, textoNoAtiende: e.target.value || null } },
                      })
                    }
                    placeholder="En esta clínica no atendemos urgencias. Si es urgente, llama al 112 o acude al servicio de urgencias dentales de [X], en [dirección]."
                    rows={2}
                    className={INPUT + " mt-1 w-full max-w-2xl resize-y"}
                  />
                </div>
              )}
            </div>
            <label className="block pt-1 text-[13px] text-[var(--color-foreground)]">
              <span className="font-medium">¿Algo más que aquí cuente como urgencia?</span>
              <span className="ml-2 text-[12px] text-[var(--color-muted)]">
                Se suma a la definición base (dolor agudo, sangrado, rotura…), nunca la sustituye.
              </span>
              <input
                value={config.alcance.urgenciaDefinicionExtra ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, alcance: { ...config.alcance, urgenciaDefinicionExtra: e.target.value || null } })
                }
                placeholder="Caída de brackets con rozadura, dolor postoperatorio de implante"
                className={INPUT + " mt-1.5 block w-full max-w-2xl"}
              />
            </label>
          </Seccion>

          <Seccion
            titulo="Enlaces"
            consecuencia="Reserva online, web, cómo llegar… El agente los comparte cuando vienen a cuento. Solo direcciones completas (https://…)."
          >
            {config.enlaces.map((e, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={e.etiqueta}
                  onChange={(ev) => setConfig(actualizaLista(config, "enlaces", i, { ...e, etiqueta: ev.target.value }))}
                  placeholder="Etiqueta (Reserva online)"
                  className={INPUT + " w-56"}
                />
                <input
                  value={e.url}
                  onChange={(ev) => setConfig(actualizaLista(config, "enlaces", i, { ...e, url: ev.target.value }))}
                  placeholder="https://tuclinica.es/reserva"
                  className={INPUT + " min-w-[16rem] flex-1"}
                />
                <BotonQuitar onClick={() => setConfig(quitaDeLista(config, "enlaces", i))} />
              </div>
            ))}
            <BotonAnadir
              etiqueta="Añadir enlace"
              onClick={() => setConfig({ ...config, enlaces: [...config.enlaces, { etiqueta: "", url: "" }] })}
            />
          </Seccion>

          {/* ── GRUPO 4 · Plazos de respuesta ─────────────────────────── */}
          <Seccion
            titulo="Plazos de respuesta"
            consecuencia="Cuánto puede esperar cada cosa antes de marcarse «Fuera de plazo» en Seguimiento. El reloj solo corre cuando la clínica está abierta — con el horario de la sección «Horario de la clínica»."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                { clave: "urgenciaMin" as const, etiqueta: "Una urgencia", def: 30, min: 10, max: 120 },
                { clave: "respuestaMin" as const, etiqueta: "Un paciente esperando respuesta", def: 120, min: 30, max: 480 },
                { clave: "cierreMin" as const, etiqueta: "Un caso listo para cerrar", def: 240, min: 60, max: 960 },
                { clave: "leadNuevoMin" as const, etiqueta: "Un lead nuevo sin contactar", def: 60, min: 15, max: 240 },
              ]).map((p) => (
                <label key={p.clave} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                  <span>{p.etiqueta}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <input
                      type="number"
                      min={p.min}
                      max={p.max}
                      value={config.plazos[p.clave] ?? ""}
                      placeholder={String(p.def)}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          plazos: { ...config.plazos, [p.clave]: e.target.value === "" ? null : Number(e.target.value) },
                        })
                      }
                      className={INPUT + " w-20 text-right tabular-nums"}
                    />
                    <span className="text-[11px] text-[var(--color-muted)]">min ({p.min}–{p.max})</span>
                  </span>
                </label>
              ))}
            </div>

            {/* F5 — LA POLÍTICA DE COBRO (dictado): no pregunta cuántos días
                quiere esperar la clínica — pregunta cuándo considera que un
                pago ESTÁ vencido. En días de calendario, no en minutos
                laborables: el vencimiento es del dinero. */}
            <div className="mt-3 space-y-2">
              <p className="text-[13px] font-semibold text-[var(--color-foreground)]">Política de cobro</p>
              <p className="text-[12px] text-[var(--color-muted)]">
                Un pago con plazo cumplido y sin liquidación entra en la cola de Seguimiento
                cuando la clínica lo considera vencido.
              </p>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                <span>¿Cuándo considera esta clínica que un pago está vencido?</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={config.plazos.cobroVencidoDias ?? ""}
                    placeholder="7"
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        plazos: { ...config.plazos, cobroVencidoDias: e.target.value === "" ? null : Number(e.target.value) },
                      })
                    }
                    className={INPUT + " w-20 text-right tabular-nums"}
                  />
                  <span className="text-[11px] text-[var(--color-muted)]">días tras el plazo (0–60)</span>
                </span>
              </label>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                <span>¿Cuándo pasa un vencido a «Fuera de plazo»?</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={2}
                    max={180}
                    value={config.plazos.cobroFueraDePlazoDias ?? ""}
                    placeholder="30"
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        plazos: { ...config.plazos, cobroFueraDePlazoDias: e.target.value === "" ? null : Number(e.target.value) },
                      })
                    }
                    className={INPUT + " w-20 text-right tabular-nums"}
                  />
                  <span className="text-[11px] text-[var(--color-muted)]">días vencido (2–180)</span>
                </span>
              </label>
            </div>
          </Seccion>

          {/* ── GRUPO 5 · Cadencias y recordatorios — aquí, no en
              Automatizaciones (dictado 22-08): el agente y la cadencia
              comparten el semáforo, los plazos y al paciente. ──────────── */}
          <Seccion
            titulo="Cadencias y recordatorios"
            consecuencia="Cómo se persigue un presupuesto sin respuesta: cada cuánto se toca, cuántas veces antes de darlo por agotado (y recomendar llamada), y a qué hora salen los envíos. Es la misma decisión que los plazos de arriba — el agente en silencio."
          >
            <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
              <span>Toques sin respuesta antes de dar la cadencia por agotada</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={toques}
                  onChange={(e) => setToques(Number(e.target.value))}
                  className={INPUT + " w-16 text-right tabular-nums"}
                />
                <span className="text-[11px] text-[var(--color-muted)]">(1–10)</span>
              </span>
            </label>
            {cadencia ? (
              <>
                <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                  <span>Días de la secuencia tras presentar un presupuesto</span>
                  <input
                    value={secuenciaTexto}
                    onChange={(e) => setSecuenciaTexto(e.target.value)}
                    placeholder="3, 7, 10"
                    className={INPUT + " w-32 text-right tabular-nums"}
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                    <span>Máx. recordatorios</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={cadencia.recordatorioMax}
                      onChange={(e) => setCadencia({ ...cadencia, recordatorioMax: Number(e.target.value) })}
                      className={INPUT + " w-16 text-right tabular-nums"}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                    <span>Hora de envío</span>
                    <input
                      type="time"
                      value={cadencia.horaEnvio}
                      onChange={(e) => setCadencia({ ...cadencia, horaEnvio: e.target.value })}
                      className={INPUT + " w-28"}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-foreground)]">
                    <span>Rechazo auto. tras</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <input
                        type="number"
                        min={7}
                        max={120}
                        value={cadencia.diasRechazoAuto}
                        onChange={(e) => setCadencia({ ...cadencia, diasRechazoAuto: Number(e.target.value) })}
                        className={INPUT + " w-16 text-right tabular-nums"}
                      />
                      <span className="text-[11px] text-[var(--color-muted)]">días</span>
                    </span>
                  </label>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-foreground)]">
                  <input
                    type="checkbox"
                    checked={cadencia.activa}
                    onChange={(e) => setCadencia({ ...cadencia, activa: e.target.checked })}
                    className="accent-[var(--color-accent)]"
                  />
                  Cadencia activa en {cadencia.clinica}
                </label>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                Estás viendo toda la red y la cadencia de presupuestos es por clínica: elige una en el
                selector de clínica de la cabecera para ajustar la suya. Sin tocar nada, todas usan el
                estándar — seguimiento a los 3, 7 y 10 días, máximo 3 recordatorios, envíos a las 9:00 y
                rechazo automático a los 30 días.
              </p>
            )}
            <p className="text-[12px] text-[var(--color-muted)]">
              Además, fijo por ahora: el recordatorio de cita se propone la víspera a las 09:00, y hay un
              tope de 30 envíos por clínica y día.
            </p>
          </Seccion>

          {/* ── REGLAS DURAS: se leen, no se editan ───────────────────── */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
            <h2 className="font-display flex items-center gap-1.5 text-[15px] font-semibold text-[var(--color-foreground)]">
              <ShieldCheck size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
              Lo que el agente no hace nunca
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
              Estas reglas no se configuran: las revisa un control independiente antes de cada mensaje.
            </p>
            <ul className="mt-2 space-y-1">
              {REGLAS_DURAS.map((r) => (
                <li key={r} className="text-[13px] text-[var(--color-foreground)]">· {r}</li>
              ))}
            </ul>
          </section>

          {/* ── EL PROMPT, VISIBLE ────────────────────────────────────── */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">
              Lo que se le dice al agente
            </h2>
            <button
              type="button"
              onClick={() => setVerPrompt((v) => !v)}
              className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent)]"
            >
              {verPrompt ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              Lo publicado que entra en cada conversación
            </button>
            {verPrompt && (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-3 text-[12px] leading-relaxed text-[var(--color-foreground)]">
                {bloque || "(nada publicado todavía — el agente aplaza precios, horarios y políticas)"}
              </pre>
            )}
            <button
              type="button"
              onClick={() => setVerSystem((v) => !v)}
              className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent)]"
            >
              {verSystem ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              Las instrucciones base, completas
            </button>
            {verSystem && (
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-3 text-[12px] leading-relaxed text-[var(--color-foreground)]">
                {systemPrompt}
              </pre>
            )}
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const INPUT =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none";

const DIAS_SEMANA = [
  { clave: "lunes" as const, etiqueta: "Lunes" },
  { clave: "martes" as const, etiqueta: "Martes" },
  { clave: "miercoles" as const, etiqueta: "Miércoles" },
  { clave: "jueves" as const, etiqueta: "Jueves" },
  { clave: "viernes" as const, etiqueta: "Viernes" },
  { clave: "sabado" as const, etiqueta: "Sábado" },
  { clave: "domingo" as const, etiqueta: "Domingo" },
];

/** El punto de partida al definir horario: el estándar de la casa, editable.
 *  Función y no constante: cada clic da un objeto NUEVO (no se comparte). */
function HORARIO_INICIAL() {
  const dia = { activo: true, inicio: "09:00", fin: "20:00" };
  return {
    lunes: { ...dia },
    martes: { ...dia },
    miercoles: { ...dia },
    jueves: { ...dia },
    viernes: { ...dia },
    sabado: { activo: false, inicio: "10:00", fin: "14:00" },
    domingo: { activo: false, inicio: "10:00", fin: "14:00" },
  };
}

function Seccion({
  titulo,
  consecuencia,
  children,
}: {
  titulo: string;
  /** LA CONSECUENCIA, no una advertencia: qué hace la máquina si lo
   *  rellenas, y quién lo hace si no. */
  consecuencia: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">{titulo}</h2>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{consecuencia}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

/** Sugerencias que se ACEPTAN con un clic — nunca datos precargados: guardar
 *  «hacemos implantes» en una clínica que no los hace sería inventar. Las ya
 *  añadidas desaparecen de la lista (el caller filtra por nombre). */
function ChipsSugerencia({
  titulo,
  opciones,
  onElegir,
}: {
  titulo: string;
  opciones: readonly string[];
  onElegir: (opcion: string) => void;
}) {
  if (opciones.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-border)] pt-2.5">
      <p className="text-[11.5px] text-[var(--color-muted)]">{titulo}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {opciones.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onElegir(s)}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-foreground)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <Plus size={12} strokeWidth={ICON_STROKE} aria-hidden />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function BotonAnadir({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
    >
      <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
      {etiqueta}
    </button>
  );
}

function BotonQuitar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Quitar"
      aria-label="Quitar"
      className="mt-1.5 shrink-0 rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-danger)]"
    >
      <X size={15} strokeWidth={ICON_STROKE} aria-hidden />
    </button>
  );
}

function actualizaLista<K extends "tratamientos" | "politicas" | "enlaces">(
  c: ConocimientoClinica,
  campo: K,
  i: number,
  valor: ConocimientoClinica[K][number],
): ConocimientoClinica {
  const lista = [...c[campo]] as ConocimientoClinica[K];
  (lista as unknown[])[i] = valor;
  return { ...c, [campo]: lista };
}

function quitaDeLista(
  c: ConocimientoClinica,
  campo: "tratamientos" | "politicas" | "enlaces",
  i: number,
): ConocimientoClinica {
  return { ...c, [campo]: c[campo].filter((_, j) => j !== i) as never };
}
