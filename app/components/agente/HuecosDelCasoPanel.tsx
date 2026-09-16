"use client";

// EL BOTÓN QUE YA SABE QUÉ HACER (17-09, paso 3 de la ficha — MEJORAS 253).
//
// Antes: «Agendar cita» abría la agenda entera y la coordinadora buscaba a
// mano lo que el agente ya había recogido. Ahora el SERVIDOR devuelve tres
// huecos que cumplen lo que dijo la persona (/api/agente/huecos) y este panel
// se COMPONE de esa respuesta:
//  · la GARANTÍA siempre a la vista, también en vivo (un solo camino);
//  · si se amplió la búsqueda, se dice por qué;
//  · al elegir un hueco se enseña el MENSAJE ENTERO que recibirá el paciente
//    ANTES de pulsar (condición de Simon: el clic es la revisión);
//  · reservar va por el camino de siempre (PATCH /api/leads/[id]) y confirmar
//    por /api/agente/confirmar-cita. Si lo segundo falla, se dice exactamente
//    eso: la cita está, la confirmación no — con reintento.
// Con copia o sin agenda, el botón ANOTA la cita en Fyllio y no manda nada:
// confirmar al paciente un hueco que no se ve sería la promesa falsa.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { fechaCorta } from "../../lib/agenda/fechas";
import { nombreCortoDoctor } from "../../lib/agenda/nombres";
import { AlertTriangle, CalendarDays, ICON_STROKE } from "../icons";
import type { RespuestaHuecos, HuecoDelCaso } from "../../lib/agenda/huecos-del-caso";

type Respuesta = Omit<RespuestaHuecos, "huecos"> & {
  huecos: Array<HuecoDelCaso & { textoConfirmacion: string }>;
  lead: { id: string; nombre: string; fechaCita: string | null; horaCita: string | null; doctorAsignadoId: string | null };
};

const TONO_GARANTIA: Record<RespuestaHuecos["garantia"]["frescura"], string> = {
  en_vivo: "text-[var(--color-success,#1f7a4d)]",
  copia: "text-amber-700 dark:text-amber-300",
  sin_agenda: "text-[var(--color-muted)]",
};

