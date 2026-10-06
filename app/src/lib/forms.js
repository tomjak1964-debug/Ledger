// Print forms — named, editable layouts for the documents Ledger prints.
//
// A form is a plain object stored in settings (jsonb, so no migration):
//   { id, name, type, fontSize, rowHeight, offsetX, offsetY, fields: { key: {on,x,y,align,size} } }
// Built-in forms live here in code; settings.forms holds user-created forms and
// overrides of the built-ins, and settings.formFor maps a document type to the
// form that prints it (Settings → Forms).
//
// Coordinates are INCHES from the top-left of the page. offsetX/offsetY shift
// the whole form — that's the printer calibration knob, so a drifting tray is
// fixed once instead of field by field.

export const FORM_TYPES = [
  { key: "check", label: "Checks", hint: "Printed on pre-printed check stock"  },
  { key: "remittance", label: "Remittance Advice", hint: "Sent with electronic payments"  },
  { key: "invoice", label: "Invoices", hint: "Customer invoices and statements"  },
];

// Field catalogue per form type. axes says which coordinates mean anything:
//   "xy" a point · "x" a column (its row's y comes from the block) · "y" a block.
export const FIELD_SPECS = {
  check: [
    { key: "date", label: "Date", group: "Check", axes: "xy", short: "Date" },
    { key: "payee", label: "Pay to the order of", group: "Check", axes: "xy", short: "Payee" },
    { key: "amount", label: "Amount (numeric)", group: "Check", axes: "xy", align: true, short: "Amount" },
    { key: "words", label: "Amount in words", group: "Check", axes: "xy", short: "In words" },
    { key: "address", label: "Payee address", group: "Check", axes: "xy", short: "Address" },
    { key: "memo", label: "Memo", group: "Check", axes: "xy", short: "Memo" },

    { key: "stubTop", label: "Top voucher — first line", group: "Voucher rows", axes: "y", short: "Top rows" },
    { key: "footTop", label: "Top voucher — totals line", group: "Voucher rows", axes: "y", short: "Top totals" },
    { key: "stubBottom", label: "Bottom voucher — first line", group: "Voucher rows", axes: "y", short: "Bottom rows" },
    { key: "footBottom", label: "Bottom voucher — totals line", group: "Voucher rows", axes: "y", short: "Bottom totals" },

    { key: "col.ref", label: "Reference No.", group: "Voucher columns", axes: "x", align: true, short: "Ref" },
    { key: "col.desc", label: "Description", group: "Voucher columns", axes: "x", align: true, short: "Desc" },
    { key: "col.invDate", label: "Invoice Date", group: "Voucher columns", axes: "x", align: true, short: "Inv date" },
    { key: "col.invAmount", label: "Invoice Amount", group: "Voucher columns", axes: "x", align: true, short: "Inv amt" },
    { key: "col.discount", label: "Discount Taken", group: "Voucher columns", axes: "x", align: true, short: "Disc" },
    { key: "col.amountPaid", label: "Amount Paid", group: "Voucher columns", axes: "x", align: true, short: "Paid" },

    // The bottom voucher's rules don't sit under the top one's on every stock;
    // a form that doesn't set these uses the top voucher's columns.
    { key: "colB.ref", label: "Reference No.", group: "Bottom voucher columns", axes: "x", align: true, short: "Ref" },
    { key: "colB.desc", label: "Description", group: "Bottom voucher columns", axes: "x", align: true, short: "Desc" },
    { key: "colB.invDate", label: "Invoice Date", group: "Bottom voucher columns", axes: "x", align: true, short: "Inv date" },
    { key: "colB.invAmount", label: "Invoice Amount", group: "Bottom voucher columns", axes: "x", align: true, short: "Inv amt" },
    { key: "colB.discount", label: "Discount Taken", group: "Bottom voucher columns", axes: "x", align: true, short: "Disc" },
    { key: "colB.amountPaid", label: "Amount Paid", group: "Bottom voucher columns", axes: "x", align: true, short: "Paid" },

    { key: "foot.date", label: "Check Date", group: "Voucher totals", axes: "x", align: true, short: "Date" },
    { key: "foot.number", label: "Check No.", group: "Voucher totals", axes: "x", align: true, short: "Check #" },
    { key: "foot.payee", label: "Payee", group: "Voucher totals", axes: "x", align: true, short: "Payee" },
    { key: "foot.discounts", label: "Discounts Taken", group: "Voucher totals", axes: "x", align: true, short: "Disc tot" },
    { key: "foot.amount", label: "Check Amount", group: "Voucher totals", axes: "x", align: true, short: "Total" },
  ],
  remittance: [],
  invoice: [],
};

