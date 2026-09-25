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
  // Devices the way a fixture lineup counts them. These are the hours a device
  // costs beyond its I/O points — the points themselves still price through
  // perDiscrete / perAnalog, so a clamp is its 4 points plus this.
  perCylinder:    { hardwareDesign: 0.25, drafting: 0.3, plc: 0.5, hmi: 0.2 },
  perVacuum:      { hardwareDesign: 0.15, drafting: 0.2, plc: 0.3, hmi: 0.1 },
  perSensor:      { hardwareDesign: 0.1, drafting: 0.15, plc: 0.15, hmi: 0.05 },
  perOpStation:   { hardwareDesign: 1, drafting: 1, plc: 1, hmi: 0.5 },
  perExtraHmi:    { hardwareDesign: 1, drafting: 1.5, plc: 1, hmi: 6 },
  perRobot:       { hardwareDesign: 8, drafting: 6, plc: 20, hmi: 4, safetyVal: 4 },
  perTorque:      { hardwareDesign: 2, drafting: 1.5, plc: 8, hmi: 4 },
  perPset:        { plc: 0.5, hmi: 0.25 },
  perVision:      { hardwareDesign: 1.5, drafting: 1, plc: 5, hmi: 2 },
  perDispenser:   { hardwareDesign: 3, drafting: 2, plc: 12, hmi: 4 },
  perScanner:     { hardwareDesign: 0.5, drafting: 0.5, plc: 3, hmi: 1 },
  perIoBlock:     { hardwareDesign: 1, drafting: 2, plc: 0.5 },
  perIpDevice:    { hardwareDesign: 0.25, plc: 0.75 },
  perEstop:       { hardwareDesign: 0.5, drafting: 0.5, plc: 0.15 },
  perLightCurtain:{ hardwareDesign: 1.5, drafting: 1, plc: 0.5, hmi: 0.25, safetyVal: 1 },
  perSafetyDevice:{ hardwareDesign: 1, drafting: 0.75, plc: 0.5, safetyVal: 1 },
  safetyRelay:    { hardwareDesign: 4, drafting: 2, plc: 2 },
  safetyPlc:      { hardwareDesign: 12, drafting: 4, plc: 10 },
  dataCollection: { plc: 12, hmi: 4 },
  remoteAccess:   { plc: 2 },
  pmPct: 5,          // project management as % of engineering hours
  hoursPerDay: 10,   // a start-up day
};
export const HOUR_MODEL_LABELS = {
  base: "Base", perDiscrete: "Per discrete I/O", perAnalog: "Per analog I/O", perDrive: "Per VFD",
  perServo: "Per servo / electric actuator", perStation: "Per station", perStep: "Per sequence step", perPanel: "Per panel",
  perNetwork: "Per network", perScreen: "Per HMI screen", perAlarm: "Per alarm", perRecipe: "Per recipe / part type",
  perCylinder: "Per pneumatic cylinder", perVacuum: "Per vacuum zone", perSensor: "Per sensor", perOpStation: "Per operator station",
  perExtraHmi: "Per additional HMI", perRobot: "Per robot", perTorque: "Per torque controller", perPset: "Per torque P-set",
  perVision: "Per vision system", perDispenser: "Per dispensing system", perScanner: "Per barcode scanner",
  perIoBlock: "Per remote I/O block", perIpDevice: "Per networked device", perEstop: "Per E-stop", perLightCurtain: "Per light curtain",
  perSafetyDevice: "Per other safety device", safetyRelay: "Safety relay system", safetyPlc: "Safety PLC / controller",
  dataCollection: "Data collection", remoteAccess: "Remote access",
};

