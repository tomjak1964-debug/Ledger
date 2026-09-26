// Machine-proposal pricing — the TMJ Costing engine as pure functions.
// Rates come from the machine_types table (editable in Machine Rates);
// formula weights and phase splits come from settings.proposal with these
// defaults (the exact rules used in the VGE quote spreadsheet).
import { round2 } from "./ledger.js";
import { DEFAULT_LABOR_RATES, DEFAULT_HOUR_MODEL, CONTROLS_PHASES, DEFAULT_ASSUMPTIONS, DEFAULT_EXCLUSIONS, DEFAULT_SCHEDULE } from "./estimates.js";

export const SPEC_FIELDS = [
  ["nests", "Nests"], ["generators", "Sonic Generators"], ["welds", "Welds"],
  ["pp", "Pick Points"], ["clamps", "Clamps"], ["clips", "Clips"],
  ["tabs", "Tabs"], ["shuttle", "Shuttles"], ["platen", "Platens"], ["cameras", "Cameras"],
  // priced like cameras: a per-unit adder on the engineering/start-up line
  ["torque", "Torque Tools"], ["ioLink", "IO-Link Devices"],
];

export const DEFAULT_POINT_WEIGHTS = { pp: 1, welds: 2, clamps: 2, clips: 3, tabs: 2, shuttle: 2, platen: 6 };

export const DEFAULT_PHASES = [
  { key: "award", label: "Contract Award", pct: 15 },
  { key: "engineering", label: "Engineering Complete", pct: 25 },
  { key: "panel", label: "Panel Build Complete", pct: 25 },
  { key: "wiring", label: "Field Wiring Complete", pct: 25 },
  { key: "docs", label: "Final Documentation", pct: 10 },
];

export function proposalConfig(settings) {
  const p = settings.proposal || {};
  return {
    propPrefix: p.propPrefix ?? "PROP-VG",
    pointWeights: { ...DEFAULT_POINT_WEIGHTS, ...(p.pointWeights || {}) },
    blockFactor: p.blockFactor ?? 1.3,
    blockDivisor: p.blockDivisor ?? 16,
    phases: p.phases || DEFAULT_PHASES,
    standards: p.standards ?? "Venture Global Engineering and Mayco/JVIS Revised Standards",
    location: p.location ?? "Venture Global Engineering, Imlay City, MI",
    signer: p.signer ?? "",
    plcType: p.plcType ?? "Allen Bradley CompactLogix",
    hmiType: p.hmiType ?? "Allen Bradley PanelView Plus",
    // the controls estimate (calc/estimates.js) — every default editable in Settings → Proposals
    laborRates: { ...DEFAULT_LABOR_RATES, ...(p.laborRates || {}) },
    hourModel: mergeHourModel(DEFAULT_HOUR_MODEL, p.hourModel || {}),
    controlsPhases: {
      engineering: p.controlsPhases?.engineering || CONTROLS_PHASES.engineering,
      hardware: p.controlsPhases?.hardware || CONTROLS_PHASES.hardware,
    },
    assumptions: p.assumptions || DEFAULT_ASSUMPTIONS,
    exclusions: p.exclusions || DEFAULT_EXCLUSIONS,
    schedule: p.schedule || DEFAULT_SCHEDULE,
    validityDays: p.validityDays ?? 30,
    supportRate: p.supportRate ?? 70,
    travelPerDay: p.travelPerDay ?? 350,
    hardwareMarkupPct: p.hardwareMarkupPct ?? 20,
    contingencyPct: p.contingencyPct ?? 0,
  };
}

// The hour model is a table of tables; a saved override fills in per cell.
function mergeHourModel(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    out[k] = typeof base[k] === "object" ? { ...base[k], ...(over[k] || {}) } : (over[k] ?? base[k]);
  }
  return out;
}

const n = v => Number(v) || 0;

// I/O blocks from machine content: weighted points -> ROUNDUP(points*factor/divisor)
export function ioBlocks(specs, cfg) {
  const w = cfg.pointWeights;
  const points = n(specs.pp) * (w.pp ?? 1) + n(specs.welds) * (w.welds ?? 2) + n(specs.clamps) * (w.clamps ?? 2)
    + n(specs.clips) * (w.clips ?? 3) + n(specs.tabs) * (w.tabs ?? 2) + n(specs.shuttle) * (w.shuttle ?? 2)
    + n(specs.platen) * (w.platen ?? 6);
  const blocks = points > 0 ? Math.ceil(points * cfg.blockFactor / cfg.blockDivisor) : 0;
  return { points, blocks };
}

