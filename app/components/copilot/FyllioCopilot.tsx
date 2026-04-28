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

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  CopilotAction,
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotContextSnapshot,
  CopilotMessage,
} from "./types";
import { useClinic } from "../../lib/context/ClinicContext";
import { Sparkles, ArrowUp, X, ICON_STROKE } from "../icons";

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
        ...(contextSnapshot ? { context: contextSnapshot } : {}),
      };
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as CopilotChatResponse;
      if (d.error) setError(d.error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: d.reply ?? "(sin respuesta)",
          actions: d.actions,
        },
      ]);
    } catch {
      setError("Error de conexión con el Copilot.");
    } finally {
      setLoading(false);
    }
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
                  onClick={send}
                  disabled={!draft.trim() || loading}
                  aria-label="Enviar"
                  className="w-9 h-9 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center justify-center"
                >
                  <ArrowUp size={16} strokeWidth={ICON_STROKE} />
                </button>
              </div>
            </footer>
          </aside>
        </div>
      )}
    </>
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
  const SUGS = [
    "¿Cuántos leads tengo sin gestionar hoy?",
    "¿Cuántos presupuestos están en negociación?",
    "Buenas prácticas para captar leads de ortodoncia",
    "¿Cómo cambio el estado de un lead?",
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
  executingActionId,
}: {
  message: CopilotMessage;
  msgIndex: number;
  onAction: (a: CopilotAction, idx: number) => void;
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
      <div className="max-w-[85%] px-3 py-2 bg-white text-slate-900 border border-slate-100 rounded-2xl rounded-tl-sm shadow-[var(--card-shadow-rest)]">
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {message.actions.map((a) => {
              const executed = (a.params as { _executed?: boolean })._executed === true;
              const busy = executingActionId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onAction(a, msgIndex)}
                  disabled={executed || busy}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md border text-left transition-colors ${
                    executed
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : busy
                        ? "bg-slate-100 text-slate-500 border-slate-200"
                        : "bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                  }`}
                  title={a.description}
                >
                  {executed ? "✓ " : busy ? "⏳ " : "▶ "}
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
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
