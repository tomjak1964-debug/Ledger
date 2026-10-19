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
  ["torque", "Torque Tools"], ["ioLink", "IO-Link Devices"], ["hmis", "HMIs"],
];

export const DEFAULT_POINT_WEIGHTS = { pp: 1, welds: 2, clamps: 2, clips: 3, tabs: 2, shuttle: 2, platen: 6 };

export const DEFAULT_PHASES = [
  { key: "award", label: "Contract Award", pct: 15 },
  { key: "engineering", label: "Engineering Complete", pct: 25 },
  { key: "panel", label: "Panel Build Complete", pct: 25 },
  { key: "wiring", label: "Field Wiring Complete", pct: 25 },
  { key: "docs", label: "Final Documentation", pct: 10 },
];

// Rates have one home: Settings → Time Categories (bill rate per category).
// Each engineering task a system proposal prices, and the support rate, is
// priced at a category's rate — roleCategory names which, by category id,
// and until one is picked a category of the usual name stands in.
export const ROLE_DEFAULT_CATEGORY = {
  hardwareDesign: "Engineering", plc: "Engineering", hmi: "Engineering", startup: "Engineering",
  drafting: "Drafting", pm: "Project Management", docs: "Documentation", support: "Production / Stand-By Support",
};
export function roleCategory(settings, timeCategories, role) {
  const cats = (timeCategories || []).filter(c => c.active !== false);
  const id = settings?.proposal?.roleCategory?.[role];
  return (id && cats.find(c => c.id === id))
    || cats.find(c => (c.name || "").trim().toLowerCase() === (ROLE_DEFAULT_CATEGORY[role] || "").toLowerCase())
    || null;
}

