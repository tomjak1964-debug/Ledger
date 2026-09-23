// The controls estimate — a job for any customer, priced as the standard
// engineering components (hours x rate) plus optional hardware and the field
// work. Pure functions; every rate and every hour default lives in
// settings.proposal and is edited under Settings → Proposals.
//
// The hour model suggests hours from the job's content (I/O, drives, stations,
// screens…). They are suggestions: the estimator overrides any of them, and
// the override is what prices. When the shop's own programs are in hand the
// defaults here should be re-tuned to how it actually builds.
import { round2 } from "./ledger.js";

const n = v => Number(v) || 0;

// One row per standard engineering component. `role` names the labor rate it
// bills at; `field` puts it in Field Services rather than Engineering on the
// document; `optional` components start unticked.
export const COMPONENTS = [
  { key: "hardwareDesign", label: "Hardware Design", role: "hardwareDesign",
    deliverables: ["Electrical design and I/O list", "Power distribution and control panel layout design",
      "Safety circuit design", "Component selection and bill of material"] },
  { key: "drafting", label: "Drafting", role: "drafting",
    deliverables: ["Electrical schematics in AutoCAD Electrical", "Panel layout drawings",
      "Interconnect drawings from the main control enclosure to field devices", "As-built drawing package at completion"] },
  { key: "plc", label: "PLC Program Development", role: "plc",
    deliverables: ["Control application development", "Machine sequence, fault handling and recovery",
      "Safety logic integration", "Bench simulation and test before start-up"] },
  { key: "hmi", label: "HMI Development", role: "hmi",
    deliverables: ["Operator screens", "Alarm handling and history", "Recipe / part-type management", "Maintenance and diagnostic screens"] },
  { key: "startup", label: "Start-Up / Debug", role: "startup", field: true,
    deliverables: ["On-site I/O checkout", "Commissioning and debug to production rate", "Operator and maintenance walk-through at start-up"] },
  { key: "pm", label: "Project Management", role: "pm", optional: true,
    deliverables: ["Schedule, submittals and customer coordination"] },
  { key: "docs", label: "Documentation & Training", role: "docs", optional: true,
    deliverables: ["Operation and maintenance manual", "Formal operator and maintenance training session"] },
  { key: "fat", label: "Factory Acceptance Test", role: "startup", optional: true,
    deliverables: ["Panel power-up and I/O test at the shop before shipment"] },
  { key: "safetyVal", label: "Safety Validation", role: "hardwareDesign", optional: true,
    deliverables: ["Safety function validation and documentation to the applicable standard"] },
];

export const DEFAULT_LABOR_RATES = {
  hardwareDesign: 110, drafting: 85, plc: 120, hmi: 110, startup: 120, pm: 110, docs: 85,
};
export const ROLE_LABELS = {
  hardwareDesign: "Hardware Design", drafting: "Drafting", plc: "PLC Programming", hmi: "HMI Development",
  startup: "Start-Up / Debug", pm: "Project Management", docs: "Documentation",
};

// Hours added per unit of content, by component. Trade-standard starting
// points for a controls integrator; tune them under Settings → Proposals.
export const DEFAULT_HOUR_MODEL = {
  base:           { hardwareDesign: 8, drafting: 6, plc: 16, hmi: 8, docs: 4, fat: 8, safetyVal: 8 },
  perDiscrete:    { hardwareDesign: 0.25, drafting: 0.2, plc: 0.35 },
  perAnalog:      { hardwareDesign: 0.5, drafting: 0.3, plc: 0.75 },
  perDrive:       { hardwareDesign: 2, drafting: 1.5, plc: 3 },
  perServo:       { hardwareDesign: 3, drafting: 2, plc: 8 },
  perStation:     { plc: 6 },
  perStep:        { plc: 1.5 },
  perPanel:       { hardwareDesign: 2, drafting: 4, docs: 1 },
  perNetwork:     { hardwareDesign: 2, plc: 1 },
  perScreen:      { hmi: 3, docs: 0.5 },
  perAlarm:       { hmi: 0.1 },
  perRecipe:      { plc: 3, hmi: 2 },
  safetyRelay:    { hardwareDesign: 4, drafting: 2, plc: 2 },
  safetyPlc:      { hardwareDesign: 12, drafting: 4, plc: 10 },
  vision:         { plc: 8 },
  dataCollection: { plc: 12, hmi: 4 },
  remoteAccess:   { plc: 2 },
  pmPct: 5,          // project management as % of engineering hours
  hoursPerDay: 10,   // a start-up day
};
export const HOUR_MODEL_LABELS = {
  base: "Base", perDiscrete: "Per discrete I/O", perAnalog: "Per analog I/O", perDrive: "Per VFD",
  perServo: "Per servo axis", perStation: "Per station", perStep: "Per sequence step", perPanel: "Per panel",
  perNetwork: "Per network", perScreen: "Per HMI screen", perAlarm: "Per alarm", perRecipe: "Per recipe / part type",
  safetyRelay: "Safety relay system", safetyPlc: "Safety PLC system", vision: "Vision", dataCollection: "Data collection",
  remoteAccess: "Remote access",
};

