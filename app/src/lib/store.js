// The persistence seam (CLAUDE.md §3), Supabase edition.
//
// useLedger() loads every collection into one in-memory `db` object with the
// exact legacy shape, and exposes actions that write to Supabase first, then
// update local state on success. Business invariants (conversion chain,
// number claiming, copy-forward line items) live HERE, not in the views.
//
// Every action returns a truthy value on success and null/false on failure
// (after reporting the error via onError), so views can close editors only
// when the save actually landed.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient.js";
import * as A from "./adapters.js";
import { uid, todayISO, addDays, pad4 } from "./helpers.js";
import { defaultSettings, sampleData } from "./seed.js";
import { proposalConfig, phaseAmount } from "../calc/proposals.js";
import { round2 } from "../calc/ledger.js";

const SEQ_TYPES = ["quote", "so", "invoice", "bill"];

const groupBy = (rows, key) => {
  const m = {};
  rows.forEach(r => { (m[r[key]] ||= []).push(r); });
  return m;
};
const th = (res) => { if (res.error) throw res.error; return res.data; };

async function fetchAll() {
  const [settings, sequences, contacts, catalog, quotes, qli, sos, soli, invoices, invli, payments, bills, expenses,
    people, machineTypes, proposals, orgs, members] = await Promise.all([
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("org_sequences").select("*"),
    supabase.from("contacts").select("*").order("created_at"),
    supabase.from("catalog_items").select("*").order("created_at"),
    supabase.from("quotes").select("*").order("created_at"),
    supabase.from("quote_line_items").select("*").order("sort"),
    supabase.from("sales_orders").select("*").order("created_at"),
    supabase.from("sales_order_line_items").select("*").order("sort"),
    supabase.from("invoices").select("*").order("created_at"),
    supabase.from("invoice_line_items").select("*").order("sort"),
    supabase.from("payments").select("*").order("created_at"),
    supabase.from("bills").select("*").order("created_at"),
    supabase.from("expenses").select("*").order("created_at"),
    supabase.from("contact_people").select("*").order("created_at"),
    supabase.from("machine_types").select("*").order("sort").order("created_at"),
    supabase.from("proposals").select("*").order("created_at"),
    supabase.from("orgs").select("*"),
    supabase.from("org_members").select("*").order("created_at"),
  ]);
  return {
    settingsRow: th(settings), sequences: th(sequences),
    contacts: th(contacts), catalog: th(catalog),
    quotes: th(quotes), qli: th(qli), sos: th(sos), soli: th(soli),
    invoices: th(invoices), invli: th(invli), payments: th(payments),
    bills: th(bills), expenses: th(expenses),
    people: th(people), machineTypes: th(machineTypes), proposals: th(proposals),
    orgs: th(orgs), members: th(members),
  };
}

function assemble(raw) {
  const counters = { quote: 1, so: 1, invoice: 1, bill: 1 };
  raw.sequences.forEach(s => { counters[s.doc_type] = s.next_value; });
  const qItems = groupBy(raw.qli, "quote_id");
  const soItems = groupBy(raw.soli, "sales_order_id");
  const invItems = groupBy(raw.invli, "invoice_id");
  const pays = groupBy(raw.payments, "parent_id");
  const li = rows => (rows || []).map(A.lineItemFromRow);
  const pm = rows => (rows || []).map(A.paymentFromRow);
  return {
    settings: { ...defaultSettings(), ...(raw.settingsRow?.data || {}), counters },
    contacts: raw.contacts.map(A.contactFromRow),
    catalog: raw.catalog.map(A.catalogFromRow),
    quotes: raw.quotes.map(r => A.quoteFromRow(r, li(qItems[r.id]))),
    salesOrders: raw.sos.map(r => A.soFromRow(r, li(soItems[r.id]))),
    invoices: raw.invoices.map(r => A.invoiceFromRow(r, li(invItems[r.id]), pm(pays[r.id]))),
    bills: raw.bills.map(r => A.billFromRow(r, pm(pays[r.id]))),
    expenses: raw.expenses.map(A.expenseFromRow),
    contactPeople: raw.people.map(A.personFromRow),
    machineTypes: raw.machineTypes.map(A.machineTypeFromRow),
    proposals: raw.proposals.map(A.proposalFromRow),
    org: raw.orgs[0] ? { id: raw.orgs[0].id, name: raw.orgs[0].name, ownerId: raw.orgs[0].owner_id } : null,
    members: raw.members.map(m => ({ orgId: m.org_id, userId: m.user_id, email: m.email, role: m.role })),
  };
}