export function proposalConfig(settings, timeCategories) {
  const p = settings.proposal || {};
  // A task priced from its category; a stored rate only where none matches
  // (an org with no categories set up yet).
  const fromCats = role => { const c = roleCategory(settings, timeCategories, role); return c ? Number(c.rate) || 0 : null; };
  const stored = { ...DEFAULT_LABOR_RATES, ...(p.laborRates || {}) };
  const laborRates = Object.fromEntries(Object.keys(stored).map(k => [k, fromCats(k) ?? stored[k]]));
  return {
    // followed by the customer code and the date: PROP-VG261018
    propPrefix: p.propPrefix ?? "PROP-",
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
    laborRates,
    hourModel: mergeHourModel(DEFAULT_HOUR_MODEL, p.hourModel || {}),
    controlsPhases: {
      engineering: p.controlsPhases?.engineering || CONTROLS_PHASES.engineering,
      hardware: p.controlsPhases?.hardware || CONTROLS_PHASES.hardware,
    },
    assumptions: p.assumptions || DEFAULT_ASSUMPTIONS,
    exclusions: p.exclusions || DEFAULT_EXCLUSIONS,
    schedule: p.schedule || DEFAULT_SCHEDULE,
    validityDays: p.validityDays ?? 30,
    supportRate: fromCats("support") ?? p.supportRate ?? 70,
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

// The lines a fixture proposal can carry, in document order. `key` is what an
// override is stored under (specs.priceOverrides), so a label can be reworded
// without losing anyone's numbers.
export const FIXTURE_PRICE_LINES = [
  { key: "eng", label: "Engineering/Start/Up", section: "base", group: "engineering" },
  { key: "panel", label: "CompactLogix Control Panel /HMI/Bingo Board", section: "base", group: "hardware" },
  { key: "blockIo", label: "Block I/O", section: "base", group: "hardware" },
  { key: "fieldWiring", label: "Field Wiring", section: "base", group: "services" },
  { key: "remoteHmi", label: "Remote HMI", section: "base", group: "hardware" },
  { key: "remoteSonic", label: "Remote Sonic Panel", section: "base", group: "hardware" },
  { key: "dnCheckout", label: "Data National Checkout", section: "premium", group: "services" },
  { key: "dnMaterial", label: "Data National Material", section: "premium", group: "hardware" },
  { key: "runoff", label: "Run Off Support", section: "premium", group: "services" },
];

// Full price build-up matching the proposal document's Base/Premium sections.
// Each line is worked out from the Fixture Rates row and the content counts;
// an amount typed on the proposal (specs.priceOverrides[key]) replaces it —
// blank means "use the worked-out figure", 0 takes the line off. `lines`
// carries every possible line with both figures, for the editor.
export function priceProposal(mt, specs, cfg) {
  if (!mt) return { baseLines: [], premiumLines: [], lines: [], base: 0, premium: 0, total: 0, blocks: 0, points: 0 };
  const { points, blocks: computed } = ioBlocks(specs, cfg);
  const blocks = specs.ioBlocks === "" || specs.ioBlocks == null ? computed : n(specs.ioBlocks);
  // A proposal with scope ticks (specs.scope) prices only what it provides; one
  // saved before scope existed prices everything, as it always did.
  const sc = specs.scope || null;
  const has = k => !sc || sc[k] !== false;
  const dn = !!specs.dataNational;
  const cams = n(specs.cameras), torque = n(specs.torque), ioLink = n(specs.ioLink);
  // The Engineering section of Fixture Rates is one line on the proposal: the
  // base, hardware design, and the per-unit adders — HMIs, cameras, torque
  // tools, IO-Link devices — times the counts on the proposal.
  const hmis = n(specs.hmis);
  const engParts = [
    { label: "Engineering / start-up base", amount: n(mt.engBase) },
    { label: "Hardware design", amount: has("hwDesign") ? n(mt.hardwareDesign) : 0 },
    { label: `${hmis} HMI${hmis === 1 ? "" : "s"} × ${n(mt.hmiRate)}`, amount: has("hmi") ? n(mt.hmiRate) * hmis : 0 },
    { label: `${cams} camera${cams === 1 ? "" : "s"} × ${n(mt.cameraRate)}`, amount: n(mt.cameraRate) * cams },
    { label: `${torque} torque tool${torque === 1 ? "" : "s"} × ${n(mt.torqueRate)}`, amount: n(mt.torqueRate) * torque },
    { label: `${ioLink} IO-Link device${ioLink === 1 ? "" : "s"} × ${n(mt.ioLinkRate)}`, amount: n(mt.ioLinkRate) * ioLink },
  ].filter(p => p.amount > 0);
  const eng = engParts.reduce((t, p) => t + p.amount, 0);
  const blockio = blocks > 0 ? n(mt.ioFirst) + n(mt.ioAddl) * (blocks - 1) : 0;
  const worked = {
    eng, panel: has("panel") ? n(mt.panelBudget) : 0, blockIo: has("blockIo") ? blockio : 0, fieldWiring: has("fieldWiring") ? n(mt.fieldWiring) : 0,
    remoteHmi: has("panel") ? n(mt.remoteHmi) : 0, remoteSonic: has("panel") ? n(mt.remoteSonic) : 0,
    dnCheckout: dn ? n(mt.dnCheckout) : 0, dnMaterial: dn ? n(mt.dnMaterial) : 0, runoff: has("runoff") ? n(mt.runoff) : 0,
  };
  // The panel line names the PLC it is built around ("CompactLogix Control Panel …").
  const plcShort = String(specs.plcType || cfg.plcType || "").trim().split(/\s+/).pop() || "Control";
  const over = specs.priceOverrides || {};
  const lines = FIXTURE_PRICE_LINES.map(l => {
    const o = over[l.key];
    const overridden = o !== "" && o != null;
    // A proposal that names its MES prices "MIRA MES Support"; one from before
    // keeps "Data National Checkout". Premium is the lines the proposal picks
    // (specs.premium), else where each line has always sat.
    const mes = String(specs.mesName || "").trim();
    const label = l.key === "panel" ? `${plcShort} Control Panel /HMI/Bingo Board`
      : mes && l.key === "dnCheckout" ? `${mes} MES Support` : mes && l.key === "dnMaterial" ? `${mes} MES Material` : l.label;
    const section = Array.isArray(specs.premium) ? (specs.premium.includes(l.key) ? "premium" : "base") : l.section;
    return { ...l, label, section, suggested: round2(worked[l.key]), amount: round2(overridden ? n(o) : worked[l.key]), overridden };
  });
  const strip = l => ({ key: l.key, label: l.label, amount: l.amount, ...(l.overridden ? { overridden: true, suggested: l.suggested } : {}) });
  const baseLines = priced(lines.filter(l => l.section === "base")).map(strip);
  const premiumLines = priced(lines.filter(l => l.section === "premium")).map(strip);
  const base = round2(baseLines.reduce((t, l) => t + l.amount, 0));
  const premium = round2(premiumLines.reduce((t, l) => t + l.amount, 0));
  return { baseLines, premiumLines, lines, base, premium, total: round2(base + premium), blocks, points, engParts };
}

export const phaseAmount = (total, pct) => round2(total * pct / 100);

export const proposalTotal = p => n(p.pricing?.total);

// The customer a new proposal starts on: whoever the last proposal of the
// same kind was for, so a system proposal for someone else doesn't move the
// fixture default; before there are any of that kind, Venture Global.
export function defaultProposalCustomer(db, kind = "machine") {
  const customers = db.contacts.filter(c => c.type === "customer" && c.active !== false);
  const sameKind = p => (p.kind || "machine") === kind;
  const last = [...(db.proposals || [])].reverse().find(p => sameKind(p) && customers.some(c => c.id === p.customerId));
  return (last && customers.find(c => c.id === last.customerId))
    || customers.find(c => /^venture\s*global\s*engineering$/i.test((c.name || "").trim()))
    || customers.find(c => /venture\s*global/i.test(c.name || ""))
    || customers[0] || null;
}

// A job number for a proposal that came without one: the proposal's date as
// YYMMDD and a two-digit sequence for that day — 261008-01, 261008-02 —
// following any already used (taken: job numbers this run has handed out).
export function dateJobNumber(proposals, date, taken = []) {
  const stem = String(date || "").replace(/-/g, "").slice(2, 8);
  const re = new RegExp("^" + stem + "-(\\d+)$");
  const used = [...(proposals || []).map(p => p.jobNumber), ...taken]
    .map(j => re.exec(String(j || "").trim())).filter(Boolean).map(m => Number(m[1]));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return stem + "-" + String(next).padStart(2, "0");
}

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
