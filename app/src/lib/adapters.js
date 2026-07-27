// DB row (snake_case) ↔ app shape (camelCase, CLAUDE.md §5) adapters.
// The app shape is kept byte-for-byte compatible with the legacy localStorage
// version so the calc core and views run unchanged, and JSON backups
// export/import in the same format.
//
// Empty-string ids become null on the way in — uuid columns reject "".
const idOrNull = v => (v ? v : null);
const dateOrNull = v => (v ? v : null);
const num = v => Number(v) || 0;

/* ---- contacts ---- */
export const contactToRow = c => ({ id: c.id, type: c.type, name: c.name ?? "", contact: c.contact ?? "", email: c.email ?? "", phone: c.phone ?? "", address: c.address ?? "", code: c.code ?? "" });
export const contactFromRow = r => ({ id: r.id, type: r.type, name: r.name, contact: r.contact, email: r.email, phone: r.phone, address: r.address, code: r.code || "" });

/* ---- catalog ---- */
export const catalogToRow = c => ({ id: c.id, description: c.desc ?? "", unit: c.unit ?? "", unit_price: num(c.unitPrice) });
export const catalogFromRow = r => ({ id: r.id, desc: r.description, unit: r.unit, unitPrice: num(r.unit_price) });

/* ---- line items (shared by quotes / SOs / invoices) ---- */
export const lineItemsToRows = (items, parentKey, parentId) =>
  (items || []).map((it, i) => ({ id: it.id, [parentKey]: parentId, description: it.desc ?? "", qty: num(it.qty), unit: it.unit ?? "", unit_price: num(it.unitPrice), sort: i }));
export const lineItemFromRow = r => ({ id: r.id, desc: r.description, qty: num(r.qty), unit: r.unit, unitPrice: num(r.unit_price) });

/* ---- payments ---- */
export const paymentToRow = (p, parentType, parentId) => ({ id: p.id, parent_type: parentType, parent_id: parentId, amount: num(p.amount), date: dateOrNull(p.date), method: p.method ?? "", ref: p.ref ?? "" });
export const paymentFromRow = r => ({ id: r.id, amount: num(r.amount), date: r.date || "", method: r.method, ref: r.ref || "" });

/* ---- quotes ---- */
export const quoteToRow = q => ({
  id: q.id, number: q.number, customer_id: idOrNull(q.customerId), date: dateOrNull(q.date),
  expiry_date: dateOrNull(q.expiryDate), status: q.status, po_number: q.poNumber ?? "",
  tax_rate: num(q.taxRate), notes: q.notes ?? "", sales_order_id: idOrNull(q.salesOrderId),
});
export const quoteFromRow = (r, items) => ({
  id: r.id, number: r.number, customerId: r.customer_id || "", date: r.date || "",
  expiryDate: r.expiry_date || "", status: r.status, poNumber: r.po_number,
  taxRate: num(r.tax_rate), notes: r.notes, ...(r.sales_order_id ? { salesOrderId: r.sales_order_id } : {}),
  lineItems: items || [],
});

/* ---- sales orders ---- */
export const soToRow = s => ({
  id: s.id, number: s.number, quote_id: idOrNull(s.quoteId), customer_id: idOrNull(s.customerId),
  po_number: s.poNumber ?? "", date: dateOrNull(s.date), status: s.status,
  tax_rate: num(s.taxRate), invoice_id: idOrNull(s.invoiceId),
});
export const soFromRow = (r, items) => ({
  id: r.id, number: r.number, quoteId: r.quote_id || "", customerId: r.customer_id || "",
  poNumber: r.po_number, date: r.date || "", status: r.status, taxRate: num(r.tax_rate),
  ...(r.invoice_id ? { invoiceId: r.invoice_id } : {}), lineItems: items || [],
});