export function useLedger(session, onError) {
  const [db, setDbState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const dbRef = useRef(null);
  const setDb = useCallback((updater) => {
    setDbState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      dbRef.current = next;
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      // link email invites to this auth user, then ensure an org exists
      await supabase.rpc("claim_membership");
      th(await supabase.rpc("bootstrap_org", { p_name: "My Company" }));
      let raw = await fetchAll();
      if (!raw.settingsRow) { // first run for this org (upsert: StrictMode double-effects race here)
        th(await supabase.from("settings").upsert({ user_id: session.user.id, data: defaultSettings() }));
        raw = await fetchAll();
      }
      setDb(assemble(raw));
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }, [session.user.id, setDb]);

  useEffect(() => { reload(); }, [reload]);

  /* ------------ internals ------------ */

  const fail = (e) => { onError("⚠ " + (e?.message || "Something went wrong — change not saved")); return null; };

  // Claim the next number for a doc type atomically; bumps the local counter.
  async function claimNumber(docType) {
    const { data, error } = await supabase.rpc("next_doc_number", { p_doc_type: docType });
    if (error) throw error;
    if (SEQ_TYPES.includes(docType))
      setDb(d => ({ ...d, settings: { ...d.settings, counters: { ...d.settings.counters, [docType]: data + 1 } } }));
    return data;
  }

  async function replaceLineItems(table, parentKey, parentId, items) {
    th(await supabase.from(table).delete().eq(parentKey, parentId));
    const rows = A.lineItemsToRows(items, parentKey, parentId);
    if (rows.length) th(await supabase.from(table).insert(rows));
  }

  const upsertList = (list, item) =>
    list.some(x => x.id === item.id) ? list.map(x => x.id === item.id ? item : x) : [...list, item];

  /* ------------ actions ------------ */

  const actions = {
    reload,

    /* ---- quotes ---- */
    async saveQuote(q) {
      try {
        const isNew = !!q._new;
        const quote = { ...q }; delete quote._new;
        if (isNew) quote.number = dbRef.current.settings.quotePrefix + "-" + pad4(await claimNumber("quote"));
        th(await supabase.from("quotes").upsert(A.quoteToRow(quote)));
        await replaceLineItems("quote_line_items", "quote_id", quote.id, quote.lineItems);
        setDb(d => ({ ...d, quotes: upsertList(d.quotes, quote) }));
        return quote;
      } catch (e) { return fail(e); }
    },
    async setQuoteStatus(id, status) {
      try {
        th(await supabase.from("quotes").update({ status }).eq("id", id));
        setDb(d => ({ ...d, quotes: d.quotes.map(q => q.id === id ? { ...q, status } : q) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async deleteQuote(id) {
      try {
        th(await supabase.from("quotes").delete().eq("id", id)); // line items cascade
        setDb(d => ({ ...d, quotes: d.quotes.filter(q => q.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    // Quote → Sales Order: the "PO received" trigger. Copies line items
    // forward with fresh ids and stamps the quote accepted.
    async convertQuoteToSO(q, po) {
      try {
        const d0 = dbRef.current;
        const so = {
          id: uid(), number: d0.settings.soPrefix + "-" + pad4(await claimNumber("so")),
          quoteId: q.id, customerId: q.customerId, poNumber: po, date: todayISO(),
          status: "open", lineItems: q.lineItems.map(li => ({ ...li, id: uid() })), taxRate: q.taxRate,
        };
        th(await supabase.from("sales_orders").insert(A.soToRow(so)));
        await replaceLineItems("sales_order_line_items", "sales_order_id", so.id, so.lineItems);
        th(await supabase.from("quotes").update({ status: "accepted", sales_order_id: so.id, po_number: po }).eq("id", q.id));
        setDb(d => ({
          ...d,
          salesOrders: [...d.salesOrders, so],
          quotes: d.quotes.map(x => x.id === q.id ? { ...x, status: "accepted", salesOrderId: so.id, poNumber: po } : x),
        }));
        return so;
      } catch (e) { return fail(e); }
    },

    /* ---- sales orders ---- */
    // SO → Invoice: due date from terms, line items copy forward.
    async generateInvoice(so) {
      try {
        const d0 = dbRef.current;
        const inv = {
          id: uid(), number: d0.settings.invPrefix + "-" + pad4(await claimNumber("invoice")),
          salesOrderId: so.id, quoteId: so.quoteId, customerId: so.customerId, poNumber: so.poNumber,
          date: todayISO(), dueDate: addDays(todayISO(), d0.settings.terms),
          lineItems: so.lineItems.map(li => ({ ...li, id: uid() })), taxRate: so.taxRate, payments: [],
        };
        th(await supabase.from("invoices").insert(A.invoiceToRow(inv)));
        await replaceLineItems("invoice_line_items", "invoice_id", inv.id, inv.lineItems);
        th(await supabase.from("sales_orders").update({ status: "invoiced", invoice_id: inv.id }).eq("id", so.id));
        setDb(d => ({
          ...d,
          invoices: [...d.invoices, inv],
          salesOrders: d.salesOrders.map(x => x.id === so.id ? { ...x, status: "invoiced", invoiceId: inv.id } : x),
        }));
        return inv;
      } catch (e) { return fail(e); }
    },
    async deleteSO(id) {
      try {
        th(await supabase.from("sales_orders").delete().eq("id", id));
        setDb(d => ({ ...d, salesOrders: d.salesOrders.filter(s => s.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- invoices & payments ---- */
    // Standalone create or edit. Invoices born from an SO keep their chain
    // refs; standalone ones simply have none — same as legacy dangling-ref
    // semantics, every lookup tolerates it.
    async saveInvoice(i) {
      try {
        const isNew = !!i._new;
        const inv = { ...i }; delete inv._new;
        if (isNew) {
          inv.number = dbRef.current.settings.invPrefix + "-" + pad4(await claimNumber("invoice"));
          inv.payments = inv.payments || [];
        }
        th(await supabase.from("invoices").upsert(A.invoiceToRow(inv)));
        await replaceLineItems("invoice_line_items", "invoice_id", inv.id, inv.lineItems);
        setDb(d => ({ ...d, invoices: upsertList(d.invoices, inv) }));
        return inv;
      } catch (e) { return fail(e); }
    },
    async deleteInvoice(id) {
      try {
        th(await supabase.from("payments").delete().eq("parent_id", id));
        th(await supabase.from("invoices").delete().eq("id", id));
        setDb(d => ({ ...d, invoices: d.invoices.filter(i => i.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async recordPayment(parentType, parentId, p) {
      try {
        th(await supabase.from("payments").insert(A.paymentToRow(p, parentType, parentId)));
        setDb(d => parentType === "invoice"
          ? { ...d, invoices: d.invoices.map(i => i.id === parentId ? { ...i, payments: [...(i.payments || []), p] } : i) }
          : { ...d, bills: d.bills.map(b => b.id === parentId ? { ...b, payments: [...(b.payments || []), p] } : b) });
        return true;
      } catch (e) { return fail(e); }
    },

    async deletePayment(parentType, parentId, paymentId) {
      try {
        th(await supabase.from("payments").delete().eq("id", paymentId));
        const strip = doc => doc.id === parentId ? { ...doc, payments: (doc.payments || []).filter(p => p.id !== paymentId) } : doc;
        setDb(d => parentType === "invoice"
          ? { ...d, invoices: d.invoices.map(strip) }
          : { ...d, bills: d.bills.map(strip) });
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- bills ---- */
    async saveBill(b) {
      try {
        const isNew = !!b._new;
        const bill = { ...b, amount: Number(b.amount) || 0 }; delete bill._new;
        if (isNew) bill.number = dbRef.current.settings.billPrefix + "-" + pad4(await claimNumber("bill"));
        th(await supabase.from("bills").upsert(A.billToRow(bill)));
        setDb(d => ({ ...d, bills: upsertList(d.bills, bill) }));
        return bill;
      } catch (e) { return fail(e); }
    },
    async deleteBill(id) {
      try {
        th(await supabase.from("payments").delete().eq("parent_id", id));
        th(await supabase.from("bills").delete().eq("id", id));
        setDb(d => ({ ...d, bills: d.bills.filter(b => b.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- expenses ---- */
    async saveExpense(x) {
      try {
        const expense = { ...x, amount: Number(x.amount) || 0 }; delete expense._new;
        th(await supabase.from("expenses").upsert(A.expenseToRow(expense)));
        setDb(d => ({ ...d, expenses: upsertList(d.expenses, expense) }));
        return expense;
      } catch (e) { return fail(e); }
    },
    async deleteExpense(id) {
      try {
        th(await supabase.from("expenses").delete().eq("id", id));
        setDb(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- contacts & catalog ---- */
    async saveContact(c) {
      try {
        th(await supabase.from("contacts").upsert(A.contactToRow(c)));
        setDb(d => ({ ...d, contacts: upsertList(d.contacts, c) }));
        return c;
      } catch (e) { return fail(e); }
    },
    async deleteContact(id) {
      try {
        th(await supabase.from("contacts").delete().eq("id", id));
        setDb(d => ({ ...d, contacts: d.contacts.filter(c => c.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async saveCatalogItem(c) {
      try {
        const item = { ...c, unitPrice: Number(c.unitPrice) || 0 };
        th(await supabase.from("catalog_items").upsert(A.catalogToRow(item)));
        setDb(d => ({ ...d, catalog: upsertList(d.catalog, item) }));
        return item;
      } catch (e) { return fail(e); }
    },
    async deleteCatalogItem(id) {
      try {
        th(await supabase.from("catalog_items").delete().eq("id", id));
        setDb(d => ({ ...d, catalog: d.catalog.filter(c => c.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- settings & data management ---- */
    async saveSettings(s) {
      try {
        const { counters, ...data } = s; // counters live in org_sequences, not jsonb
        th(await supabase.from("settings").upsert({ org_id: dbRef.current.org.id, data }, { onConflict: "org_id" }));
        setDb(d => ({ ...d, settings: { ...data, counters: d.settings.counters } }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- team ---- */
    async inviteMember(email) {
      try {
        th(await supabase.from("org_members").insert({ org_id: dbRef.current.org.id, email: email.trim().toLowerCase() }));
        await reload();
        return true;
      } catch (e) { return fail(e); }
    },
    async removeMember(email) {
      try {
        th(await supabase.from("org_members").delete().eq("org_id", dbRef.current.org.id).eq("email", email));
        setDb(d => ({ ...d, members: d.members.filter(m => m.email !== email) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- machine rates & contact people ---- */
    async saveMachineType(m) {
      try {
        const mt = { ...m }; delete mt._new;
        th(await supabase.from("machine_types").upsert(A.machineTypeToRow(mt)));
        setDb(d => ({ ...d, machineTypes: upsertList(d.machineTypes, mt) }));
        return mt;
      } catch (e) { return fail(e); }
    },
    async deleteMachineType(id) {
      try {
        th(await supabase.from("machine_types").delete().eq("id", id));
        setDb(d => ({ ...d, machineTypes: d.machineTypes.filter(m => m.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async seedMachineRates(rates) {
      try {
        const rows = rates.map((r, i) => ({ ...r, id: uid(), sort: i }));
        th(await supabase.from("machine_types").insert(rows.map(A.machineTypeToRow)));
        setDb(d => ({ ...d, machineTypes: [...d.machineTypes, ...rows] }));
        return true;
      } catch (e) { return fail(e); }
    },
    async saveContactPerson(p) {
      try {
        th(await supabase.from("contact_people").upsert(A.personToRow(p)));
        setDb(d => ({ ...d, contactPeople: upsertList(d.contactPeople, p) }));
        return p;
      } catch (e) { return fail(e); }
    },
    async deleteContactPerson(id) {
      try {
        th(await supabase.from("contact_people").delete().eq("id", id));
        setDb(d => ({ ...d, contactPeople: d.contactPeople.filter(p => p.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- proposals ---- */
    async saveProposal(p) {
      try {
        const isNew = !!p._new;
        const prop = { ...p }; delete prop._new;
        if (isNew) {
          const cfg = proposalConfig(dbRef.current.settings);
          const ymd = (prop.date || todayISO()).slice(2).replace(/-/g, "");
          const n = await claimNumber("prop:" + ymd);
          prop.number = `${cfg.propPrefix}${ymd}-${String(n).padStart(2, "0")}`;
        }
        th(await supabase.from("proposals").upsert(A.proposalToRow(prop)));
        setDb(d => ({ ...d, proposals: upsertList(d.proposals, prop) }));
        return prop;
      } catch (e) { return fail(e); }
    },
    async setProposalStatus(id, status) {
      try {
        th(await supabase.from("proposals").update({ status }).eq("id", id));
        setDb(d => ({ ...d, proposals: d.proposals.map(p => p.id === id ? { ...p, status } : p) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async deleteProposal(id) {
      try {
        th(await supabase.from("proposals").delete().eq("id", id));
        setDb(d => ({ ...d, proposals: d.proposals.filter(p => p.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    // Customer sent a PO — proposal becomes a sales order (the existing chain).
    async winProposal(p, po) {
      try {
        const d0 = dbRef.current;
        const so = {
          id: uid(), number: d0.settings.soPrefix + "-" + pad4(await claimNumber("so")),
          quoteId: "", customerId: p.customerId, poNumber: po, date: todayISO(), status: "open",
          taxRate: 0, lineItems: [{
            id: uid(), desc: `Turnkey Controls — ${p.description} (${p.number})`,
            qty: 1, unit: "lot", unitPrice: Number(p.pricing?.total) || 0,
          }],
        };
        th(await supabase.from("sales_orders").insert(A.soToRow(so)));
        await replaceLineItems("sales_order_line_items", "sales_order_id", so.id, so.lineItems);
        th(await supabase.from("proposals").update({ status: "won", po_number: po, sales_order_id: so.id }).eq("id", p.id));
        setDb(d => ({
          ...d,
          salesOrders: [...d.salesOrders, so],
          proposals: d.proposals.map(x => x.id === p.id ? { ...x, status: "won", poNumber: po, salesOrderId: so.id } : x),
        }));
        return so;
      } catch (e) { return fail(e); }
    },
    // Bill one or more phases of a won proposal on a single invoice.
    async invoiceProposalPhases(p, phaseKeys) {
      try {
        const d0 = dbRef.current;
        const total = Number(p.pricing?.total) || 0;
        const sel = (p.phases || []).filter(ph => phaseKeys.includes(ph.key) && !ph.invoiceId);
        if (!sel.length) throw new Error("No un-billed phases selected");
        const inv = {
          id: uid(), number: d0.settings.invPrefix + "-" + pad4(await claimNumber("invoice")),
          salesOrderId: p.salesOrderId || "", quoteId: "", customerId: p.customerId,
          contactPersonId: p.contactPersonId || "", proposalId: p.id, poNumber: p.poNumber,
          date: todayISO(), dueDate: addDays(todayISO(), d0.settings.terms),
          taxRate: 0, notes: "", payments: [],
          // Billed phases carry qty 1 + amount; remaining unbilled phases print
          // as qty-0 reference lines (Sage-style, per the Invoice Example PDF)
          // so the customer sees the whole schedule. qty 0 = no charge.
          lineItems: [
            ...sel.map(ph => ({
              id: uid(), desc: `${p.jobNumber || p.number} — ${ph.label}`,
              qty: 1, unit: "", unitPrice: phaseAmount(total, ph.pct),
            })),
            ...(p.phases || []).filter(ph => !ph.invoiceId && !phaseKeys.includes(ph.key)).map(ph => ({
              id: uid(), desc: `${p.jobNumber || p.number} — ${ph.label}`,
              qty: 0, unit: "", unitPrice: phaseAmount(total, ph.pct),
            })),
          ],
        };
        th(await supabase.from("invoices").insert(A.invoiceToRow(inv)));
        await replaceLineItems("invoice_line_items", "invoice_id", inv.id, inv.lineItems);
        const phases = (p.phases || []).map(ph => sel.some(s => s.key === ph.key) ? { ...ph, invoiceId: inv.id } : ph);
        th(await supabase.from("proposals").update({ phases }).eq("id", p.id));
        const allBilled = phases.every(ph => ph.invoiceId);
        if (allBilled && p.salesOrderId)
          th(await supabase.from("sales_orders").update({ status: "invoiced", invoice_id: inv.id }).eq("id", p.salesOrderId));
        setDb(d => ({
          ...d,
          invoices: [...d.invoices, inv],
          proposals: d.proposals.map(x => x.id === p.id ? { ...x, phases } : x),
          salesOrders: allBilled && p.salesOrderId
            ? d.salesOrders.map(s => s.id === p.salesOrderId ? { ...s, status: "invoiced", invoiceId: inv.id } : s)
            : d.salesOrders,
        }));
        return inv;
      } catch (e) { return fail(e); }
    },

    // Wipe all business data. Keeps settings, team, and machine rates; resets counters.
    async clearAllData() {
      try {
        await wipe(dbRef.current.org.id);
        await reload();
        return true;
      } catch (e) { return fail(e); }
    },

    // Replace everything with the legacy sample dataset.
    async loadSampleData() {
      try {
        const orgId = dbRef.current.org.id;
        await wipe(orgId);
        const sample = sampleData();
        th(await supabase.from("settings").upsert({ org_id: orgId, data: sample.settings }, { onConflict: "org_id" }));
        th(await supabase.from("contacts").insert(sample.contacts.map(A.contactToRow)));
        th(await supabase.from("catalog_items").insert(sample.catalog.map(A.catalogToRow)));
        await reload();
        return true;
      } catch (e) { return fail(e); }
    },

    // Import a legacy JSON backup (Settings → Export Backup in ledger.html).
    // Replaces ALL current data. Old random-slug ids are remapped to fresh
    // uuids with every cross-reference (customer, quote→SO→invoice chain)
    // preserved — including dangling refs, which stay dangling like before.
    async importBackup(data) {
      try {
        if (!data || typeof data !== "object" || !data.settings || !Array.isArray(data.contacts))
          throw new Error("That file doesn't look like a Ledger backup (missing settings/contacts).");
        const arr = k => Array.isArray(data[k]) ? data[k] : [];
        const map = new Map();
        const nid = old => { if (!old) return ""; if (!map.has(old)) map.set(old, uid()); return map.get(old); };
        const remapItems = items => (items || []).map(it => ({ ...it, id: uid() }));

        const contacts = arr("contacts").map(c => ({ ...c, id: nid(c.id) }));
        const catalog = arr("catalog").map(c => ({ ...c, id: nid(c.id) }));
        const quotes = arr("quotes").map(q => ({ ...q, id: nid(q.id), customerId: nid(q.customerId), salesOrderId: q.salesOrderId ? nid(q.salesOrderId) : undefined, lineItems: remapItems(q.lineItems) }));
        const sos = arr("salesOrders").map(s => ({ ...s, id: nid(s.id), quoteId: nid(s.quoteId), customerId: nid(s.customerId), invoiceId: s.invoiceId ? nid(s.invoiceId) : undefined, lineItems: remapItems(s.lineItems) }));
        const invoices = arr("invoices").map(i => ({ ...i, id: nid(i.id), salesOrderId: nid(i.salesOrderId), quoteId: nid(i.quoteId), customerId: nid(i.customerId), lineItems: remapItems(i.lineItems), payments: (i.payments || []).map(p => ({ ...p, id: uid() })) }));
        const bills = arr("bills").map(b => ({ ...b, id: nid(b.id), vendorId: nid(b.vendorId), payments: (b.payments || []).map(p => ({ ...p, id: uid() })) }));
        const expenses = arr("expenses").map(e => ({ ...e, id: uid() }));

        const orgId = dbRef.current.org.id;
        await wipe(orgId);

        const ins = async (table, rows) => { if (rows.length) th(await supabase.from(table).insert(rows)); };
        await ins("contacts", contacts.map(A.contactToRow));
        await ins("catalog_items", catalog.map(A.catalogToRow));
        await ins("quotes", quotes.map(A.quoteToRow));
        await ins("sales_orders", sos.map(A.soToRow));
        await ins("invoices", invoices.map(A.invoiceToRow));
        await ins("quote_line_items", quotes.flatMap(q => A.lineItemsToRows(q.lineItems, "quote_id", q.id)));
        await ins("sales_order_line_items", sos.flatMap(s => A.lineItemsToRows(s.lineItems, "sales_order_id", s.id)));
        await ins("invoice_line_items", invoices.flatMap(i => A.lineItemsToRows(i.lineItems, "invoice_id", i.id)));
        await ins("payments", [
          ...invoices.flatMap(i => i.payments.map(p => A.paymentToRow(p, "invoice", i.id))),
          ...bills.flatMap(b => b.payments.map(p => A.paymentToRow(p, "bill", b.id))),
        ]);
        await ins("bills", bills.map(A.billToRow));
        await ins("expenses", expenses.map(A.expenseToRow));

        const { counters, ...settingsData } = { ...defaultSettings(), ...data.settings };
        th(await supabase.from("settings").upsert({ org_id: orgId, data: settingsData }, { onConflict: "org_id" }));
        th(await supabase.from("org_sequences").upsert(SEQ_TYPES.map(t => ({
          org_id: orgId, doc_type: t, next_value: Math.max(1, Number(counters?.[t]) || 1),
        }))));

        await reload();
        return true;
      } catch (e) { return fail(e); }
    },
  };

  return { db, loading, loadError, actions };
}

// Delete every business row for this org. Settings, team, and machine rates
// are left in place; counters reset by deletion (next claim starts back at 1).
async function wipe(orgId) {
  // Children first (payments have no FK; line items cascade from parents).
  for (const table of ["payments", "quote_line_items", "sales_order_line_items", "invoice_line_items",
    "quotes", "sales_orders", "invoices", "proposals", "contact_people", "bills", "expenses",
    "contacts", "catalog_items", "org_sequences"]) {
    const { error } = await supabase.from(table).delete().eq("org_id", orgId);
    if (error) throw error;
  }
}