const F = (x, y, extra) => ({ on: true, x, y, ...(extra || {}) });

// The check stock in use (LAP98): voucher, check, voucher. Measured off a scan
// of the blank stock laid over a Ledger test print, so the numbers include this
// printer's drift. The vouchers' rules differ, and so do their totals lines:
//   top voucher     0.11 / 1.12 / 3.51 / 4.26 / 5.70 / 6.83 / 8.26 in
//   bottom voucher  0.15 / 1.14 / 3.65 / 4.39 / 5.68 / 6.84 / 8.29 in
//   totals lines    0.12 / 1.44 / 2.40 / 5.71 / 6.84 / 8.26 in (bottom ~0.03 right)
// Text sits about a sixteenth inside each rule. On the check, the date sits
// beside DATE, the amount beside the $, and the payee's name and address beside
// PAY TO THE ORDER OF, where the envelope window shows them. There is no memo
// line on this stock; the memo sits above the MICR clear band.
export const TMJ_3PART_CHECK = {
  id: "tmj-3part-check",
  name: "TMJ 3Part Check",
  type: "check",
  builtin: true,
  fontSize: 10,
  rowHeight: 0.17,
  offsetX: 0,
  offsetY: 0,
  guides: [0.45, 3.38, 3.5, 7.0, 7.62, 10.54],
  fields: {
    date: F(7.50, 4.11), payee: { on: false, x: 0.90, y: 5.30 }, amount: F(6.45, 4.89, { align: "left" }),
    words: F(0.33, 5.03), address: F(0.90, 5.30), memo: F(0.90, 6.15),

    stubTop: F(0, 0.81), footTop: F(0, 3.26),
    stubBottom: F(0, 7.95), footBottom: F(0, 10.39),

    "col.ref": F(0.17, 0, { align: "left" }),
    "col.desc": F(1.18, 0, { align: "left" }),
    "col.invDate": F(3.54, 0, { align: "left", size: 8 }),   // ¾" column: "Sep 10, 2026" needs 8pt
    "col.invAmount": F(5.64, 0, { align: "right" }),
    "col.discount": F(6.77, 0, { align: "right" }),
    "col.amountPaid": F(8.20, 0, { align: "right" }),

    "colB.ref": F(0.20, 0, { align: "left" }),
    "colB.desc": F(1.20, 0, { align: "left" }),
    "colB.invDate": F(3.68, 0, { align: "left", size: 8 }),
    "colB.invAmount": F(5.62, 0, { align: "right" }),
    "colB.discount": F(6.78, 0, { align: "right" }),
    "colB.amountPaid": F(8.23, 0, { align: "right" }),

    "foot.date": F(0.19, 0, { align: "left" }),
    "foot.number": F(1.52, 0, { align: "left" }),
    "foot.payee": F(2.47, 0, { align: "left" }),
    "foot.discounts": F(6.78, 0, { align: "right" }),
    "foot.amount": F(8.21, 0, { align: "right" }),
  },
};

// The layout this app shipped with: check on top, two plain stubs below.
export const CLASSIC_VOUCHER_CHECK = {
  id: "classic-voucher-check",
  name: "Classic Voucher Check (check on top)",
  type: "check",
  builtin: true,
  fontSize: 10,
  rowHeight: 0.19,
  offsetX: 0,
  offsetY: 0,
  guides: [3.5, 7.0],
  fields: {
    date: F(6.30, 0.95), payee: F(0.90, 1.50), amount: F(7.05, 1.50, { align: "left" }),
    words: F(0.35, 1.90), address: F(0.90, 2.30), memo: F(0.55, 3.15),

    stubTop: F(0, 3.90), footTop: F(0, 6.80),
    stubBottom: F(0, 7.45), footBottom: F(0, 10.35),

    "col.ref": F(0.40, 0, { align: "left" }),
    "col.desc": F(1.50, 0, { align: "left" }),
    "col.invDate": { on: false, x: 4.60, y: 0, align: "left" },
    "col.invAmount": { on: false, x: 6.10, y: 0, align: "right" },
    "col.discount": F(6.90, 0, { align: "right" }),
    "col.amountPaid": F(7.60, 0, { align: "right" }),

    "foot.date": { on: false, x: 0.40, y: 0, align: "left" },
    "foot.number": { on: false, x: 1.50, y: 0, align: "left" },
    "foot.payee": { on: false, x: 3.00, y: 0, align: "left" },
    "foot.discounts": F(6.90, 0, { align: "right" }),
    "foot.amount": F(7.60, 0, { align: "right" }),
  },
};