/* ---- invoices ---- */
export const invoiceToRow = i => ({
  id: i.id, number: i.number, sales_order_id: idOrNull(i.salesOrderId), quote_id: idOrNull(i.quoteId),
  customer_id: idOrNull(i.customerId), po_number: i.poNumber ?? "", date: dateOrNull(i.date),
  due_date: dateOrNull(i.dueDate), tax_rate: num(i.taxRate), notes: i.notes ?? "",
  proposal_id: idOrNull(i.proposalId), contact_person_id: idOrNull(i.contactPersonId),
});
export const invoiceFromRow = (r, items, payments) => ({
  id: r.id, number: r.number, salesOrderId: r.sales_order_id || "", quoteId: r.quote_id || "",
  customerId: r.customer_id || "", poNumber: r.po_number, date: r.date || "", dueDate: r.due_date || "",
  taxRate: num(r.tax_rate), notes: r.notes || "", proposalId: r.proposal_id || "",
  contactPersonId: r.contact_person_id || "", lineItems: items || [], payments: payments || [],
});

/* ---- contact people ---- */
export const personToRow = p => ({ id: p.id, contact_id: p.contactId, name: p.name ?? "", title: p.title ?? "", email: p.email ?? "", phone: p.phone ?? "" });
export const personFromRow = r => ({ id: r.id, contactId: r.contact_id, name: r.name, title: r.title, email: r.email, phone: r.phone });

/* ---- machine types (costing rates) ---- */
export const machineTypeToRow = m => ({
  id: m.id, name: m.name ?? "", eng_base: num(m.engBase), camera_rate: num(m.cameraRate),
  panel_budget: num(m.panelBudget), io_first: num(m.ioFirst), io_addl: num(m.ioAddl),
  dn_checkout: num(m.dnCheckout), dn_material: num(m.dnMaterial), field_wiring: num(m.fieldWiring),
  runoff: num(m.runoff), remote_hmi: num(m.remoteHmi), sort: num(m.sort),
});
export const machineTypeFromRow = r => ({
  id: r.id, name: r.name, engBase: num(r.eng_base), cameraRate: num(r.camera_rate),
  panelBudget: num(r.panel_budget), ioFirst: num(r.io_first), ioAddl: num(r.io_addl),
  dnCheckout: num(r.dn_checkout), dnMaterial: num(r.dn_material), fieldWiring: num(r.field_wiring),
  runoff: num(r.runoff), remoteHmi: num(r.remote_hmi), sort: num(r.sort),
});

/* ---- proposals ---- */
export const proposalToRow = p => ({
  id: p.id, number: p.number, customer_id: idOrNull(p.customerId), contact_person_id: idOrNull(p.contactPersonId),
  date: dateOrNull(p.date), status: p.status, job_number: p.jobNumber ?? "", description: p.description ?? "",
  location: p.location ?? "", machine_type_id: idOrNull(p.machineTypeId), specs: p.specs || {},
  pricing: p.pricing || {}, phases: p.phases || [], notes: p.notes ?? "", po_number: p.poNumber ?? "",
  sales_order_id: idOrNull(p.salesOrderId),
});
export const proposalFromRow = r => ({
  id: r.id, number: r.number, customerId: r.customer_id || "", contactPersonId: r.contact_person_id || "",
  date: r.date || "", status: r.status, jobNumber: r.job_number, description: r.description,
  location: r.location, machineTypeId: r.machine_type_id || "", specs: r.specs || {},
  pricing: r.pricing || {}, phases: r.phases || [], notes: r.notes, poNumber: r.po_number,
  salesOrderId: r.sales_order_id || "",
});

/* ---- bills ---- */
export const billToRow = b => ({
  id: b.id, number: b.number, vendor_id: idOrNull(b.vendorId), date: dateOrNull(b.date),
  due_date: dateOrNull(b.dueDate), amount: num(b.amount), ref: b.ref ?? "", notes: b.notes ?? "",
});
export const billFromRow = (r, payments) => ({
  id: r.id, number: r.number, vendorId: r.vendor_id || "", date: r.date || "", dueDate: r.due_date || "",
  amount: num(r.amount), ref: r.ref, notes: r.notes, payments: payments || [],
});

/* ---- expenses ---- */
export const expenseToRow = e => ({ id: e.id, date: dateOrNull(e.date), category: e.category ?? "", vendor: e.vendor ?? "", amount: num(e.amount), method: e.method ?? "", notes: e.notes ?? "" });
export const expenseFromRow = r => ({ id: r.id, date: r.date || "", category: r.category, vendor: r.vendor, amount: num(r.amount), method: r.method, notes: r.notes });
