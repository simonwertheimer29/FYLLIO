// app/components/ui/Skeleton.tsx
//
// Sprint 15 Bloque 3 — primitivos de loading skeleton consistentes.
// La clase .fyllio-skeleton (definida en globals.css, Sprint 12 F)
// pinta el shimmer suave; estos componentes le dan dimensiones
// estándar para los layouts más comunes.

type SkeletonProps = {
  className?: string;
  width?: string | number;
  height?: string | number;
};

/** Skeleton genérico — pasa width/height inline o className extra. */
export function Skeleton({ className = "", width, height }: SkeletonProps) {
  return (
    <div
      className={`fyllio-skeleton ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** Línea de texto, alto 14px por defecto. */
export function SkeletonText({
  width = "100%",
  className = "",
}: {
  width?: string | number;
  className?: string;
}) {
  return <Skeleton className={`h-3 ${className}`} width={width} />;
}

/** Card placeholder con label + valor — para KPI hero cards. */
export function KpiCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-7 w-32 mt-3" />
    </div>
  );
}

/** Fila de tabla genérica con N columnas. */
export function TableRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <tr className="border-t border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <Skeleton className="h-3" width={i === 0 ? "60%" : "80%"} />
        </td>
      ))}
    </tr>
  );
}

/** Bloque card genérico — para listas tipo CobrosTabView. */
export function CardListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-48" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