export function HuecosDelCasoPanel({
  telefono,
  onHecho,
  onVerAgenda,
}: {
  telefono: string;
  /** Cita reservada (y confirmada o no): el caller recarga la ficha. */
  onHecho: () => void;
  onVerAgenda: () => void;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tratamientoId, setTratamientoId] = useState<string | null>(null);
  const [todosLosDoctores, setTodosLosDoctores] = useState(false);
  const [elegido, setElegido] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  // La cita se reservó pero la confirmación no salió: se ofrece reintentar
  // SOLO la confirmación, sin volver a reservar.
  const [pendienteConfirmar, setPendienteConfirmar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ telefono });
      if (tratamientoId) qs.set("tratamientoId", tratamientoId);
      if (todosLosDoctores) qs.set("doctorId", "todos");
      const d = await cargarJSON<Respuesta>(`/api/agente/huecos?${qs.toString()}`);
      setDatos(d);
      setElegido(null);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, [telefono, tratamientoId, todosLosDoctores]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function confirmar(leadId: string, texto: string) {
    const r = await cargarJSON<{ ok: boolean; simulado?: boolean; modo?: string }>(`/api/agente/confirmar-cita`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono, leadId, texto }),
    });
    return r;
  }

  async function reservar(h: Respuesta["huecos"][number]) {
    if (!datos || guardando) return;
    setGuardando(true);
    try {
      await cargarJSON(`/api/leads/${datos.lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "Citado",
          fechaCita: h.fecha,
          horaCita: h.hora,
          doctorAsignadoId: h.doctorId,
          tratamientoAgendaId: datos.tratamiento?.id ?? null,
        }),
      });
    } catch (e) {
      toast.error(mensajeDeError(e));
      setGuardando(false);
      return;
    }
    if (!datos.garantia.puedeReservar) {
      toast.success(`Cita anotada — ${fechaCorta(h.fecha)} a las ${h.hora} con ${nombreCortoDoctor(h.doctorNombre)}. Confírmala en tu software.`);
      setGuardando(false);
      onHecho();
      return;
    }
    try {
      const r = await confirmar(datos.lead.id, h.textoConfirmacion);
      toast.success(
        r.simulado
          ? `Cita reservada y confirmación registrada (hilo simulado) — ${fechaCorta(h.fecha)} a las ${h.hora}`
          : `Cita reservada y confirmada al paciente — ${fechaCorta(h.fecha)} a las ${h.hora}`,
      );
      onHecho();
    } catch (e) {
      // La cita SÍ está reservada. Se dice tal cual y se deja reintentar.
      setPendienteConfirmar(h.textoConfirmacion);
      toast.error(`La cita está reservada, pero la confirmación no salió: ${mensajeDeError(e)}`);
      onHecho();
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

  if (pendienteConfirmar) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] dark:border-amber-500/25 dark:bg-amber-500/10">
        <p className="font-medium text-amber-800 dark:text-amber-200">La cita está reservada; la confirmación al paciente no salió.</p>
        <p className="mt-1 whitespace-pre-wrap text-[var(--color-foreground)]">{pendienteConfirmar}</p>
        <button
          type="button"
          disabled={guardando}
          onClick={async () => {
            setGuardando(true);
            try {
              await confirmar(datos.lead.id, pendienteConfirmar);
              toast.success("Confirmación enviada");
              setPendienteConfirmar(null);
              onHecho();
            } catch (e) {
              toast.error(mensajeDeError(e));
            } finally {
              setGuardando(false);
            }
          }}
          className="mt-2 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-on-accent)] disabled:opacity-50"
        >
          Reintentar la confirmación
        </button>
      </div>
    );
  }

  const g = datos.garantia;
  const hueco = elegido != null ? datos.huecos[elegido] ?? null : null;

  return (
    <div className="space-y-2">
      {/* La garantía, SIEMPRE — también en vivo. */}
      <p className={`flex items-start gap-1.5 text-[12px] ${TONO_GARANTIA[g.frescura]}`}>
        {g.frescura !== "en_vivo" && <AlertTriangle size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />}
        <span>{g.texto}</span>
      </p>

      {/* El tipo de cita: casado con lo que dijo, o a elegir. */}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-muted)]">
        <label className="flex items-center gap-1.5">
          Tipo de cita
          <select
            value={datos.tratamiento?.id ?? ""}
            onChange={(e) => setTratamientoId(e.target.value || null)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[12px] text-[var(--color-foreground)]"
          >
            <option value="">— elegir —</option>
            {datos.catalogo.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre} · {t.duracionMin} min</option>
            ))}
          </select>
        </label>
        {datos.doctorFiltrado && (
          <button type="button" onClick={() => setTodosLosDoctores(true)} className="underline">
            solo {nombreCortoDoctor(datos.doctorFiltrado.nombre)} · ver todos
          </button>
        )}
      </div>

      {datos.nota && <p className="text-[12px] text-[var(--color-muted)]">{datos.nota}</p>}

      {datos.huecos.length > 0 && (
        <ul className="grid gap-1.5">
          {datos.huecos.map((h, i) => (
            <li key={`${h.fecha}-${h.hora}-${h.doctorId}`}>
              <button
                type="button"
                onClick={() => setElegido(i === elegido ? null : i)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-[12.5px] transition-colors ${
                  i === elegido
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-foreground)]"
                    : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                <span className="font-medium">
                  {fechaCorta(h.fecha)} · {h.hora}
                </span>
                <span className="text-[var(--color-muted)]">{nombreCortoDoctor(h.doctorNombre)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* El mensaje ENTERO antes del clic. */}
      {hueco && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2.5">
          {g.puedeReservar ? (
            <>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">Lo que recibirá {datos.lead.nombre.split(" ")[0]} por WhatsApp</p>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-[var(--color-foreground)]">{hueco.textoConfirmacion}</p>
            </>
          ) : (
            <p className="text-[12.5px] text-[var(--color-foreground)]">
              Se anota en Fyllio {fechaCorta(hueco.fecha)} a las {hueco.hora} con {nombreCortoDoctor(hueco.doctorNombre)}. Al paciente no se le escribe desde aquí: confírmalo en tu software y avísale tú.
            </p>
          )}
          <button
            type="button"
            disabled={guardando}
            onClick={() => void reservar(hueco)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            <CalendarDays size={14} strokeWidth={ICON_STROKE} aria-hidden />
            {guardando ? "Reservando…" : g.puedeReservar ? "Reservar y enviar la confirmación" : "Anotar la cita"}
          </button>
        </div>
      )}

      <button type="button" onClick={onVerAgenda} className="text-[12px] font-medium text-[var(--color-accent)] hover:underline">
        Ver toda la agenda
      </button>
    </div>
  );
}
