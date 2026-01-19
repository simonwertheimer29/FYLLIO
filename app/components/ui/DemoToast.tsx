"use client";

export type ToastKind = "INFO" | "SUCCESS" | "WARN";

export default function DemoToast({
  show,
  kind,
  title,
  message,
  onClose,
}: {
  show: boolean;
  kind: ToastKind;
  title: string;
  message?: string;
  onClose?: () => void;
}) {
  if (!show) return null;

  const cls =
    kind === "SUCCESS"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : kind === "WARN"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-white text-slate-900";

  return (
    <div className="fixed top-5 left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2">
      <div className={`rounded-3xl border shadow-lg px-5 py-4 ${cls}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-bold">{title}</p>
            {message ? <p className="mt-1 text-xs opacity-90">{message}</p> : null}
          </div>

          {onClose ? (
            <button
              onClick={onClose}
              className="text-[11px] rounded-full bg-white/70 border border-slate-200 px-3 py-1 font-semibold hover:bg-white"
            >
              Cerrar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