// The job's content — what the hour model reads.
export const DRIVER_FIELDS = [
  ["ioDiscrete", "Discrete I/O"], ["ioAnalog", "Analog I/O"], ["drives", "VFDs"], ["servoAxes", "Servo axes"],
  ["stations", "Stations"], ["steps", "Sequence steps"], ["panels", "Control panels"], ["networks", "Networks"],
  ["screens", "HMI screens"], ["alarms", "Alarms"], ["recipes", "Recipes / part types"],
];
export const SAFETY_OPTIONS = [["none", "None"], ["relay", "Safety relays"], ["plc", "Safety PLC"]];

// Standard control elements the estimator adds to hardware with one click.
// Descriptions and typical quantities only — the price is the shop's to fill
// in, never invented here.
export const STANDARD_ELEMENTS = [
  { desc: "Control panel — enclosure, back panel, disconnect, duct, wire, terminals", qty: 1 },
  { desc: "PLC — Allen-Bradley CompactLogix 5380 controller", qty: 1 },
  { desc: "Discrete I/O module", qty: 4 },
  { desc: "Analog I/O module", qty: 1 },
  { desc: "Block I/O — ArmorBlock, on-machine", qty: 2 },
  { desc: "IO-Link master", qty: 1 },
  { desc: "HMI — Allen-Bradley PanelView Plus 7, 10\"", qty: 1 },
  { desc: "Safety relay", qty: 1 },
  { desc: "Safety PLC — Compact GuardLogix", qty: 1 },
  { desc: "Light curtain pair", qty: 1 },
  { desc: "E-stop / cycle start operator station", qty: 2 },
  { desc: "VFD — Allen-Bradley PowerFlex 525", qty: 1 },
  { desc: "Servo drive and motor — Kinetix 5300", qty: 1 },
  { desc: "Managed Ethernet switch — Stratix 5700", qty: 1 },
  { desc: "Pneumatic valve manifold, EtherNet/IP", qty: 1 },
  { desc: "24 VDC power supply", qty: 1 },
  { desc: "Stack light / andon", qty: 1 },
  { desc: "Router for remote access", qty: 1 },
  { desc: "Barcode scanner", qty: 1 },
  { desc: "Vision camera — Cognex In-Sight", qty: 1 },
];

export const DEFAULT_ASSUMPTIONS = [
  "Customer supplies the machine, all on-machine components and cabling unless listed under Hardware.",
  "Customer supplies mechanical drawings, sequence of operation and part samples before design begins.",
  "Start-up is during normal working hours; the number of trips assumed is listed under Field Services.",
  "Remote access to the control system is available for support after start-up.",
  "Utilities (power, air, network drop) are at the machine before start-up.",
];
export const DEFAULT_EXCLUSIONS = [
  "Field devices (sensors, cables, cylinders, valves) unless listed under Hardware.",
  "Step-down transformers and power distribution to the machine.",
  "Mechanical design, machining and fabrication.",
  "PLC / HMI software licensing beyond what is listed.",
  "Network drops, IT integration and cybersecurity hardening.",
  "Spare parts.",
  "Stand-by and production support beyond start-up.",
];
export const DEFAULT_SCHEDULE = [
  { key: "design", label: "Design complete", weeks: 3 },
  { key: "panel", label: "Panel build complete", weeks: 6 },
  { key: "program", label: "Program complete, ready for start-up", weeks: 8 },
  { key: "startup", label: "Start-up complete", weeks: 10 },
];

// Invoicing schedules for a controls estimate — one for engineering-only,
// one when hardware is included (the machine proposal's split).
export const CONTROLS_PHASES = {
  engineering: [
    { key: "award", label: "Contract Award", pct: 30 },
    { key: "design", label: "Design Complete", pct: 40 },
    { key: "startup", label: "Start-Up Complete", pct: 30 },
  ],
  hardware: [
    { key: "award", label: "Contract Award", pct: 15 },
    { key: "engineering", label: "Engineering Complete", pct: 25 },
    { key: "panel", label: "Panel Build Complete", pct: 25 },
    { key: "wiring", label: "Field Wiring Complete", pct: 25 },
    { key: "docs", label: "Final Documentation", pct: 10 },
  ],
};

// A blank estimate, with the content zeroed and the standard components ticked.
export function newEstimate(cfg) {
  return {
    drivers: { ioDiscrete: 0, ioAnalog: 0, drives: 0, servoAxes: 0, stations: 1, steps: 0, panels: 1, networks: 1,
      screens: 0, alarms: 0, recipes: 0, safety: "relay", vision: false, dataCollection: false, remoteAccess: false,
      trips: 1, daysPerTrip: 3, people: 1 },
    components: Object.fromEntries(COMPONENTS.map(c => [c.key, { include: !c.optional, hours: "", rate: "" }])),
    hardwareIncluded: false,
    hardware: [],
    options: [],
    assumptions: cfg.assumptions.slice(),
    exclusions: cfg.exclusions.slice(),
    schedule: cfg.schedule.map(x => ({ ...x })),
    contingencyPct: cfg.contingencyPct,
    showHours: false,
  };
}

