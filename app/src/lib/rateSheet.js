// The customer-facing rate sheet: the shop's standard hourly rates (the labor
// rate card and support rate in Settings → Proposals) with the overtime and
// double-time rates worked out, and the terms for premium time, travel and
// living. Everything the sheet says comes from here and settings.rateSheet
// (Settings → Proposals → Rate Sheet), so it is always current.
import { proposalConfig } from "../calc/proposals.js";
import { ROLE_LABELS } from "../calc/estimates.js";
import { round2 } from "../calc/ledger.js";
import { todayISO } from "./helpers.js";

export const DEFAULT_HOLIDAYS = [
  "New Year's Day", "Memorial Day", "Independence Day", "Labor Day",
  "Thanksgiving Day", "Day after Thanksgiving", "Christmas Eve", "Christmas Day",
];

export function rateSheetConfig(settings) {
  const r = settings?.rateSheet || {};
  return {
    effectiveDate: r.effectiveDate || todayISO(),
    otMultiplier: Number(r.otMultiplier) || 1.5,
    dtMultiplier: Number(r.dtMultiplier) || 2,
    dailyHours: Number(r.dailyHours) || 10,
    weeklyHours: Number(r.weeklyHours) || 50,
    localArea: (r.localArea || "Metro Detroit").trim(),
    holidays: Array.isArray(r.holidays) && r.holidays.length ? r.holidays : DEFAULT_HOLIDAYS,
    notes: r.notes ?? "Rates are in U.S. dollars per hour and are subject to change with 30 days' written notice.",
  };
}

// One row per service with a rate: the labor rate card, then on-site support.
export function rateRows(settings) {
  const cfg = proposalConfig(settings), rs = rateSheetConfig(settings);
  const rows = Object.entries(ROLE_LABELS).map(([k, label]) => ({ key: k, label, rate: Number(cfg.laborRates[k]) || 0 }));
  rows.push({ key: "support", label: "Production / Stand-By Support", rate: Number(cfg.supportRate) || 0 });
  return rows.filter(r => r.rate > 0).map(r => ({ ...r, ot: round2(r.rate * rs.otMultiplier), dt: round2(r.rate * rs.dtMultiplier) }));
}

const x = n => (Number.isInteger(n) ? n.toFixed(1) : String(n)) + "×";
export const multLabel = x;
