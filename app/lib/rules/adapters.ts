// app/lib/rules/adapters.ts
import type { RulesState } from "../types";

export type ClinicRules = Pick<
  RulesState,
  | "dayStartTime"
  | "dayEndTime"
  | "lunchStartTime"
  | "lunchEndTime"
  | "enableLunch"
  | "minBookableSlotMin"
  | "chairsCount"
  | "workSat"
  | "enableBuffers"
  | "bufferMin"
  | "longGapThreshold"
  | "maxRescheduleShiftMin"
  | "maxGapPanels"
  | "maxReschedules"
  | "treatmentOrder"
  | "treatments"
  | "extraRulesText"
>;

export type ImpactAssumptions = Pick<
  RulesState,
  | "adminMinPerAutoAction"
  | "workdaysPerMonth"
  | "minPerMessageOrCallAvoided"
>;

export function mergeRules(clinic: ClinicRules, impact: ImpactAssumptions): RulesState {
  return { ...clinic, ...impact } as RulesState;
}

export function splitRules(rules: RulesState): { clinic: ClinicRules; impact: ImpactAssumptions } {
  const {
    dayStartTime,
    dayEndTime,
    lunchStartTime,
    lunchEndTime,
    enableLunch,

    minBookableSlotMin,
    chairsCount,
    workSat,

    enableBuffers,
    bufferMin,

    longGapThreshold,
    maxRescheduleShiftMin,
    maxGapPanels,
    maxReschedules,

    treatmentOrder,
    treatments,
    extraRulesText,

    adminMinPerAutoAction,
    workdaysPerMonth,
    minPerMessageOrCallAvoided,
  } = rules;

  return {
    clinic: {
      dayStartTime,
      dayEndTime,
      lunchStartTime,
      lunchEndTime,
      enableLunch,

      minBookableSlotMin,
      chairsCount,
      workSat,

      enableBuffers,
      bufferMin,

      longGapThreshold,
      maxRescheduleShiftMin,
      maxGapPanels,
      maxReschedules,

      treatmentOrder,
      treatments,
      extraRulesText,
    },
    impact: {
      adminMinPerAutoAction,
      workdaysPerMonth,
      minPerMessageOrCallAvoided,
    },
  };
}