const pick = (table, key) => n(table?.[key]);

// Hours the model suggests for one component from the job's content.
export function suggestHours(key, drivers, hm, allHours) {
  const d = drivers || {};
  if (key === "startup") return n(d.trips) * n(d.daysPerTrip) * n(d.people) * n(hm.hoursPerDay);
  if (key === "pm") {
    const eng = ["hardwareDesign", "drafting", "plc", "hmi"].reduce((t, k) => t + n(allHours?.[k]), 0);
    return round2(eng * n(hm.pmPct) / 100);
  }
  let h = pick(hm.base, key)
    + n(d.ioDiscrete) * pick(hm.perDiscrete, key)
    + n(d.ioAnalog) * pick(hm.perAnalog, key)
    + n(d.drives) * pick(hm.perDrive, key)
    + n(d.servoAxes) * pick(hm.perServo, key)
    + n(d.stations) * pick(hm.perStation, key)
    + n(d.steps) * pick(hm.perStep, key)
    + n(d.panels) * pick(hm.perPanel, key)
    + n(d.networks) * pick(hm.perNetwork, key)
    + n(d.screens) * pick(hm.perScreen, key)
    + n(d.alarms) * pick(hm.perAlarm, key)
    + n(d.recipes) * pick(hm.perRecipe, key);
  if (d.safety === "relay") h += pick(hm.safetyRelay, key);
  if (d.safety === "plc") h += pick(hm.safetyPlc, key);
  if (d.vision) h += pick(hm.vision, key);
  if (d.dataCollection) h += pick(hm.dataCollection, key);
  if (d.remoteAccess) h += pick(hm.remoteAccess, key);
  return round2(h);
}

// Every component's suggested hours, in order — PM reads the others.
export function suggestAll(drivers, hm) {
  const out = {};
  for (const c of COMPONENTS) if (c.key !== "pm") out[c.key] = suggestHours(c.key, drivers, hm, out);
  out.pm = suggestHours("pm", drivers, hm, out);
  return out;
}

// The full price build-up: engineering, hardware, field services, options.
export function priceEstimate(specs, cfg) {
  const s = specs || {};
  const hm = cfg.hourModel, rates = cfg.laborRates;
  const suggested = suggestAll(s.drivers, hm);
  const comps = COMPONENTS.map(c => {
    const x = s.components?.[c.key] || {};
    const hours = x.hours === "" || x.hours == null ? suggested[c.key] : n(x.hours);
    const rate = x.rate === "" || x.rate == null ? n(rates[c.role]) : n(x.rate);
    return { key: c.key, label: c.label, include: !!x.include, field: !!c.field, suggested: suggested[c.key],
      hours, rate, amount: round2(hours * rate), overridden: !(x.hours === "" || x.hours == null) };
  });
  const engineering = comps.filter(c => c.include && !c.field);
  const fieldComps = comps.filter(c => c.include && c.field);
  const d = s.drivers || {};
  const travel = round2(n(d.trips) * n(d.daysPerTrip) * n(d.people) * n(cfg.travelPerDay));
  const field = [
    ...fieldComps.map(c => ({ key: c.key, label: c.label, hours: c.hours, rate: c.rate, amount: c.amount })),
    ...(fieldComps.length && travel > 0 ? [{ key: "travel", label: "Travel & Living", amount: travel,
      detail: `${n(d.trips)} trip${n(d.trips) === 1 ? "" : "s"} × ${n(d.daysPerTrip)} day${n(d.daysPerTrip) === 1 ? "" : "s"}${n(d.people) > 1 ? " × " + n(d.people) + " people" : ""}` }] : []),
  ];
  const hardware = s.hardwareIncluded ? (s.hardware || []).map(h => {
    const markup = h.markupPct === "" || h.markupPct == null ? n(cfg.hardwareMarkupPct) : n(h.markupPct);
    return { ...h, markup, amount: round2(n(h.qty) * n(h.unitCost) * (1 + markup / 100)) };
  }) : [];
  const engineeringTotal = round2(engineering.reduce((t, c) => t + c.amount, 0));
  const hardwareTotal = round2(hardware.reduce((t, h) => t + h.amount, 0));
  const fieldTotal = round2(field.reduce((t, f) => t + f.amount, 0));
  const subtotal = round2(engineeringTotal + hardwareTotal + fieldTotal);
  const contingency = round2(subtotal * n(s.contingencyPct) / 100);
  const total = round2(subtotal + contingency);
  const options = (s.options || []).filter(o => String(o.desc || "").trim()).map(o => ({ ...o, amount: round2(n(o.amount)) }));
  const hoursTotal = round2(comps.filter(c => c.include).reduce((t, c) => t + c.hours, 0));
  return { components: comps, engineering, engineeringTotal, hardware, hardwareTotal, field, fieldTotal,
    subtotal, contingency, total, options, optionsTotal: round2(options.reduce((t, o) => t + o.amount, 0)), hoursTotal };
}
