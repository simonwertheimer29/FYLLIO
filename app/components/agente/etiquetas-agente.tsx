// app/components/agente/etiquetas-agente.tsx
//
// El VOCABULARIO EN PALABRAS de lo que decide el agente, compartido por el
// banco de pruebas («Qué ha hecho por dentro») y el inspector de Mensajería
// («Ver por qué», MEJORAS 183). Vivían como constantes locales del banco; al
// enseñar lo mismo en dos sitios, dos diccionarios se desincronizan y la
// coordinadora lee dos nombres para la misma cosa (esencia §6, patrones
// paralelos). Módulo PURO: sin base, sin Node — lo importan componentes de
// cliente como valor (§22/§24).

import type { ReactNode } from "react";

/** De qué habla el turno (juicio `tema`, canónico en el borde). */
export const ETIQUETA_TEMA: Record<string, string> = {
  cobro: "su pago pendiente",
  presupuesto: "su presupuesto",
  cita: "una cita",
  identificar: "quién es",
  otro: "otra cosa (logística, agradecimiento…)",
  ninguno: "no se entiende",
};

/** Por qué entregó el caso (`causa_derivacion`, 022/023/034). */
export const ETIQUETA_CAUSA: Record<string, string> = {
  peticion_queja: "pidió una persona o se quejó",
  urgencia: "urgencia médica",
  insistencia: "insistió sobre algo aplazado",
  caso_completo: "caso completo — lo entrega listo",
  antecedente_medico: "mencionó un antecedente médico con cita próxima",
  no_legible: "mandó algo que el agente no puede leer (audio, foto, documento…)",
};

/** Por qué el control de seguridad descartó el borrador (`borradorDescartado.motivo`). */
export const ETIQUETA_MOTIVO_JUEZ: Record<string, string> = {
  clinica: "afirmaba algo clínico",
  economica: "comprometía dinero no decidido",
  datos_sensibles: "soltaba un dato de salud no pedido",
  promesa: "prometía algo que nadie iba a hacer",
  agenda: "afirmaba huecos que no ve, o se comprometía a reservar la cita",
  sin_categoria: "infringía una regla dura",
  juez_no_respondio: "el control no respondió (se descartó por seguridad)",
};

export function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{titulo}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export function Tag({ tono, children }: { tono: "danger" | "warning" | "neutro"; children: ReactNode }) {
  const cls =
    tono === "danger"
      ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : tono === "warning"
        ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
        : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";
  return <span className={`ml-1 rounded px-1 py-px text-[10.5px] font-semibold ${cls}`}>{children}</span>;
}
