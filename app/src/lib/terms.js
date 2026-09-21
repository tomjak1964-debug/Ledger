// Payment terms — per customer and per vendor.
//
// Terms live on the contact (migration 019). A contact with no terms of its
// own falls back to the company default in Settings, so nothing changes for
// anyone you haven't set up. The early-payment term is a percentage and a
// window: 2% if paid within 10 days reads "2/10 Net 30".
import { addDays, todayISO } from "./helpers.js";
import { round2, lineTotals } from "../calc/ledger.js";

const num = v => (v === "" || v == null ? null : Number(v));

// Days this contact gets, or the company default.
export function termsDays(contact, settings) {
  const own = num(contact?.terms);
  return Number.isFinite(own) && own !== null ? own : Number(settings?.terms) || 0;
}

// The early-payment term, or null when there isn't one. Both halves have to
// be set — a percentage with no window can't be judged.
export function discountTerms(contact) {
  const pct = Number(contact?.discountPct) || 0;
  const days = Number(contact?.discountDays) || 0;
  return pct > 0 && days > 0 ? { pct, days } : null;
}

const trim = n => String(Number(n)).replace(/\.0+$/, "");
export function termsLabel(contact, settings) {
  const days = termsDays(contact, settings);
  const net = days === 0 ? "Due on receipt" : `Net ${days}`;
  const d = discountTerms(contact);
  return d ? `${trim(d.pct)}/${d.days} ${net}` : net;
}

/* ---- the same three, looked up by id against the whole db ---- */
const party = (db, id) => db.contacts.find(c => c.id === id);
export const termsForParty = (db, id) => termsDays(party(db, id), db.settings);
export const termsLabelFor = (db, id) => termsLabel(party(db, id), db.settings);

// The due date a document gets from its party's terms. Editing the document
// date moves it, which is the whole point of terms.
export const dueDateFor = (db, id, date) => (date ? addDays(date, termsForParty(db, id)) : "");

// What an early payment is worth on this document, or null if the party has
// no discount term. `expired` says the window has closed — the offer is still
// returned so the dialog can say why it isn't on the table.
//
// The discount is a percentage of the document total and is capped at what is
// still outstanding, so it can never settle more than the document owes.
export function discountOffer(db, doc, partyId, onDate, total) {
  const d = discountTerms(party(db, partyId));
  if (!d || !doc?.date) return null;
  const gross = total != null ? total : (doc.lineItems ? lineTotals(doc.lineItems, doc.taxRate).total : Number(doc.amount) || 0);
  const until = addDays(doc.date, d.days);
  const when = onDate || todayISO();
  return {
    ...d, until, expired: when > until,
    label: `${trim(d.pct)}% within ${d.days} days`,
    amount: round2(gross * d.pct / 100),
  };
}
