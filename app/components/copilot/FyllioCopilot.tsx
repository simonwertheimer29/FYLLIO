"use client";

// Sprint 11 A — Fyllio Copilot. FAB siempre visible (esquina abajo-derecha)
// que abre un drawer lateral con interfaz de chat. Sin persistencia: cada
// vez que se cierra, la conversación se pierde.
//
// API imperativa via window.dispatchEvent para que los botones contextuales
// del Bloque C puedan abrirlo precargado:
//
//    window.dispatchEvent(new CustomEvent("fyllio-copilot:open", {
//      detail: { context: {...}, initialAssistantMessage: "..." }
//    }));

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type {
  CopilotAction,
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotContextSnapshot,
  CopilotMessage,
} from "./types";
import { useClinic } from "../../lib/context/ClinicContext";
import { Sparkles, ArrowUp, X, Wrench, ICON_STROKE } from "../icons";
import { History, Mic, Square } from "lucide-react";

// ─── Sprint 14b Bloque 8 — patient mention parser ──────────────────────
//
// Convención: el LLM emite menciones de paciente como markdown-link
// con el scheme `paciente:` — `[Nombre Paciente](paciente:recXXX)`.
// El parser convierte cada match en un <Link href="/pacientes/recXXX">
// y deja el resto como texto plano. Cubre el caso "Bloque 1.5 dejó
// abierto: mentions del Copilot clicables".
//
// Si el LLM no usa el scheme, el render fallback es texto plano (sin
// disrupción).

const PACIENTE_MENTION_RE = /\[([^\]]+)\]\(paciente:(rec[A-Za-z0-9]+)\)/g;

function renderAssistantContent(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  PACIENTE_MENTION_RE.lastIndex = 0;
  let key = 0;
  while ((m = PACIENTE_MENTION_RE.exec(text)) !== null) {
    const [match, label, pacienteId] = m;
    if (m.index > lastIdx) {
      out.push(<Fragment key={key++}>{text.slice(lastIdx, m.index)}</Fragment>);
    }
    out.push(
      <Link
        key={key++}
        href={`/pacientes/${pacienteId}`}
        className="text-violet-700 font-medium underline decoration-violet-300 hover:decoration-violet-700"
      >
        {label}
      </Link>,
    );
    lastIdx = m.index + match.length;
  }
  if (lastIdx < text.length) {
    out.push(<Fragment key={key++}>{text.slice(lastIdx)}</Fragment>);
  }
  return out;
}

type OpenEventDetail = {
  context?: CopilotContextSnapshot;
  initialAssistantMessage?: string;
};

