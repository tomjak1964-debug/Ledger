// What a fixture proposal provides. A scope package is a saved starting point —
// Turnkey Controls for Venture Global, Software & Start-Up for Automated
// Solutions — and the proposal carries its own ticks (specs.scope), PLC / HMI
// and end customer. The ticks decide the price lines (calc/proposals.js
// priceProposal), the scope bullets, the sales notes and, through the package,
// the invoicing schedule (views/Proposals.jsx buildProposalContent).
//
// Packages live in settings.fixturePackages; until one is saved the two below
// stand in. A package names its customers by id once edited; the built-in two
// find theirs by name (`match`).
import { DEFAULT_PHASES } from "./proposals.js";

export const SCOPE_ITEMS = [
  { key: "hwDesign", label: "Hardware (electrical) design & drawings" },
  { key: "plc", label: "PLC software" },
  { key: "hmi", label: "HMI software", hint: "only when the proposal has an HMI" },
  { key: "panel", label: "Control panel, remote HMI / sonic panels (build & supply)" },
  { key: "blockIo", label: "Block I/O & cables" },
  { key: "fieldWiring", label: "Field wiring" },
  { key: "startup", label: "Start-up / debug" },
  { key: "runoff", label: "Run-off support" },
  { key: "docs", label: "Final programs & documentation" },
];
// Data National stays the proposal's own tick (specs.dataNational), as before.

const allOn = () => Object.fromEntries(SCOPE_ITEMS.map(i => [i.key, true]));

export const DEFAULT_PACKAGES = [
  {
    id: "turnkey", name: "Turnkey Controls", intro: "Turnkey Controls", match: "venture global",
    location: "Venture Global Engineering, Imlay City, MI",
    standards: "Venture Global Engineering and {end} Revised Standards",
    endCustomers: ["Mayco", "JVIS", "Nova"],
    plcType: "Allen Bradley CompactLogix", hmiType: "Allen Bradley PanelView Plus",
    scope: allOn(),
    phases: DEFAULT_PHASES,
  },
  {
    id: "software", name: "Software & Start-Up", intro: "Controls Software and Start-Up Support", match: "automated solutions",
    location: "Automated Solutions, Shelby Twp, MI",
    standards: "ASI and {end} Standards",
    endCustomers: ["Adient", "Bridgewater Interiors", "Performance Seats", "JAC Products", "Henniges"],
    plcType: "Allen Bradley CompactLogix", hmiType: "Allen Bradley PanelView Plus",
    scope: { ...Object.fromEntries(SCOPE_ITEMS.map(i => [i.key, false])), plc: true, hmi: true, startup: true, docs: true },
    phases: [
      { key: "software", label: "Software Support", pct: 10 },
      { key: "startup", label: "Start-Up Complete", pct: 80 },
      { key: "docs", label: "Final Programs/Documentation", pct: 10 },
    ],
  },
];

export const packagesOf = settings => (Array.isArray(settings?.fixturePackages) && settings.fixturePackages.length ? settings.fixturePackages : DEFAULT_PACKAGES);

export const packageById = (settings, id) => packagesOf(settings).find(p => p.id === id) || null;

// The package a customer's proposals start on: one that names the customer,
// else one whose name pattern matches it, else the first.
export function packageForCustomer(db, customerId) {
  const pk = packagesOf(db.settings);
  const c = (db.contacts || []).find(x => x.id === customerId);
  return pk.find(p => (p.customerIds || []).includes(customerId))
    || (c && pk.find(p => p.match && (c.name || "").toLowerCase().includes(p.match)))
    || pk[0];
}

// The proposal fields a package sets: its ticks, PLC / HMI and schedule.
export const packageDefaults = pkg => ({
  packageId: pkg.id, scope: { ...pkg.scope }, plcType: pkg.plcType || "", hmiType: pkg.hmiType || "",
});

// "Venture Global Engineering and {end} Revised Standards" with the end customer
// filled in — or, with none, the clause dropped ("Venture Global Engineering
// Revised Standards").
export function standardsLine(pkg, endCustomer) {
  const t = String(pkg?.standards || "").trim();
  if (!t) return "";
  const end = String(endCustomer || "").trim();
  return end ? t.replace(/\{end\}/g, end) : t.replace(/\s*(and|&)\s*\{end\}/gi, "").replace(/\{end\}/g, "").replace(/\s+/g, " ").trim();
}
