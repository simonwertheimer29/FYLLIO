"use client";
// Micro-visualización del Inicio (modelo aprobado 06-09-2026). La FORMA dice
// lo que antes había que leer: proporciones, una cola apilada, longitudes en
// la tabla, un bullet de Few y sparklines. Reglas: una sola familia de color
// (el acento), rojo solo donde hay que actuar, sin ejes ni leyendas — el
// texto de al lado ya es la leyenda. Nada de gradientes ni paletas.
//
// Todo color es un token (`var(--color-*)`): funciona en claro y oscuro solo.
import { ICON_STROKE } from "../../components/icons";

/** Barra de proporción bajo una cifra «n de total». Con n = 0 el carril queda
 *  vacío y punteado: el cero salta a la vista sin pintarlo de rojo (no es una
 *  acción pendiente, es un dato que importa). */
export function BarraProporcion({ n, total, className = "" }: { n: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : 0;
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)] ${n === 0 ? "outline outline-1 -outline-offset-1 outline-dashed outline-[var(--color-muted)]/40" : ""} ${className}`}
      role="img"
      aria-label={`${n} de ${total}`}
    >
      <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Barra apilada: las partes en orden, 2 px de aire entre ellas. El color es
 *  semántico (ámbar = necesita respuesta, azul = listo, rojo = fuera de plazo). */
export function BarraApilada({ partes, className = "" }: { partes: Array<{ n: number; color: string; etiqueta: string }>; className?: string }) {
  const total = partes.reduce((s, p) => s + p.n, 0);
  return (
    <div className={`flex h-3 w-full gap-0.5 overflow-hidden rounded ${className}`} role="img" aria-label={partes.map((p) => `${p.etiqueta} ${p.n}`).join(" · ")}>
      {total === 0 ? (
        <div className="h-full w-full rounded bg-[var(--color-border)]" />
      ) : (
        partes.filter((p) => p.n > 0).map((p) => <div key={p.etiqueta} className="h-full" style={{ flex: p.n, background: p.color }} title={`${p.etiqueta}: ${p.n}`} />)
      )}
    </div>
  );
}

/** Bullet de Few: barra = medida de hoy, marca = hace 7 días, bandas = rango en
 *  que se movió el último mes (mín–máx de las fotos). Segunda barra fina roja =
 *  lo vencido, misma escala. Sin ejes: la etiqueta de la marca basta. */
export function Bullet({
  hoy,
  hace7,
  bandaMin,
  bandaMax,
  rojo,
  etiquetaMarca,
  formato,
}: {
  hoy: number;
  hace7: number | null;
  bandaMin: number | null;
  bandaMax: number | null;
  rojo: number | null;
  etiquetaMarca: string | null;
  formato: (v: number) => string;
}) {
  // La escala la fija el mayor valor en juego con un 15 % de aire, para que la
  // marca de hace 7 días nunca caiga fuera de la barra.
  const max = Math.max(hoy, hace7 ?? 0, bandaMax ?? 0, rojo ?? 0, 1) * 1.15;
  const pct = (v: number) => `${((v / max) * 100).toFixed(2)}%`;
  return (
    <div className="relative mt-3 h-3.5" role="img" aria-label={`Hoy ${formato(hoy)}${hace7 != null ? `, hace 7 días ${formato(hace7)}` : ""}`}>
      {bandaMax != null && bandaMax > 0 && (
        <div className="absolute inset-y-0 left-0 rounded bg-[var(--color-border)]/60" style={{ width: pct(bandaMax) }} />
      )}
      {bandaMin != null && bandaMax != null && bandaMax > bandaMin && (
        <div className="absolute inset-y-0 rounded bg-[var(--color-border)]" style={{ left: pct(bandaMin), width: pct(bandaMax - bandaMin) }} />
      )}
      <div className="absolute left-0 top-1 h-1.5 rounded-r bg-[var(--color-accent)]" style={{ width: pct(hoy) }} />
      {rojo != null && rojo > 0 && <div className="absolute left-0 top-[11px] h-[3px] rounded-r bg-[var(--color-danger)]" style={{ width: pct(rojo) }} />}
      {hace7 != null && (
        <div className="absolute -top-0.5 h-5 w-0.5 rounded-sm bg-[var(--color-foreground)]" style={{ left: pct(hace7) }}>
          {etiquetaMarca && (
            <span className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap text-[10.5px] tabular-nums text-[var(--color-muted)]">{etiquetaMarca}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Sparkline: una línea fina, área tenue y el punto final marcado. Sin ejes.
 *  Los huecos (null) cortan la línea en vez de inventar un valor. Con menos de
 *  dos puntos no se pinta: el caller enseña texto. */
export function Sparkline({
  valores,
  ancho = 64,
  alto = 20,
  rojo = false,
  className = "",
}: {
  valores: Array<number | null>;
  ancho?: number;
  alto?: number;
  rojo?: boolean;
  className?: string;
}) {
  const nums = valores.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const mn = Math.min(...nums);
  const mx = Math.max(...nums);
  const span = mx - mn || 1;
  const x = (i: number) => (valores.length === 1 ? 0 : (i / (valores.length - 1)) * ancho);
  const y = (v: number) => alto - 2 - ((v - mn) / span) * (alto - 4);
  const color = rojo ? "var(--color-danger)" : "var(--color-accent)";
  // Tramos continuos (un null parte la línea).
  const tramos: string[] = [];
  let actual: string[] = [];
  valores.forEach((v, i) => {
    if (v == null) {
      if (actual.length) tramos.push(actual.join(" "));
      actual = [];
    } else actual.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (actual.length) tramos.push(actual.join(" "));
  const plano = mx === mn;
  let ultimoI = valores.length - 1;
  while (ultimoI >= 0 && valores[ultimoI] == null) ultimoI--;
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} preserveAspectRatio="none" className={`overflow-visible ${className}`} aria-hidden>
      {!plano && tramos.length === 1 && valores.every((v) => v != null) && (
        <polygon points={`0,${alto} ${tramos[0]} ${ancho},${alto}`} fill={color} opacity={0.12} />
      )}
      {tramos.map((t, i) => (
        <polyline key={i} points={t} fill="none" stroke={color} strokeWidth={ICON_STROKE} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {ultimoI >= 0 && <circle cx={x(ultimoI)} cy={y(valores[ultimoI] as number)} r={2.2} fill={color} />}
    </svg>
  );
}

/** Cifra de tabla con una barra fina debajo: la longitud es la codificación
 *  más precisa y convierte la columna en un ranking legible. */
export function CifraConBarra({ valor, max, rojo = false, children }: { valor: number; max: number; rojo?: boolean; children: React.ReactNode }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  return (
    <span className="relative inline-block min-w-[6.5rem] text-right">
      <span className="relative inline-block pb-0.5">{children}</span>
      <span className="absolute inset-x-0 -bottom-[3px] h-[3px] rounded-sm bg-[var(--color-border)]">
        <span className={`absolute inset-y-0 right-0 rounded-sm ${rojo ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** Fila de desplegable: etiqueta, cifra y una barra proporcional al máximo del
 *  grupo. Para «de qué está hecho», «por sede», «cuánto esperan». */
export function FilaBarra({ etiqueta, valor, max, texto, rojo = false, tenue = false }: { etiqueta: string; valor: number; max: number; texto: string; rojo?: boolean; tenue?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  return (
    <li className="py-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate">{etiqueta}</span>
        <b className={`shrink-0 font-semibold tabular-nums ${rojo ? "text-[var(--color-danger)]" : "text-[var(--color-foreground)]"}`}>{texto}</b>
      </div>
      <div className={`mt-0.5 h-[5px] overflow-hidden rounded-sm bg-[var(--color-border)] ${tenue ? "opacity-50" : ""}`}>
        <div className={`h-full rounded-sm ${rojo ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}
