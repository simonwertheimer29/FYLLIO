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
import type {
  CopilotAction,
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotContextSnapshot,
  CopilotMessage,
} from "./types";

type OpenEventDetail = {
  context?: CopilotContextSnapshot;
  initialAssistantMessage?: string;
};

export function FyllioCopilot() {
  const [open, setOpen] = useState(false);
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
        body: JSON.stringify({ action }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      const reply =
        d.ok && d.message ? d.message : d.error ? `❌ ${d.error}` : "Acción ejecutada.";
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir Fyllio Copilot"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-purple-700 text-white shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center"
      >
        <span className="text-2xl">✨</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
            <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Fyllio Copilot</h2>
                <p className="text-[11px] text-slate-500">
                  {contextSnapshot
                    ? `Contexto: ${contextLabel(contextSnapshot.kind)}`
                    : "Pregúntame lo que necesites"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Reiniciar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-slate-700 text-lg"
                  aria-label="Cerrar"
                >
                  ×
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
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-bl-sm px-3 py-2 text-xs italic">
                    Escribiendo<span className="animate-pulse">…</span>
                  </div>
                </div>
              )}
              {error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </div>

            <footer className="border-t border-slate-200 p-3 shrink-0">
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
                  className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none max-h-32"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || loading}
                  className="text-sm font-bold px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
                >
                  ↑
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
            className="text-left text-xs px-3 py-2 rounded-xl bg-slate-50 hover:bg-violet-50 hover:text-violet-700 text-slate-700 border border-slate-200"
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
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3 py-2 ${
          isUser
            ? "ml-8 bg-violet-600 text-white rounded-2xl rounded-br-sm"
            : "mr-8 bg-slate-100 text-slate-900 rounded-2xl rounded-bl-sm"
        }`}
      >
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        {!isUser && message.actions && message.actions.length > 0 && (
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
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border text-left transition-colors ${
                    executed
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : busy
                        ? "bg-slate-200 text-slate-500 border-slate-200"
                        : "bg-white border-violet-200 text-violet-700 hover:bg-violet-50"
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