export function FyllioCopilot() {
  const { selectedClinicaId } = useClinic();
  const [open, setOpen] = useState(false);
  // Sprint 13.1 Bloque 1 — fix hydration: el FAB con clases arbitrarias
  // (bg-violet-700/40, blur-sm) producía mismatch SSR/CSR en Next 16.
  // Posponemos su render al primer effect cliente. Reservamos espacio
  // con placeholder fijo durante SSR para evitar CLS.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextSnapshot, setContextSnapshot] = useState<CopilotContextSnapshot | null>(null);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Sprint 16a Bloque 1 — memoria persistente.
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Sprint 16a Bloque 3 — voice input via Whisper.
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // API imperativa para que los botones contextuales del Bloque C abran
  // el chat precargado.
  useEffect(() => {
    function onOpen(ev: Event) {
      const detail = (ev as CustomEvent<OpenEventDetail>).detail ?? {};
      const initialMsgs: CopilotMessage[] = [];
      if (detail.initialAssistantMessage) {
        initialMsgs.push({
          role: "assistant",
          content: detail.initialAssistantMessage,
        });
      }
      setMessages(initialMsgs);
      setContextSnapshot(detail.context ?? null);
      setError(null);
      setDraft("");
      setOpen(true);
    }
    window.addEventListener("fyllio-copilot:open", onOpen);
    return () => window.removeEventListener("fyllio-copilot:open", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading, open]);

  const reset = useCallback(() => {
    setMessages([]);
    setContextSnapshot(null);
    setError(null);
    setDraft("");
    setConversacionId(null);
  }, []);

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const cancelarGrabacion = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      // Override del onstop original con un noop antes de stop, para
      // que el handler que dispara el upload no se ejecute.
      r.onstop = () => {
        r.stream.getTracks().forEach((t) => t.stop());
      };
      r.stop();
    }
    recorderRef.current = null;
    recorderChunksRef.current = [];
    stopRecordingTimer();
    setRecording(false);
    setRecordingSeconds(0);
  }, [stopRecordingTimer]);

  const empezarGrabacion = useCallback(async () => {
    if (recording || transcribing || loading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        recorderChunksRef.current = [];
        if (blob.size === 0) {
          toast.error("No se grabó audio.");
          return;
        }
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "audio.webm");
          const res = await fetch("/api/copilot/transcribe", {
            method: "POST",
            body: fd,
          });
          const d = (await res.json()) as { text?: string; error?: string };
          if (d.error || !d.text) {
            toast.error(d.error ?? "No se pudo transcribir, intenta de nuevo.");
          } else {
            setDraft((prev) => (prev ? `${prev} ${d.text}` : d.text!));
          }
        } catch {
          toast.error("Error de red transcribiendo.");
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      console.error("[copilot mic]", err);
      toast.error("No se pudo acceder al micrófono.");
    }
  }, [recording, transcribing, loading]);

  const detenerGrabacion = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    recorderRef.current = null;
    stopRecordingTimer();
    setRecording(false);
    setRecordingSeconds(0);
  }, [stopRecordingTimer]);

  // Cleanup al desmontar / cerrar drawer.
  useEffect(() => {
    return () => {
      cancelarGrabacion();
    };
  }, [cancelarGrabacion]);

  const cargarConversacion = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/copilot/conversaciones/${id}`);
      const d = (await res.json()) as {
        conversacion?: { id: string; mensajes: CopilotMessage[] };
        error?: string;
      };
      if (d.error || !d.conversacion) {
        setError(d.error ?? "No se pudo cargar la conversación.");
        return;
      }
      setMessages(d.conversacion.mensajes);
      setConversacionId(d.conversacion.id);
      setContextSnapshot(null);
      setDraft("");
      setShowHistory(false);
    } catch {
      setError("Error de red cargando conversación.");
    }
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || loading) return;
    setError(null);
    const newUserMsg: CopilotMessage = { role: "user", content: text };
    const next = [...messages, newUserMsg];
    setMessages(next);
    setDraft("");
    setLoading(true);

    try {
      const body: CopilotChatRequest = {
        messages: next,
        selectedClinicaId: selectedClinicaId ?? null,
        conversacionId: conversacionId ?? null,
        ...(contextSnapshot ? { context: contextSnapshot } : {}),
      };
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as CopilotChatResponse;
      if (d.error) setError(d.error);
      if (d.conversacionId) setConversacionId(d.conversacionId);
      if (d.archivado) {
        toast.info("Conversación archivada por longitud, abriendo nueva.");
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: d.reply ?? "(sin respuesta)",
          actions: d.actions,
          toolCallsTrace: d.toolCallsTrace,
        },
      ]);
    } catch {
      setError("Error de conexión con el Copilot.");
    } finally {
      setLoading(false);
    }
  }

  // Sprint 14b Bloque 8 hotfix — cancelar marca la action en el estado
  // local sin disparar el endpoint. Visualmente queda como "cancelada"
  // (gris + label tachado).
  function cancelarAccion(action: CopilotAction, msgIndex: number) {
    if (executingActionId) return;
    setMessages((prev) => {
      const copy = [...prev];
      const msg = copy[msgIndex];
      if (msg && msg.actions) {
        copy[msgIndex] = {
          ...msg,
          actions: msg.actions.map((a) =>
            a.id === action.id
              ? { ...a, params: { ...a.params, _cancelled: true } }
              : a,
          ),
        };
      }
      return copy;
    });
  }

  async function ejecutarAccion(action: CopilotAction, msgIndex: number) {
    if (executingActionId) return;
    setExecutingActionId(action.id);
    try {
      const res = await fetch("/api/copilot/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, selectedClinicaId: selectedClinicaId ?? null }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      const reply =
        d.ok && d.message ? d.message : d.error ? `❌ ${d.error}` : "Acción ejecutada.";
      // Sprint 12 F — toast bottom-right confirma sin distraer del chat.
      if (d.ok) {
        toast.success(d.message ?? "Acción ejecutada.");
      } else if (d.error) {
        toast.error(d.error);
      }
      setMessages((prev) => {
        const copy = [...prev];
        const msg = copy[msgIndex];
        if (msg && msg.actions) {
          copy[msgIndex] = {
            ...msg,
            actions: msg.actions.map((a) =>
              a.id === action.id ? { ...a, params: { ...a.params, _executed: true } } : a,
            ),
          };
        }
        copy.push({ role: "assistant", content: reply });
        return copy;
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "❌ Error al ejecutar la acción." },
      ]);
    } finally {
      setExecutingActionId(null);
    }
  }

  // Placeholder durante SSR — mismas dimensiones que el FAB para evitar
  // layout shift al hidratar (no afecta CLS). aria-hidden porque no es
  // interactivo. El FAB real se monta en el primer effect cliente.
  if (!mounted) {
    return (
      <div
        aria-hidden
        className="fixed bottom-5 right-5 z-40 w-14 h-14 pointer-events-none"
      />
    );
  }

  return (
    <>
      {/* Sprint 13.1 Bloque 1 — FAB renderizado solo client-side post-mount.
          Sustituimos blur-[1px] (arbitrary, propenso a SSR/CSR mismatch)
          por blur-sm (clase Tailwind nativa). Identidad visual del FAB
          intacta: gradiente violet, sombra coloreada, anillo interior. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir Fyllio Copilot"
        className="fyllio-copilot-fab fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-500/30 backdrop-blur-sm hover:scale-105 hover:shadow-xl hover:shadow-violet-500/40 transition-all duration-200 flex items-center justify-center"
      >
        <span
          aria-hidden
          className="absolute inset-1 rounded-full bg-violet-700/40 blur-sm"
        />
        <Sparkles size={22} strokeWidth={ICON_STROKE} className="relative" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          {/* Sprint 13 Bloque 7.2 — drawer 420px, fondo slate-50 para que
              las burbujas blancas del Copilot destaquen. */}
          <aside className="relative w-full max-w-[420px] bg-slate-50 shadow-md flex flex-col h-full overflow-hidden">
            <header className="px-5 py-4 border-b border-[var(--color-border)] bg-white flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 tracking-tight">
                  Copilot
                </h2>
                <p className="text-[11px] text-slate-500">
                  {contextSnapshot
                    ? `Contexto: ${contextLabel(contextSnapshot.kind)}`
                    : "Sonnet 4.6 · Lectura + acciones"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-[11px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors"
                  >
                    Reiniciar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  aria-label="Historial"
                  className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-md flex items-center justify-center hover:bg-slate-100 transition-colors"
                >
                  <History size={16} strokeWidth={2.25} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-md flex items-center justify-center hover:bg-slate-100 transition-colors"
                  aria-label="Cerrar"
                >
                  <X size={16} strokeWidth={ICON_STROKE} />
                </button>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.length === 0 && !loading && (
                <Suggestions onPick={(q) => setDraft(q)} />
              )}
              {messages.map((m, i) => (
                <ChatBubble
                  key={i}
                  message={m}
                  msgIndex={i}
                  onAction={ejecutarAccion}
                  onCancel={cancelarAccion}
                  executingActionId={executingActionId}
                />
              ))}
              {loading && <ThinkingDots />}
              {error && (
                <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </div>

            <footer className="border-t border-[var(--color-border)] bg-white p-3 shrink-0">
              {recording && (
                <div className="mb-2 flex items-center gap-2 text-[11px] text-rose-600">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  Grabando · {Math.floor(recordingSeconds / 60)}:
                  {String(recordingSeconds % 60).padStart(2, "0")}
                  <button
                    type="button"
                    onClick={cancelarGrabacion}
                    className="ml-auto text-slate-500 hover:text-slate-900"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {transcribing && (
                <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                  Transcribiendo…
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Escribe a Fyllio…"
                  disabled={loading}
                  className="flex-1 text-sm px-3 py-2 rounded-md border border-slate-200 focus:border-violet-300 focus:ring-2 focus:ring-violet-100 outline-none resize-none max-h-32"
                />
                <button
                  type="button"
                  onClick={recording ? detenerGrabacion : empezarGrabacion}
                  disabled={loading || transcribing}
                  aria-label={recording ? "Detener grabación" : "Grabar audio"}
                  className={`w-9 h-9 rounded-md disabled:opacity-40 transition-colors flex items-center justify-center ${
                    recording
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {recording ? (
                    <Square size={14} strokeWidth={2.25} />
                  ) : (
                    <Mic size={16} strokeWidth={2.25} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || loading}
                  aria-label="Enviar"
                  className="w-9 h-9 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center justify-center"
                >
                  <ArrowUp size={16} strokeWidth={ICON_STROKE} />
                </button>
              </div>
            </footer>

            {showHistory && (
              <HistoryPanel
                onClose={() => setShowHistory(false)}
                onPick={cargarConversacion}
                activeId={conversacionId}
              />
            )}
          </aside>
        </div>
      )}
    </>
  );
}