// The job's content — what the hour model reads. DEVICE_FIELDS are the
// counts a fixture lineup gives directly (clamps, vacuum zones, sensors, a
// robot, a torque controller…); each carries the discrete I/O it implies, so
// the I/O count can be derived from the device list when the lineup gives no
// total. STRUCTURE_FIELDS describe the program and the documents.
export const IO_FIELDS = [["ioDiscrete", "Discrete I/O"], ["ioAnalog", "Analog I/O"]];
export const DEVICE_FIELDS = [
  { key: "cylinders", label: "Pneumatic cylinders", hint: "clamps, lifts, presses — 2 switches + 2 solenoids each", hm: "perCylinder", inputs: 2, outputs: 2 },
  { key: "vacuumZones", label: "Vacuum zones", hint: "one ejector + one pressure switch each", hm: "perVacuum", inputs: 1, outputs: 1 },
  { key: "sensors", label: "Sensors", hint: "part present, photoelectric, prox, position", hm: "perSensor", inputs: 1, outputs: 0 },
  { key: "opStations", label: "Operator stations", hint: "cycle start / opto-touch locations", hm: "perOpStation", inputs: 1, outputs: 4 },
  { key: "hmis", label: "HMI panels", hint: "the first is in the base; extras add screens", hm: "perExtraHmi", inputs: 0, outputs: 0, extra: true },
  { key: "drives", label: "VFDs", hint: "conveyors, motor drivers", hm: "perDrive", inputs: 0, outputs: 0 },
  { key: "servoAxes", label: "Servo / electric actuators", hint: "servo clamps, electric slides", hm: "perServo", inputs: 0, outputs: 0 },
  { key: "robots", label: "Robots", hint: "interface, handshaking and safety", hm: "perRobot", inputs: 0, outputs: 0 },
  { key: "torqueTools", label: "Torque controllers", hint: "DC tool systems", hm: "perTorque", inputs: 0, outputs: 0 },
  { key: "psets", label: "Torque P-sets", hint: "fastening sequences", hm: "perPset", inputs: 0, outputs: 0 },
  { key: "visionSystems", label: "Vision systems", hint: "smart cameras, vision sensors", hm: "perVision", inputs: 0, outputs: 0 },
  { key: "dispensers", label: "Dispensing systems", hint: "glue, sealant, adhesive", hm: "perDispenser", inputs: 0, outputs: 0 },
  { key: "scanners", label: "Barcode scanners", hint: "integrated by us", hm: "perScanner", inputs: 0, outputs: 0 },
  { key: "ioBlocks", label: "Remote I/O blocks", hint: "I/O-Link masters and hubs, block I/O", hm: "perIoBlock", inputs: 0, outputs: 0 },
  { key: "ipDevices", label: "Networked devices", hint: "everything on the IP list", hm: "perIpDevice", inputs: 0, outputs: 0 },
  { key: "estops", label: "E-stop buttons", hint: "", hm: "perEstop", inputs: 0, outputs: 0 },
  { key: "lightCurtains", label: "Light curtains", hint: "", hm: "perLightCurtain", inputs: 0, outputs: 0 },
  { key: "safetyDevices", label: "Other safety devices", hint: "mats, gate switches, interlocks", hm: "perSafetyDevice", inputs: 0, outputs: 0 },
];
export const STRUCTURE_FIELDS = [
  ["stations", "Stations"], ["steps", "Sequence steps"], ["panels", "Control panels"], ["networks", "Networks"],
  ["screens", "HMI screens"], ["alarms", "Alarms"], ["recipes", "Recipes / part types"],
];
// Kept for anything still reading the old flat list.
export const DRIVER_FIELDS = [...IO_FIELDS, ...DEVICE_FIELDS.map(d => [d.key, d.label]), ...STRUCTURE_FIELDS];
export const SAFETY_OPTIONS = [["none", "None"], ["relay", "Safety relays"], ["plc", "Safety PLC / safety controller"]];

// A few base points every panel carries (control power on, a key switch, the
// power-on light, an overhead light relay) plus what the devices imply.
export const BASE_IO = { inputs: 2, outputs: 2 };
export function derivedIo(drivers) {
  const d = drivers || {};
  let inputs = BASE_IO.inputs, outputs = BASE_IO.outputs;
  for (const f of DEVICE_FIELDS) { inputs += n(d[f.key]) * f.inputs; outputs += n(d[f.key]) * f.outputs; }
  return { inputs, outputs, total: inputs + outputs };
}
// Discrete I/O the model prices: what was typed, or the derived count when blank.
export const effectiveDiscrete = drivers => {
  const v = drivers?.ioDiscrete;
  return v === "" || v == null ? derivedIo(drivers).total : n(v);
};

// "197 discrete I/O · 23 pneumatic cylinders · 24 vacuum zones · 1 robot" —
// what the estimate was priced on, in the customer's own units.
export function contentSummary(drivers) {
  const d = drivers || {};
  const parts = [];
  const io = effectiveDiscrete(d); if (io) parts.push(`${io} discrete I/O`);
  if (n(d.ioAnalog)) parts.push(`${n(d.ioAnalog)} analog / IO-Link points`);
  const single = { hmis: ["HMI", "HMIs"], drives: ["VFD", "VFDs"], servoAxes: ["servo axis", "servo axes"], robots: ["robot", "robots"],
    torqueTools: ["torque controller", "torque controllers"], psets: ["P-set", "P-sets"], visionSystems: ["vision system", "vision systems"],
    dispensers: ["dispensing system", "dispensing systems"], scanners: ["barcode scanner", "barcode scanners"], ioBlocks: ["remote I/O block", "remote I/O blocks"],
    ipDevices: ["networked device", "networked devices"], estops: ["E-stop", "E-stops"], lightCurtains: ["light curtain", "light curtains"],
    safetyDevices: ["other safety device", "other safety devices"], cylinders: ["pneumatic cylinder", "pneumatic cylinders"],
    vacuumZones: ["vacuum zone", "vacuum zones"], sensors: ["sensor", "sensors"], opStations: ["operator station", "operator stations"] };
  for (const f of DEVICE_FIELDS) {
    const c = n(d[f.key]); if (!c) continue;
    if (f.key === "hmis" && c === 1) { parts.push("1 HMI"); continue; }
    parts.push(`${c} ${single[f.key][c === 1 ? 0 : 1]}`);
  }
  if (n(d.stations) > 1) parts.push(`${n(d.stations)} stations`);
  if (n(d.recipes) > 1) parts.push(`${n(d.recipes)} part types`);
  if (d.safety === "plc") parts.push("safety PLC / controller"); else if (d.safety === "relay") parts.push("safety relay");
  return parts.join(" · ");
}

