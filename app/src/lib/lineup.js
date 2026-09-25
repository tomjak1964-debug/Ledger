// Reading an Electrical Engineering Line-up into a controls estimate.
//
// A lineup is the integrator's one-page-per-fixture spec: a header (job #,
// customer, fixture, PLC, HMI, dates), the sequence of operations, the
// components on the machine with "(xN)" quantities, the valve manifold and
// sensors, and an I/O tally. This file turns that text into the counts the
// hour model reads (calc/estimates.js). It is deliberately keyword-driven —
// "(x31) Part present sensor" counts as 31 sensors whoever wrote it — so a
// lineup from another customer parses too, and the estimator reviews every
// number before an estimate is written.
import { DEVICE_FIELDS } from "../calc/estimates.js";

/* ---------------- text out of a file ---------------- */

// pdf.js loads on demand: it is the size of the rest of the app.
async function pdfLines(buf) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    lines.push(...groupItems(content.items), "");
  }
  return lines;
}

// pdf.js hands back positioned runs of text; rows are runs that share a
// baseline, read left to right. Exported for the node-side test.
export function groupItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.transform) continue;
    const y = it.transform[5], x = it.transform[4];
    let row = rows.find(r => Math.abs(r.y - y) <= 4); // a superscript "st" sits a few points up
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str: it.str, w: it.width || 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    let out = "", endX = null;
    for (const p of r.parts) {
      if (endX != null && p.x - endX > 1.5 && !out.endsWith(" ") && !p.str.startsWith(" ")) out += " ";
      out += p.str; endX = p.x + p.w;
    }
    return out.replace(/\s+/g, " ").trim();
  }).filter(Boolean);
}

export async function readLineupFile(file) {
  if (/\.pdf$/i.test(file.name)) return pdfLines(await file.arrayBuffer());
  return textLines(await file.text());
}
export const textLines = text => String(text || "").split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim());

/* ---------------- parsing ---------------- */