// Remittances and invoices are laid out by their own renderers; they are listed
// so a document type always names the form that prints it.
export const STANDARD_REMITTANCE = { id: "standard-remittance", name: "Standard Remittance Advice", type: "remittance", builtin: true, fixed: true, fields: {} };
export const STANDARD_INVOICE = { id: "standard-invoice", name: "Standard Invoice", type: "invoice", builtin: true, fixed: true, fields: {} };

export const BUILTIN_FORMS = [TMJ_3PART_CHECK, CLASSIC_VOUCHER_CHECK, STANDARD_REMITTANCE, STANDARD_INVOICE];

const builtin = id => BUILTIN_FORMS.find(f => f.id === id);

// Legacy Settings → Check Printing positions (settings.check.fields) still
// drive the classic form, so anyone who nudged their alignment keeps it.
function legacyCheckOverrides(settings) {
  const c = settings?.check;
  if (!c?.fields) return null;
  const out = {};
  ["date", "payee", "amount", "words", "address", "memo"].forEach(k => { if (c.fields[k]) out[k] = c.fields[k]; });
  if (c.fields.stub1) out.stubTop = { y: c.fields.stub1.y };
  if (c.fields.stub2) out.stubBottom = { y: c.fields.stub2.y };
  return { fields: out, ...(c.fontSize ? { fontSize: c.fontSize } : {}) };
}

const mergeForm = (base, over) => ({
  ...base, ...over,
  fields: Object.fromEntries(Object.keys({ ...base.fields, ...(over?.fields || {}) })
    .map(k => [k, { ...(base.fields?.[k] || {}), ...(over?.fields?.[k] || {}) }])),
});

// Every form available: built-ins (with any saved edits folded in) plus the
// user's own forms.
export function formsOf(settings) {
  const saved = Array.isArray(settings?.forms) ? settings.forms : [];
  const legacy = legacyCheckOverrides(settings);
  const builtins = BUILTIN_FORMS.map(b => {
    let f = b;
    if (b.id === CLASSIC_VOUCHER_CHECK.id && legacy) f = mergeForm(f, legacy);
    const over = saved.find(s => s.id === b.id);
    return over ? mergeForm(f, { ...over, builtin: true }) : f;
  });
  const custom = saved.filter(s => !builtin(s.id)).map(s => mergeForm(blankForm(s.type), s));
  return [...builtins, ...custom];
}

export function blankForm(type, name) {
  const base = type === "check" ? TMJ_3PART_CHECK : type === "remittance" ? STANDARD_REMITTANCE : STANDARD_INVOICE;
  return { ...base, id: "form-" + Math.random().toString(36).slice(2, 10), name: name || "New Form", builtin: false,
    fields: JSON.parse(JSON.stringify(base.fields)) };
}

// Which form prints a document type. Anyone with tuned legacy check positions
// keeps the classic layout; everyone else gets the TMJ stock.
export function defaultFormId(settings, type) {
  if (type === "check") return legacyCheckOverrides(settings) ? CLASSIC_VOUCHER_CHECK.id : TMJ_3PART_CHECK.id;
  return type === "remittance" ? STANDARD_REMITTANCE.id : STANDARD_INVOICE.id;
}

export function formFor(settings, type) {
  const all = formsOf(settings);
  const id = settings?.formFor?.[type] || defaultFormId(settings, type);
  return all.find(f => f.id === id && f.type === type) || all.find(f => f.type === type);
}

// Field values with catalogue defaults filled in, in catalogue order.
export function fieldsOf(form) {
  const specs = FIELD_SPECS[form?.type] || [];
  const base = (form?.type === "check" ? TMJ_3PART_CHECK : form) || {};
  return specs.map(spec => {
    const top = spec.key.startsWith("colB.") && !form?.fields?.[spec.key] && form?.fields?.["col." + spec.key.slice(5)];
    const def = top || base.fields?.[spec.key] || { on: true, x: 0, y: 0 };
    const val = form?.fields?.[spec.key] || {};
    return { ...spec, canAlign: spec.align === true, on: val.on !== false, x: Number(val.x ?? def.x) || 0, y: Number(val.y ?? def.y) || 0,
      align: val.align || def.align || "left", size: Number(val.size || def.size || 0) || 0 };
  });
}

// One field, resolved, with the form's calibration offset applied.
export function placed(form, key) {
  const f = fieldsOf(form).find(x => x.key === key);
  if (!f) return null;
  return { ...f, x: f.x + (Number(form.offsetX) || 0), y: f.y + (Number(form.offsetY) || 0) };
}
