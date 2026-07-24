"use client";

// Módulo Cobros — panel "Recordar pago". Mismo molde que los paneles de
// leads/presupuestos (la card informa, el panel actúa): cabecera mínima,
// contexto + recomendación, historial de pagos, hilo completo y composer
// con el recordatorio precargado (plantilla de cobranza, editable).
//
// El envío pasa por /api/cobros/[id]/recordar → servicio central de
// mensajería: fila en el hilo ANTES de confirmar, wa.me para terminar.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MensajeWhatsApp } from "../../lib/presupuestos/types";
import type { Pago } from "../../lib/pagos-format";
import { formatTipo } from "../../lib/pagos-format";
import {
  PanelAccionShell,
  PanelCabecera,
  ContextoRecomendacion,
  RegistroColapsable,
  Burbujas,
  Composer,
  btnAccionSecundario,
  type PrioridadPanel,
} from "../../components/shared/panel-accion-ui";
import { ErrorState } from "../../components/ui/Feedback";
import { Check, Phone, ICON_STROKE } from "../../components/icons";
import { type CobroItem, copyEstado, fmtEUR } from "./types";

type PanelData = {
  paciente: { id: string; nombre: string; telefono: string | null };
  hilo: MensajeWhatsApp[];
  pagos: Pago[];
  mensaje: string;
  plantillaNombre: string | null;
  plantillas: Array<{ id: string; nombre: string }>;
};

const PRIORIDAD: Record<CobroItem["urgencia"], PrioridadPanel> = {
  vencido: "alta",
  por_vencer: "media",
  estancado: "media",
  normal: "baja",
};

