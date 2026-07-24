// Tipos cliente del módulo Cobros — espejo del payload de /api/cobros.

export type UrgenciaCobro = "vencido" | "por_vencer" | "estancado" | "normal";
export type EstadoCobro = "pagado" | "parcial" | "pendiente" | "vencido";

export type CobroItem = {
  pacienteId: string;
  nombre: string;
  telefono: string | null;
  clinicaId: string | null;
  clinicaNombre: string | null;
  doctorLinkId: string | null;
  doctorNombre: string | null;
  tratamientos: string[];
  firmado: number;
  pagado: number;
  pendiente: number;
  fechaAceptado: string | null;
  diasDesdeAceptacion: number | null;
  plazoDias: number;
  diasVencido: number | null;
  diasParaVencer: number | null;
  urgencia: UrgenciaCobro;
  estadoCobro: EstadoCobro;
  numPagos: number;
  ultimoPagoISO: string | null;
  ultimaContactoCobranzaISO: string | null;
  diasDesdeUltimaContacto: number | null;
};

export type CobrosApiResponse = {
  kpis: {
    pendienteTotal: number;
    vencidoTotal: number;
    cobradoMes: { valor: number; previo: number };
  };
  items: CobroItem[];
  doctoresDisponibles: Array<{ id: string; nombre: string }>;
  clinicasDisponibles: Array<{ id: string; nombre: string }>;
};

export const fmtEUR = (n: number) =>
  `${n.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

/** Copy de dos niveles de la card/panel (patrón del dashboard de Red). */
export function copyEstado(item: CobroItem): { titular: string; detalle: string } {
  const pagoTxt =
    item.pagado > 0
      ? `Ha pagado ${fmtEUR(item.pagado)} de ${fmtEUR(item.firmado)}`
      : `Sin ningún pago de ${fmtEUR(item.firmado)}`;
  if (item.urgencia === "vencido" && item.diasVencido != null) {
    return {
      titular: `Vencido hace ${item.diasVencido} días`,
      detalle: `${pagoTxt} · plazo de ${item.plazoDias} días cumplido`,
    };
  }
  if (item.urgencia === "por_vencer" && item.diasParaVencer != null) {
    const cuando =
      item.diasParaVencer === 0
        ? "Vence hoy"
        : item.diasParaVencer === 1
          ? "Vence mañana"
          : `Vence en ${item.diasParaVencer} días`;
    return { titular: cuando, detalle: `${pagoTxt} · plazo de ${item.plazoDias} días` };
  }
  if (item.urgencia === "estancado") {
    return {
      titular: "Aceptado sin ningún pago",
      detalle: `Firmó ${fmtEUR(item.firmado)} hace ${item.diasDesdeAceptacion ?? "?"} días · sin movimientos`,
    };
  }
  return {
    titular: item.pendiente > 0 ? "Pago en curso" : "Al día",
    detalle:
      item.diasDesdeAceptacion != null
        ? `${pagoTxt} · aceptado hace ${item.diasDesdeAceptacion} días`
        : pagoTxt,
  };
}
