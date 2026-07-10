import { uid } from "./helpers.js";

// First-run settings for a fresh account. Counters live in the sequences
// table, not here (they're merged into db.settings.counters at load time).
export function defaultSettings() {
  return {
    company: "", companyAddress: "", companyEmail: "", companyPhone: "",
    taxRate: 6,
    terms: 30,
    quotePrefix: "QUO", soPrefix: "SO", invPrefix: "INV", billPrefix: "BILL",
    quoteNotes: "Quote valid for 30 days. Lead times confirmed at PO. Prices exclude freight unless noted.",
    invoiceNotes: "Payment due within terms. Make checks payable to the company above. Thank you for your business.",
  };
}

// The legacy sample dataset (seed() in ledger.html) — used by Settings →
// Load Sample Data to explore the app.
export function sampleData() {
  const contacts = [
    { id: uid(), type: "customer", name: "Meridian Foods Inc.", contact: "Dana Ruiz", email: "dana.ruiz@meridianfoods.com", phone: "(616) 555-0148", address: "1420 Industrial Pkwy\nGrand Rapids, MI 49512" },
    { id: uid(), type: "customer", name: "Apex Bottling Co.", contact: "Marcus Bell", email: "mbell@apexbottling.com", phone: "(419) 555-0192", address: "88 Canal St\nToledo, OH 43604" },
    { id: uid(), type: "vendor", name: "Rockwell Distributor — Kendall", contact: "Orders Desk", email: "orders@kendall-ea.com", phone: "(800) 555-0110", address: "" },
    { id: uid(), type: "vendor", name: "McMaster-Carr", contact: "", email: "", phone: "", address: "" },
  ];
  const catalog = [
    { id: uid(), desc: "Controls engineering — PLC/HMI programming", unit: "hour", unitPrice: 145 },
    { id: uid(), desc: "Field service — startup & commissioning", unit: "hour", unitPrice: 165 },
    { id: uid(), desc: "On-site travel", unit: "hour", unitPrice: 95 },
    { id: uid(), desc: "UL508A control panel build (per panel)", unit: "each", unitPrice: 0 },
    { id: uid(), desc: "Field wiring & installation support", unit: "hour", unitPrice: 110 },
    { id: uid(), desc: "FANUC robot integration & teach", unit: "hour", unitPrice: 155 },
  ];
  const settings = {
    ...defaultSettings(),
    company: "Northbridge Controls, LLC",
    companyAddress: "27 Foundry Lane, Suite 200\nKalamazoo, MI 49007",
    companyEmail: "quotes@northbridgecontrols.com",
    companyPhone: "(269) 555-0134",
  };
  return { settings, contacts, catalog };
}
