// The customer-facing rate sheet: the shop's standard hourly rates (Settings →
// Time Categories, the one place rates are set) with the overtime and
// double-time rates worked out, and the terms for premium time, travel and
// living. Everything the sheet says comes from here and settings.rateSheet
// (Settings → Proposals → Rate Sheet), so it is always current.
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

// One row per active time category with a rate — the one place rates are set.
export function rateRows(settings, timeCategories) {
  const rs = rateSheetConfig(settings);
  return (timeCategories || []).filter(c => c.active !== false && Number(c.rate) > 0)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
    .map(c => ({ key: c.id, label: c.name, rate: Number(c.rate), ot: round2(Number(c.rate) * rs.otMultiplier), dt: round2(Number(c.rate) * rs.dtMultiplier) }));
}

const x = n => (Number.isInteger(n) ? n.toFixed(1) : String(n)) + "×";
export const multLabel = x;