// ─── Sprint 16a Bloque 1 — panel historial ───────────────────────────────

function HistoryPanel({
  onClose,
  onPick,
  activeId,
}: {
  onClose: () => void;
  onPick: (id: string) => void;
  activeId: string | null;
}) {
  type Resumen = {
    id: string;
    titulo: string;
    mensajeCount: number;
    updatedAt: string;
  };
  const [items, setItems] = useState<Resumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/copilot/conversaciones?limit=10");
        const d = (await res.json()) as { conversaciones?: Resumen[]; error?: string };
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else setItems(d.conversaciones ?? []);
      } catch {
        if (!cancelled) setErr("No se pudo cargar el historial.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function relTime(iso: string): string {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const diff = Date.now() - t;
    const min = Math.round(diff / 60_000);
    if (min < 1) return "ahora";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return `hace ${d} d`;
  }

  return (
    <div className="absolute inset-0 z-10 flex">
      <div
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative w-80 max-w-full bg-white shadow-xl border-r border-slate-200 flex flex-col h-full">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-slate-900">Historial</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"
            aria-label="Cerrar historial"
          >
            <X size={14} strokeWidth={ICON_STROKE} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <p className="text-xs text-slate-400 px-3 py-4 animate-pulse">
              Cargando…
            </p>
          )}
          {err && (
            <p className="text-xs text-rose-600 px-3 py-4">{err}</p>
          )}
          {!loading && !err && items.length === 0 && (
            <p className="text-xs text-slate-400 px-3 py-6 text-center">
              Aún no tienes conversaciones guardadas.
            </p>
          )}
          {!loading && !err && items.length > 0 && (
            <ul className="space-y-1">
              {items.map((it) => {
                const ageDays =
                  (Date.now() - new Date(it.updatedAt).getTime()) / 86_400_000;
                const old = ageDays > 7;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onPick(it.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        activeId === it.id
                          ? "border-violet-300 bg-violet-50"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-[13px] font-medium text-slate-900 line-clamp-2">
                        {it.titulo}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {relTime(it.updatedAt)} · {it.mensajeCount} msg
                        {old && (
                          <span className="ml-2 text-amber-600">· antigua</span>
                        )}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function contextLabel(kind: CopilotContextSnapshot["kind"]): string {
  switch (kind) {
    case "lead":
      return "Lead seleccionado";
    case "presupuesto":
      return "Presupuesto seleccionado";
    case "red_admin":
      return "Red — rendimiento del mes";
    case "lead_perdido":
      return "Lead perdido — análisis";
    case "presupuesto_perdido":
      return "Presupuesto perdido — análisis";
    case "kpi":
      return "KPI seleccionado";
  }
}

function Suggestions({ onPick }: { onPick: (q: string) => void }) {
  // Sprint 14b Bloque 8 — añadidos ejemplos del modulo financiero al
  // pool de sugerencias iniciales. Mezcla pre-cobro y post-cobro para
  // que la coordinadora descubra ambas familias de capacidades.
  const SUGS = [
    "¿Cuántos leads tengo sin gestionar hoy?",
    "¿Cuántos pagos pendientes tengo este mes?",
    "Muéstrame los cobros vencidos.",
    "¿Cuánto facturé esta semana?",
    "¿Cuántos presupuestos están en negociación?",
    "Buenas prácticas para captar leads de ortodoncia",
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Algunas ideas:</p>
      <div className="flex flex-col gap-1.5">
        {SUGS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-left text-xs px-3 py-2 rounded-xl bg-white hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 text-[var(--color-foreground)] border border-[var(--color-border)] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  msgIndex,
  onAction,
  onCancel,
  executingActionId,
}: {
  message: CopilotMessage;
  msgIndex: number;
  onAction: (a: CopilotAction, idx: number) => void;
  onCancel: (a: CopilotAction, idx: number) => void;
  executingActionId: string | null;
}) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] ml-8 px-3 py-2 bg-violet-50 text-slate-900 border border-violet-100 rounded-2xl rounded-tr-sm">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2">
      <div className="w-6 h-6 shrink-0 rounded-md bg-gradient-to-br from-violet-600 to-violet-500 text-white flex items-center justify-center mt-0.5">
        <Sparkles size={12} strokeWidth={ICON_STROKE} />
      </div>
      <div className="max-w-[85%] flex flex-col gap-1.5">
        {/* Sprint 13.1 Bloque 5 — mini-cards de tool calls antes del bubble. */}
        {message.toolCallsTrace && message.toolCallsTrace.length > 0 && (
          <ToolCallsTrace trace={message.toolCallsTrace} />
        )}
        <div className="px-3 py-2 bg-white text-slate-900 border border-slate-100 rounded-2xl rounded-tl-sm shadow-[var(--card-shadow-rest)]">
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
          {renderAssistantContent(message.content)}
        </p>
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {message.actions.map((a) => {
              const executed = (a.params as { _executed?: boolean })._executed === true;
              const cancelled = (a.params as { _cancelled?: boolean })._cancelled === true;
              // Sprint 14b Bloque 8 hotfix — el server marca _unresolved
              // cuando no pudo resolver el paciente por nombre. La action
              // queda como info-only (preview con instrucción al usuario)
              // y el botón Confirmar no aparece.
              const unresolved = (a.params as { _unresolved?: boolean })._unresolved === true;
              const busy = executingActionId === a.id;
              const settled = executed || cancelled;
              return (
                <div key={a.id} className="flex flex-col gap-1.5">
                  {/* Sprint 14b Bloque 8 hotfix — preview rico (mensaje
                      WA renderizado, resumen de pago, etc.). Cuadro
                      destacado para que la coordinadora confíe en lo
                      que va a confirmar. Si unresolved, el preview es
                      una instrucción al usuario y se renderiza en
                      ámbar para distinguirlo. */}
                  {a.preview && !settled && (
                    <div
                      className={
                        unresolved
                          ? "rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 whitespace-pre-wrap leading-relaxed"
                          : "rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed"
                      }
                    >
                      {a.preview}
                    </div>
                  )}
                  {settled ? (
                    <div
                      className={`text-xs font-medium px-3 py-1.5 rounded-md border text-left ${
                        executed
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-slate-100 border-slate-200 text-slate-400 line-through"
                      }`}
                    >
                      {executed ? "✓ " : "✕ "}
                      {a.label}
                    </div>
                  ) : unresolved ? (
                    // Action sin paciente resuelto: mostramos solo el
                    // preview (instrucción) sin botón Confirmar.
                    <div className="text-[11px] text-amber-700 italic">
                      ⚠ Acción sin destinatario resuelto. Sigue la
                      instrucción de arriba.
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onCancel(a, msgIndex)}
                        disabled={busy}
                        className="text-xs font-medium px-3 py-1.5 rounded-md border bg-white border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => onAction(a, msgIndex)}
                        disabled={busy}
                        className={`flex-1 text-xs font-semibold px-3 py-1.5 rounded-md border text-left transition-colors ${
                          busy
                            ? "bg-slate-100 text-slate-500 border-slate-200"
                            : "bg-violet-600 border-violet-600 text-white hover:bg-violet-700"
                        }`}
                        title={a.description}
                      >
                        {busy ? "⏳ Ejecutando…" : `✓ ${a.label}`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// Sprint 13.1 Bloque 5 — mini-cards inline con las read-tools
// ejecutadas durante el turn del assistant. Si hay >3 calls, colapsamos
// las del medio detras de un boton "Mostrar N mas".
function ToolCallsTrace({
  trace,
}: {
  trace: Array<{ name: string; params: Record<string, unknown> }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalHidden = Math.max(0, trace.length - 3);
  // Visibles: si <=3, todas. Si >3 sin expandir, primera + ultima.
  const visibleIndexes =
    trace.length <= 3 || expanded
      ? trace.map((_, i) => i)
      : [0, trace.length - 1];
  const hiddenCount = trace.length - visibleIndexes.length;
  return (
    <div className="space-y-1">
      {visibleIndexes.map((idx, posInVisible) => {
        const t = trace[idx]!;
        const insertCollapseHere =
          !expanded && trace.length > 3 && posInVisible === 0;
        const params = formatParams(t.params);
        return (
          <div key={idx}>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex items-start gap-2">
              <Wrench size={14} strokeWidth={ICON_STROKE} className="text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono font-semibold text-slate-700 truncate">
                  {t.name}
                </p>
                {params && (
                  <p className="text-xs font-mono text-slate-500 truncate">{params}</p>
                )}
              </div>
            </div>
            {insertCollapseHere && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="my-1 mx-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
              >
                ▾ Mostrar {hiddenCount} más
              </button>
            )}
          </div>
        );
      })}
      {expanded && totalHidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
        >
          ▴ Colapsar
        </button>
      )}
    </div>
  );
}

function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([k]) => k !== "_executed",
  );
  if (entries.length === 0) return "";
  return entries
    .slice(0, 4)
    .map(([k, v]) => {
      const sv = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${sv.length > 24 ? sv.slice(0, 24) + "…" : sv}`;
    })
    .join(", ");
}

function ThinkingDots() {
  return (
    <div className="flex justify-start gap-2">
      <div className="w-6 h-6 shrink-0 rounded-md bg-gradient-to-br from-violet-600 to-violet-500 text-white flex items-center justify-center mt-0.5">
        <Sparkles size={12} strokeWidth={ICON_STROKE} />
      </div>
      <div className="px-3 py-3 bg-white border border-slate-100 rounded-2xl rounded-tl-sm shadow-[var(--card-shadow-rest)] flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce"
            style={{ animationDelay: `${i * 120}ms`, animationDuration: "1s" }}
          />
        ))}
      </div>
    </div>
  );
}
