// The people at a customer or vendor, and which of them each kind of document
// goes to (migration 034). A company carries one preference per kind — the
// person its invoices, its proposals and its remittances are emailed to —
// and an email dialog opens addressed to that person. With none picked (or the
// person since removed), the company's own email stands in.
export const PREF_FIELD = { invoice: "prefInvoicePersonId", proposal: "prefProposalPersonId", remittance: "prefRemitPersonId" };
export const PREF_LABEL = { invoice: "Invoices", proposal: "Proposals", remittance: "Remittances" };
// Which preferences a company of each type offers.
export const PREF_KINDS = { customer: ["invoice", "proposal"], vendor: ["remittance"] };

export const peopleOf = (db, contactId) => (db.contactPeople || []).filter(p => p.contactId === contactId);

export function preferredPerson(db, contactOrId, kind) {
  const c = typeof contactOrId === "string" ? (db.contacts || []).find(x => x.id === contactOrId) : contactOrId;
  const id = c?.[PREF_FIELD[kind]];
  return (id && (db.contactPeople || []).find(p => p.id === id && p.contactId === c.id)) || null;
}

// The address an email of `kind` to this company opens with: the person the
// document itself names, else the preferred person (when they have an email),
// else the company email.
export function emailFor(db, contactId, kind, docPersonId) {
  const c = (db.contacts || []).find(x => x.id === contactId);
  const own = docPersonId && (db.contactPeople || []).find(p => p.id === docPersonId);
  const pref = preferredPerson(db, c, kind);
  const legacy = kind === "remittance" ? (c?.remitEmail || "").trim() : "";
  return (own?.email || "").trim() || (pref?.email || "").trim() || legacy || (c?.email || "").trim();
}

// The name to show for a company's contact: the preferred person for `kind`,
// else the first person on file, else the single contact name it used to carry.
export function contactNameFor(db, c, kind) {
  if (!c) return "";
  return preferredPerson(db, c, kind)?.name || peopleOf(db, c.id)[0]?.name || (c.contact || "").trim();
}

// A vendor as the remittance renderers read it: remitName / remitEmail /
// remitPhone come from the person preferred for remittances, when there is one.
export function remitVendor(db, vendor) {
  if (!vendor) return vendor;
  const p = preferredPerson(db, vendor, "remittance");
  return p ? { ...vendor, remitName: p.name, remitEmail: p.email || vendor.remitEmail, remitPhone: p.phone || vendor.remitPhone } : vendor;
}

// Who a new proposal for this customer is addressed to: the person preferred
// for proposals, else the single contact name the customer used to carry.
export function proposalAttn(db, customer) {
  const p = preferredPerson(db, customer, "proposal");
  return p ? { contactPersonId: p.id, contactName: p.name } : { contactPersonId: "", contactName: (customer?.contact || "").trim() };
}

// The person a proposal is addressed to, as a record when there is one: the
// one it names by id, else the customer's contact whose name the Attn line
// carries, else — with no Attn typed — the person preferred for proposals.
export function proposalPerson(db, p, customer) {
  const people = customer ? peopleOf(db, customer.id) : [];
  const byId = p.contactPersonId && (db.contactPeople || []).find(x => x.id === p.contactPersonId);
  if (byId) return byId;
  const typed = (p.contactName || "").trim().toLowerCase();
  if (typed) return people.find(x => (x.name || "").trim().toLowerCase() === typed) || null;
  return preferredPerson(db, customer, "proposal");
}