// A pricing line only exists when it is worth something: a rate left at 0 on
// the Fixture Rates page (or a category the fixture has none of) is left off
// the proposal rather than printed as $0.00.
const priced = lines => lines.filter(l => n(l.amount) > 0);

// Full price build-up matching the proposal document's Base/Premium sections.
export function priceProposal(mt, specs, cfg) {
  if (!mt) return { baseLines: [], premiumLines: [], base: 0, premium: 0, total: 0, blocks: 0, points: 0 };
  const { points, blocks: computed } = ioBlocks(specs, cfg);
  const blocks = specs.ioBlocks === "" || specs.ioBlocks == null ? computed : n(specs.ioBlocks);
  const dn = !!specs.dataNational;
  const cams = n(specs.cameras), torque = n(specs.torque), ioLink = n(specs.ioLink);
  // per-unit adders — cameras, torque tools and IO-Link devices — roll into engineering
  const eng = n(mt.engBase) + n(mt.cameraRate) * cams + n(mt.torqueRate) * torque + n(mt.ioLinkRate) * ioLink;
  const blockio = blocks > 0 ? n(mt.ioFirst) + n(mt.ioAddl) * (blocks - 1) : 0;

  const baseLines = priced([
    { label: "Engineering/Start/Up", amount: eng },
    { label: "CompactLogix Control Panel /HMI/Bingo Board", amount: n(mt.panelBudget) },
    { label: "Block I/O", amount: blockio },
    { label: "Field Wiring", amount: n(mt.fieldWiring) },
    { label: "Remote HMI", amount: n(mt.remoteHmi) },
    { label: "Remote Sonic Panel", amount: n(mt.remoteSonic) },
  ]);

  const premiumLines = priced([
    { label: "Data National Checkout", amount: dn ? n(mt.dnCheckout) : 0 },
    { label: "Data National Material", amount: dn ? n(mt.dnMaterial) : 0 },
    { label: "Run Off Support", amount: n(mt.runoff) },
  ]);
  const base = round2(baseLines.reduce((t, l) => t + l.amount, 0));
  const premium = round2(premiumLines.reduce((t, l) => t + l.amount, 0));
  return { baseLines, premiumLines, base, premium, total: round2(base + premium), blocks, points };
}

export const phaseAmount = (total, pct) => round2(total * pct / 100);

export const proposalTotal = p => n(p.pricing?.total);

// TMJ Costing.xlsx defaults for the Fixture Rates seed. The sheet has no
// torque, IO-Link or remote sonic panel figures, so those start at 0 (and a
// 0 rate is simply left off the proposal).
export const TMJ_DEFAULT_RATES = [
  { name: "Big Sonic",   engBase: 3900, cameraRate: 200, panelBudget: 26000, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 2500, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  // Small Sonic is a Big Sonic on a smaller panel; Clip is a Check by another name.
  { name: "Small Sonic", engBase: 3900, cameraRate: 200, panelBudget: 23000, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 2500, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  { name: "Robot Sonic", engBase: 3900, cameraRate: 200, panelBudget: 23000, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 2500, runoff: 560, remoteHmi: 2500, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  { name: "Check",       engBase: 2900, cameraRate: 200, panelBudget: 21500, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 1700, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  { name: "Clip",        engBase: 2900, cameraRate: 200, panelBudget: 21500, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 1700, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  { name: "Screw",       engBase: 2900, cameraRate: 200, panelBudget: 21500, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 1700, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  { name: "Insert",      engBase: 2900, cameraRate: 200, panelBudget: 21500, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 1700, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
  { name: "Limiter",     engBase: 2900, cameraRate: 200, panelBudget: 21500, ioFirst: 1300, ioAddl: 650, dnCheckout: 560, dnMaterial: 900, fieldWiring: 1700, runoff: 560, remoteHmi: 0, torqueRate: 0, ioLinkRate: 0, remoteSonic: 0 },
];