// Fields a lineup's header gives; they print on the document as the basis of
// the estimate.
export const LINEUP_FIELDS = [
  ["customerJob", "Customer job #"], ["endUser", "End user / plant"], ["fixture", "Fixture / machine"], ["qty", "Quantity"],
  ["plc", "PLC"], ["hmi", "HMI"], ["cycleTime", "Cycle time / rate"], ["runoff", "Runoff / due date"], ["references", "Reference jobs"],
];

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

export const blankDrivers = () => ({ ioDiscrete: "", ioAnalog: 0,
  ...Object.fromEntries(DEVICE_FIELDS.map(d => [d.key, 0])), ...Object.fromEntries(STRUCTURE_FIELDS.map(([k]) => [k, 0])) });

// A blank estimate, with the content zeroed and the standard components ticked.
// Discrete I/O starts blank, which means "derive it from the devices".
export function newEstimate(cfg) {
  return {
    drivers: { ...blankDrivers(), stations: 1, panels: 1, networks: 1, hmis: 1, safety: "relay", dataCollection: false, remoteAccess: false,
      reusePct: 0, trips: 1, daysPerTrip: 3, people: 1, travelIncluded: true },
    lineup: Object.fromEntries(LINEUP_FIELDS.map(([k]) => [k, ""])),
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
const REUSABLE = new Set(["hardwareDesign", "drafting", "plc", "hmi"]);

// Hours the model suggests for one component from the job's content.
export function suggestHours(key, drivers, hm, allHours) {
  const d = drivers || {};
  if (key === "startup") return n(d.trips) * n(d.daysPerTrip) * n(d.people) * n(hm.hoursPerDay);
  if (key === "pm") {
    const eng = ["hardwareDesign", "drafting", "plc", "hmi"].reduce((t, k) => t + n(allHours?.[k]), 0);
    return round2(eng * n(hm.pmPct) / 100);
  }
  let h = pick(hm.base, key)
    + effectiveDiscrete(d) * pick(hm.perDiscrete, key)
    + n(d.ioAnalog) * pick(hm.perAnalog, key)
    + n(d.stations) * pick(hm.perStation, key)
    + n(d.steps) * pick(hm.perStep, key)
    + n(d.panels) * pick(hm.perPanel, key)
    + n(d.networks) * pick(hm.perNetwork, key)
    + n(d.screens) * pick(hm.perScreen, key)
    + n(d.alarms) * pick(hm.perAlarm, key)
    + n(d.recipes) * pick(hm.perRecipe, key);
  for (const f of DEVICE_FIELDS) {
    const count = f.extra ? Math.max(0, n(d[f.key]) - 1) : n(d[f.key]);
    h += count * pick(hm[f.hm], key);
  }
  // An estimate saved before the device fields existed carries vision as a tick.
  if (d.visionSystems == null && d.vision) h += pick(hm.perVision, key);
  if (d.safety === "relay") h += pick(hm.safetyRelay, key);
  if (d.safety === "plc") h += pick(hm.safetyPlc, key);
  if (d.dataCollection) h += pick(hm.dataCollection, key);
  if (d.remoteAccess) h += pick(hm.remoteAccess, key);
  // A reference job the customer names — base hardware, a cycle-start
  // standard, an HMI to copy — takes a share off the engineering.
  if (REUSABLE.has(key) && n(d.reusePct) > 0) h *= 1 - Math.min(n(d.reusePct), 90) / 100;
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
  // A start-up at a customer down the road has no travel & living; the toggle
  // is on unless the estimator turns it off (older estimates never set it).
  const travel = d.travelIncluded === false ? 0 : round2(n(d.trips) * n(d.daysPerTrip) * n(d.people) * n(cfg.travelPerDay));
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