const num = v => { const x = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(x) ? x : 0; };
// "(x31) Part present sensor", "(1) Clamp Cylinder", "(x2) …" — the quantity a line opens with.
// Bullets come through as •, o, a private-use glyph or nothing at all, so
// anything before the opening parenthesis that isn't a word is a marker.
const QTY = /^(?:o\s+)?[^\w(]*\(\s*x?\s*(\d+)\s*\)\s*(.*)$/i;
const qtyOf = line => { const m = line.match(QTY); return m ? { qty: Number(m[1]), rest: m[2] } : null; };
// A sub-item ("o (x1) VS smart camera – Part #…") repeats the item above it in more detail.
const isSub = line => /^o\s/.test(line);
const SUB_OK = new Set(["cylinders", "psets", "vacuumZones"]); // legitimately listed under a valve or a tool

const HEADER = [
  ["customerJob", /^(?:[A-Z]{2,5}\s+)?job\s*(?:#|no\.?|number)?\s*:\s*(.+)$/i],
  ["qty", /^qty\.?\s*:?\s*(.+)$/i],
  ["endUser", /^(?:end\s*user|customer|plant)\s*:\s*(.+)$/i],
  ["fixture", /^(?:fixture|machine|cell|station)\s*description\s*:\s*(.+)$/i],
  ["runoff", /^(?:run-?off|due|ship)\s*(?:date)?\s*:\s*(.+)$/i],
  ["cycleTime", /^cycle\s*time\s*:\s*(.+)$/i],
  ["references", /^reference\s*jobs?\s*:\s*(.+)$/i],
  ["plc", /^plc\s*:\s*(.+)$/i],
  ["hmi", /^hmi\s*:\s*(.+)$/i],
  ["plcEnclosure", /^plc\s*enclosure\s*:\s*(.+)$/i],
  ["hmiEnclosure", /^hmi\s*enclosure\s*:\s*(.+)$/i],
];

// Device rules: which lines count toward which driver. `not` rejects a line
// (a cable, a bracket, a part that only rides along); `mode` is "sum" for
// things that come in multiples and "max" for a system named more than once
// (the torque package and its controller are one controller).
const RULES = [
  { key: "cylinders", re: /cylinder/i, not: /switch|brake|break|sensor|part\s*#|pt\.?\s*#|cap\b|regulator|manifold|sub-?assembly/i, mode: "sum", also: /&\s*\(\s*x?(\d+)\s*\)/i },
  { key: "vacuumZones", re: /vacuum\s*(generator|ejector|zone|station)/i, not: /manifold|cable|cup/i, mode: "max" },
  { key: "sensors", re: /part\s*present|presence|photoelectric|photo\s*eye|prox(imity)?\s*(switch|sensor)|position\s*sensor|cube\s*sensor|pressure\s*(sensor|switch)|laser\s*sensor|\bsensor\b/i, not: /cable|bracket|mount|vision|camera|transducer|bypass|pressure\s*(sensor|switch)\s*for\s*air/i, mode: "sum" },
  { key: "opStations", re: /cycle\s*start\s*(button|relay|station)|two[- ]hand|palm\s*button/i, not: /cable|logic/i, mode: "max" },
  { key: "hmis", re: /touch\s*screen|panelview|\bhmi\b|operator\s*interface/i, not: /enclosure|extrusion|end\s*cap|swivel|end\s*plate|cable|box|mounted|button|light|IP\b|screen\s*shot/i, mode: "max" },
  { key: "drives", re: /\bvfd\b|variable\s*frequency|motor\s*driver|powerflex|conveyor/i, not: /cable|full\b|sensor/i, mode: "sum" },
  { key: "servoAxes", re: /servo|electric\s*actuator|linear\s*actuator/i, not: /cable|fieldbus|driver|power\s*supply|clamp\s+servo\s+ixx/i, mode: "sum" },
  { key: "robots", re: /\brobot\b/i, not: /controller|cable|adapter|package|software|dress|air\s*prep|pendant|support/i, mode: "sum" },
  { key: "torqueTools", re: /torque\s*(tool|controller|system)|power\s*focus|nutrunner|dc\s*tool/i, not: /cable|gun\b|storage|p-?set|arm\b|reaction|logic|value|sequence|equipment\s*not/i, mode: "max" },
  { key: "psets", re: /p-?sets?\b/i, not: /logic/i, mode: "max" },
  { key: "visionSystems", re: /vision|smart\s*camera|\bcamera\b/i, not: /cable|ring\s*light|led\s*light|filter|power\s*supply|mount|plate|card|bracket|connector|kit|bypass|failure|ball\s*(base|knuckle)|ip\b|not\s*required|attachment|conversion/i, mode: "sum" },
  { key: "dispensers", re: /dispens|glue\s*system|adhesive\s*system|sealant/i, not: /cable|nozzle|pump|valve|controller\s*~|mixing|static|not\s*required/i, mode: "max" },
  { key: "scanners", re: /scanner|bar\s*code\s*reader|barcode\s*reader/i, not: /cable|cradle|supplied\s*(&|and)?\s*(integrated\s*)?by\s*(the\s*)?customer|by\s*customer/i, mode: "sum" },
  { key: "ioBlocks", re: /i\/?o[- ]?link\s*(master|hub)|block\s*i\/?o|i\/?o\s*block|remote\s*i\/?o|armorblock|point\s*i\/?o/i, not: /cable|connection|bulkhead|receptacle|splitter|oneline|trunk/i, mode: "sum" },
  { key: "estops", re: /e-?\s?stop\s*(button|switch|pushbutton|station)?/i, not: /relay|cable|bulkhead|layout|location|to\s*relay|illuminated\s*push|circuit/i, mode: "sum" },
  { key: "lightCurtains", re: /light\s*curtain/i, not: /cable|bracket|connector|bulkhead|trunk|schematic|splitter|y-shaped/i, mode: "sum" },
  { key: "safetyDevices", re: /safety\s*mat|gate\s*switch|safety\s*switch|interlock|safety\s*cage|guard\s*lock|safety\s*scanner|door\s*switch/i, not: /cable|bulkhead|relay|actuator|lockout\s*device/i, mode: "sum" },
  { key: "ioAnalog", re: /transducer|analog|4-20\s*ma|0-10\s*v/i, not: /cable|module/i, mode: "sum" },
];

// Section boundaries. Devices are counted in the component lists only — the
// per-station tooling detail and the I/O drawings that follow repeat them.
const SEQ_START = /sequence\s*of\s*operations?/i;
const COMPONENTS_START = /^(major|electrical)?\s*components?\s*(on|for)?\s*(the\s*)?machine|^mechanical\s*components|^components\s*:/i;
const IO_START = /^inputs?\s*:?(\s|$)|^\s*inputs?\s+outputs?\s*$|^outputs?\s*:?(\s|$)/i;
const NOTES_START = /^(station\s*shown|notes?\s*\/?\s*comments?|tooling\s*shown|station\s*layout|cell\s*layout)/i;
const TOOLING_START = /nest\s*tooling|tooling\s*layout|cylinder\s*fault\s*screen|torque\s*screen/i;

export function parseLineup(lines, { fileName = "" } = {}) {
  const L = lines.map(l => String(l).trim()).filter(l => l !== "");
  const header = {};
  const counts = Object.fromEntries(DEVICE_FIELDS.map(d => [d.key, 0]));
  counts.ioAnalog = 0;
  const evidence = [];
  const notes = [];
  let ioIn = 0, ioOut = 0, steps = 0, stations = 0;
  const stationCodes = new Set(), stages = new Set();
  let section = "header";
  const seen = new Set(); // one rule hit per distinct line text
  let recipes = 0, headerIps = 0, sawDriver = false, sawPassenger = false;

  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    // header fields anywhere in the page
    for (const [k, re] of HEADER) {
      const m = line.match(re);
      if (m && header[k] == null) { header[k] = m[1].trim(); break; }
    }
    // The IP list in the header is the networked-device list; the drawings
    // further down repeat those addresses.
    if (section === "header" && !/subnet|gateway/i.test(line) && /\d+\.\d+\.\d+\.\d+|xxx\.xxx/i.test(line)) headerIps += 1;
    if (/\bdriver\b/i.test(line)) sawDriver = true;
    if (/\bpassenger\b/i.test(line)) sawPassenger = true;
    if (/^stage\s*#?\d+/i.test(line)) stages.add(line.match(/^stage\s*#?(\d+)/i)[1]);
    const code = line.match(/^[•o\-–*]?\s*(\d{3,6}-\d{2,4})\b/);
    if (code && section !== "io") stationCodes.add(code[1]);

    // section tracking
    if (SEQ_START.test(line)) { section = "sequence"; continue; }
    if (COMPONENTS_START.test(line)) { section = "components"; continue; }
    if (IO_START.test(line) && section !== "header") { section = "io"; }
    if (NOTES_START.test(line)) { section = "notes"; continue; }
    if (TOOLING_START.test(line) && section !== "components") { section = "tooling"; }

    if (section === "sequence") {
      if (/^(\d+[.)]|[•\-–*])\s*\S/.test(line) && !isSub(line)) steps += 1;
      continue;
    }
    if (section === "io") {
      const tot = line.match(/(\d+)\s*inputs?\b/i); if (tot) ioIn = Math.max(ioIn, Number(tot[1]));
      const tot2 = line.match(/(\d+)\s*outputs?\b/i); if (tot2) ioOut = Math.max(ioOut, Number(tot2[1]));
      // itemised analog points sit in the input list
      const q = qtyOf(line);
      if (q && /transducer|analog/i.test(q.rest)) counts.ioAnalog = Math.max(counts.ioAnalog, q.qty);
      if (q && /cycle\s*start/i.test(q.rest)) counts.opStations = Math.max(counts.opStations, q.qty);
      continue;
    }
    if (section === "notes") { if (/^[•\-–*o]?\s*\S/.test(line) && line.length < 140) notes.push(line.replace(/^[•\-–*o]\s*/, "")); continue; }
    if (section !== "components") continue;

    const q = qtyOf(line);
    if (!q || seen.has(line)) continue;
    for (const r of RULES) {
      if (isSub(line) && !SUB_OK.has(r.key)) continue;
      if (!r.re.test(q.rest) || r.not?.test(q.rest)) continue;
      // "(x1) Long Strip Clamp Cylinder & (x2) Side Strip Clamp Cyls." is three cylinders
      const more = r.also ? Number((q.rest.match(r.also) || [])[1]) || 0 : 0;
      if (r.mode === "max") counts[r.key] = Math.max(counts[r.key], q.qty + more); else counts[r.key] += q.qty + more;
      evidence.push({ key: r.key, qty: q.qty, line: q.rest.slice(0, 90) });
      seen.add(line);
      break;
    }
  }

  // Header clean-up: "(x1) 8855-100" carries the quantity; "(x2) Maple…" the HMI count.
  if (header.customerJob) {
    const m = header.customerJob.match(/^\(\s*x?(\d+)\s*\)\s*(.*)$/i);
    if (m) { header.qty = header.qty || m[1]; header.customerJob = m[2].trim(); }
  }
  header.qty = header.qty ? String(num(header.qty) || header.qty).replace(/[()]/g, "") : "1";
  if (header.hmi) {
    const m = header.hmi.match(/^\(\s*x?(\d+)\s*\)/i);
    if (m) counts.hmis = Math.max(counts.hmis, Number(m[1]));
  }
  if (!counts.hmis && header.hmi) counts.hmis = 1;
  // Every controller on the network needs an address and a connection: the
  // header's IP list when it has one, else what the devices imply.
  counts.ipDevices = Math.max(headerIps, 1 + (counts.hmis || 1) + counts.torqueTools + counts.visionSystems + counts.robots + counts.dispensers + counts.drives);
  if (sawDriver && sawPassenger) recipes = Math.max(recipes, 2);
  if (!counts.opStations) counts.opStations = 1;
  const safety = L.some(l => /safety\s*(controller|plc)|guardlogix|GC-1000|safety\s*i\/o/i.test(l)) ? "plc"
    : L.some(l => /e-?stop\s*relay|safety\s*relay/i.test(l)) ? "relay" : "none";
  stations = Math.max(stationCodes.size, stages.size, 1);
  // Screens and alarms are not in a lineup; start from what the content needs.
  const screens = 4 + (stations > 1 ? stations : 0) + (counts.torqueTools ? 1 : 0) + (counts.visionSystems ? 1 : 0)
    + (counts.robots ? 2 : 0) + (counts.dispensers ? 1 : 0) + (counts.vacuumZones ? 1 : 0) + (counts.cylinders ? 1 : 0);
  const alarms = 6 + counts.cylinders * 2 + counts.vacuumZones + counts.sensors + counts.robots * 6 + counts.torqueTools * 4
    + counts.visionSystems * 2 + counts.dispensers * 4 + counts.drives * 2 + counts.servoAxes * 3 + counts.lightCurtains + counts.safetyDevices;

  return {
    fileName,
    header: { customerJob: "", endUser: "", fixture: "", qty: "1", plc: "", hmi: "", cycleTime: "", runoff: "", references: "", ...header },
    counts, io: { inputs: ioIn, outputs: ioOut }, stations, stages: stages.size, steps, recipes, screens, alarms, safety, notes, evidence,
  };
}

/* ---------------- into an estimate ---------------- */

// A start-up allowance from the size of the job: a couple of days for a
// single station, more with I/O, and a robot or a dispensing system adds its
// own commissioning. Suggestion only — it is a field on the estimate.
export function suggestStartupDays(r) {
  const io = (r.io.inputs + r.io.outputs) || 0;
  return Math.max(2, Math.ceil(2 + io / 40 + r.counts.robots * 3 + r.counts.dispensers * 2 + r.counts.servoAxes * 0.5));
}

// Assumptions a lineup implies, added to the shop's standard ones.
export function lineupAssumptions(r, customerName) {
  const out = [];
  if (r.header.customerJob) out.push(`Estimate is based on ${customerName ? customerName + " " : ""}Electrical Engineering Line-up for job ${r.header.customerJob}${r.header.fixture ? ` (${r.header.fixture})` : ""}; changes to the lineup are quoted separately.`);
  if (r.notes.some(n => /spare\s*i\/o/i.test(n))) out.push("I/O is sized with 30% spare per the lineup.");
  if (r.header.references) out.push(`Standard hardware and program structure follow reference job ${r.header.references}.`);
  if (r.notes.some(n => /standard\s*hardware/i.test(n))) out.push("Hardware and controls follow the customer's standard practices as noted on the lineup.");
  out.push("All control hardware, field devices and cabling are supplied by the customer per the lineup BOM; this estimate is engineering, programming and start-up only.");
  return out;
}

export function driversFromLineup(r) {
  const c = r.counts;
  const typedIo = r.io.inputs + r.io.outputs;
  return {
    ioDiscrete: typedIo > 0 ? typedIo : "",
    ioAnalog: c.ioAnalog || 0,
    cylinders: c.cylinders, vacuumZones: c.vacuumZones, sensors: c.sensors, opStations: c.opStations, hmis: c.hmis || 1,
    drives: c.drives, servoAxes: c.servoAxes, robots: c.robots, torqueTools: c.torqueTools, psets: c.psets,
    visionSystems: c.visionSystems, dispensers: c.dispensers, scanners: c.scanners, ioBlocks: c.ioBlocks, ipDevices: c.ipDevices,
    estops: c.estops, lightCurtains: c.lightCurtains, safetyDevices: c.safetyDevices,
    stations: r.stations, steps: r.steps, panels: 1 + (c.hmis || 1), networks: 1, screens: r.screens, alarms: r.alarms, recipes: r.recipes,
    safety: r.safety, dataCollection: false, remoteAccess: false,
    reusePct: r.header.references ? 20 : 0,
    trips: 1, daysPerTrip: suggestStartupDays(r), people: 1, travelIncluded: true,
  };
}

// The customer this lineup belongs to: the one whose name is on the page.
export function guessCustomer(lines, customers) {
  const text = lines.join("\n").toLowerCase();
  const hit = customers.filter(c => c.name && text.includes(c.name.toLowerCase()));
  return hit.sort((a, b) => b.name.length - a.name.length)[0] || null;
}