export function CobroPanel({
  item,
  onClose,
  onActuado,
}: {
  item: CobroItem;
  onClose: () => void;
  /** El padre atenúa la card y refresca la cola. */
  onActuado: (pacienteId: string) => void;
}) {
  const [data, setData] = useState<PanelData | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [llamadaOk, setLlamadaOk] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(() => {
    setErrorCarga(false);
    fetch(`/api/cobros/${item.pacienteId}/panel?urgencia=${item.urgencia}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PanelData) => {
        setData(d);
        // Precarga solo si la coordinadora aún no escribió nada.
        setTexto((prev) => (prev ? prev : d.mensaje));
      })
      .catch(() => setErrorCarga(true));
  }, [item.pacienteId, item.urgencia]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [data?.hilo.length]);

  async function registrarContacto(canal: "llamada" | "manual"): Promise<boolean> {
    const res = await fetch(`/api/cobros/${item.pacienteId}/recordar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canal }),
    });
    return res.ok;
  }

  async function handleLlamar() {
    if (!item.telefono) return;
    // La llamada no se bloquea por el registro; el fallo del registro se dice.
    window.location.href = `tel:${item.telefono.replace(/\s/g, "")}`;
    const ok = await registrarContacto("llamada").catch(() => false);
    if (ok) {
      setLlamadaOk(true);
      setTimeout(() => setLlamadaOk(false), 1500);
      toast.success("Llamada registrada");
      onActuado(item.pacienteId);
    } else {
      toast.error("La llamada se abrió, pero no se pudo registrar el contacto");
    }
  }

  async function handleMarcarContactado() {
    setMarcando(true);
    try {
      const ok = await registrarContacto("manual");
      if (!ok) throw new Error();
      toast.success("Marcado como contactado");
      onActuado(item.pacienteId);
      onClose();
    } catch {
      toast.error("No se pudo marcar como contactado");
    } finally {
      setMarcando(false);
    }
  }

  async function handleEnviar() {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setComposerError(null);
    try {
      const res = await fetch(`/api/cobros/${item.pacienteId}/recordar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal: "whatsapp", mensaje: contenido }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { urlWhatsApp: string | null };
      if (j.urlWhatsApp) window.open(j.urlWhatsApp, "_blank");
      // Refleja el saliente en el hilo sin re-fetch.
      setData((d) =>
        d
          ? {
              ...d,
              hilo: [
                ...d.hilo,
                {
                  id: `local-${Date.now()}`,
                  direccion: "Saliente",
                  contenido,
                  timestamp: new Date().toISOString(),
                } as MensajeWhatsApp,
              ],
            }
          : d,
      );
      setTexto("");
      toast.success("Recordatorio en el hilo — termina el envío en WhatsApp");
      onActuado(item.pacienteId);
    } catch {
      setComposerError("No se pudo registrar el mensaje. Reintenta.");
      toast.error("No se pudo registrar el recordatorio");
    } finally {
      setEnviando(false);
    }
  }

  async function aplicarPlantilla(plantillaId: string) {
    try {
      const res = await fetch(`/api/cobros/${item.pacienteId}/plantilla`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantillaId }),
      });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { mensaje: string };
      setTexto(j.mensaje);
    } catch {
      toast.error("No se pudo preparar la plantilla");
    }
  }

  const estado = copyEstado(item);
  const quePasa = (() => {
    const base = `Aceptó ${fmtEUR(item.firmado)}${
      item.diasDesdeAceptacion != null ? ` hace ${item.diasDesdeAceptacion} días` : ""
    } y ${item.pagado > 0 ? `ha pagado ${fmtEUR(item.pagado)}` : "no ha pagado nada"}. Quedan ${fmtEUR(item.pendiente)}.`;
    if (item.urgencia === "vencido" && item.diasVencido != null) {
      return `${base} El plazo venció hace ${item.diasVencido} días.`;
    }
    if (item.urgencia === "por_vencer" && item.diasParaVencer != null) {
      return `${base} El plazo vence en ${item.diasParaVencer} días.`;
    }
    return base;
  })();
  const recomendacion =
    item.urgencia === "vencido"
      ? "Reclama el pago vencido"
      : item.urgencia === "por_vencer"
        ? "Anticípate antes de que venza"
        : item.urgencia === "estancado"
          ? "Reactiva el cobro parado"
          : "Recuérdale el pago pendiente";

  const pagosLineas = (data?.pagos ?? []).map((p) => ({
    id: p.id,
    texto: `${fmtEUR(p.importe)} · ${formatTipo(p.tipo)} · ${p.metodo}`,
    fecha: p.fechaPago,
  }));

  return (
    <PanelAccionShell onClose={onClose}>
      <PanelCabecera
        nombre={item.nombre}
        sub={`${item.tratamientos.join(", ") || "Sin tratamiento"} · pendiente ${fmtEUR(item.pendiente)}`}
        prioridad={PRIORIDAD[item.urgencia]}
        prioridadTitle={estado.titular}
        onClose={onClose}
      />

      <div className="px-4 pt-3 shrink-0">
        <ContextoRecomendacion
          cargando={!data && !errorCarga}
          quePasa={quePasa}
          recomendacion={recomendacion}
          acciones={
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleLlamar}
                disabled={!item.telefono}
                title={item.telefono ? undefined : "Sin teléfono"}
                className={btnAccionSecundario}
              >
                {llamadaOk ? (
                  <Check size={14} strokeWidth={ICON_STROKE} className="fyllio-check-pop text-[var(--color-success)]" aria-hidden />
                ) : (
                  <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                )}
                Llamar
              </button>
              <button
                type="button"
                onClick={handleMarcarContactado}
                disabled={marcando}
                className={btnAccionSecundario}
              >
                <Check size={14} strokeWidth={ICON_STROKE} aria-hidden />
                {marcando ? "Guardando…" : "Marcar contactado"}
              </button>
            </div>
          }
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2 bg-[var(--color-background)]">
        <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide shrink-0">
          Conversación
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          <RegistroColapsable titulo="Pagos registrados" lineas={pagosLineas} />
          {errorCarga ? (
            <ErrorState
              title="No se pudo cargar el contexto"
              detail="La conversación y los pagos de este paciente no están disponibles ahora mismo."
              onRetry={cargar}
            />
          ) : !data ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-8" />
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-8" />
            </div>
          ) : data.hilo.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic text-center py-6">
              Sin conversación todavía — este recordatorio será el primer mensaje.
            </p>
          ) : (
            <Burbujas mensajes={data.hilo} />
          )}
          <div ref={chatEndRef} />
        </div>

        <Composer
          value={texto}
          onChange={(v) => {
            setTexto(v);
            setComposerError(null);
          }}
          onEnviar={handleEnviar}
          enviando={enviando}
          plantillas={data?.plantillas ?? []}
          onPlantilla={aplicarPlantilla}
          disabled={!item.telefono}
          disabledTitle="Falta el teléfono para poder escribirle"
          error={composerError}
          modoManual
        />
      </div>
    </PanelAccionShell>
  );
}
