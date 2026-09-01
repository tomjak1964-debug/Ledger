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
import { round2, lineTotals } from "../calc/ledger.js";
import { checkNumberTaken, isCheckPayment, normRef } from "./checks.js";

const SEQ_TYPES = ["quote", "so", "invoice", "bill"];
// Placeholder shown in the invoice-number field; means "use the auto sequence".
// Any user-typed override that isn't blank and doesn't start with "(" is manual.
export const AUTO_NUMBER = "(auto)";
const isAutoNumber = (n) => { const s = (n || "").trim(); return !s || s.startsWith("("); };

const groupBy = (rows, key) => {
  const m = {};
  rows.forEach(r => { (m[r[key]] ||= []).push(r); });
  return m;
};
const th = (res) => { if (res.error) throw res.error; return res.data; };

async function fetchAll() {
  const [settings, sequences, contacts, catalog, quotes, qli, sos, soli, invoices, invli, payments, bills, expenses,
    people, machineTypes, proposals, orgs, members, audit, tasks, timeCats, timeEntries, attachments, pos, poli] = await Promise.all([
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
    supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("time_categories").select("*").order("sort").order("created_at"),
    supabase.from("time_entries").select("*").order("date", { ascending: false }),
    supabase.from("attachments").select("*").order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select("*").order("created_at"),
    supabase.from("purchase_order_line_items").select("*").order("sort"),
  ]);
  return {
    settingsRow: th(settings), sequences: th(sequences),
    contacts: th(contacts), catalog: th(catalog),
    quotes: th(quotes), qli: th(qli), sos: th(sos), soli: th(soli),
    invoices: th(invoices), invli: th(invli), payments: th(payments),
    bills: th(bills), expenses: th(expenses),
    people: th(people), machineTypes: th(machineTypes), proposals: th(proposals),
    orgs: th(orgs), members: th(members),
    // Tolerant: if a later migration (006 audit_log / 008 jobs+time) hasn't been
    // applied yet, don't block the whole app from loading — show empty sets.
    audit: audit && !audit.error ? (audit.data || []) : [],
    tasks: tasks && !tasks.error ? (tasks.data || []) : [],
    timeCats: timeCats && !timeCats.error ? (timeCats.data || []) : [],
    timeEntries: timeEntries && !timeEntries.error ? (timeEntries.data || []) : [],
    attachments: attachments && !attachments.error ? (attachments.data || []) : [],
    pos: pos && !pos.error ? (pos.data || []) : [],
    poli: poli && !poli.error ? (poli.data || []) : [],
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
  const soLi = rows => (rows || []).map(A.soLineItemFromRow);
  const pm = rows => (rows || []).map(A.paymentFromRow);
  return {
    settings: { ...defaultSettings(), ...(raw.settingsRow?.data || {}), counters },
    contacts: raw.contacts.map(A.contactFromRow),
    catalog: raw.catalog.map(A.catalogFromRow),
    quotes: raw.quotes.map(r => A.quoteFromRow(r, li(qItems[r.id]))),
    salesOrders: raw.sos.map(r => A.soFromRow(r, soLi(soItems[r.id]))),
    invoices: raw.invoices.map(r => A.invoiceFromRow(r, li(invItems[r.id]), pm(pays[r.id]))),
    bills: raw.bills.map(r => A.billFromRow(r, pm(pays[r.id]))),
    expenses: raw.expenses.map(A.expenseFromRow),
    contactPeople: raw.people.map(A.personFromRow),
    machineTypes: raw.machineTypes.map(A.machineTypeFromRow),
    proposals: raw.proposals.map(A.proposalFromRow),
    org: raw.orgs[0] ? { id: raw.orgs[0].id, name: raw.orgs[0].name, ownerId: raw.orgs[0].owner_id } : null,
    members: raw.members.map(m => ({ orgId: m.org_id, userId: m.user_id, email: m.email, role: m.role, permissions: m.permissions || {} })),
    auditLog: (raw.audit || []).map(A.auditFromRow),
    tasks: (raw.tasks || []).map(A.taskFromRow),
    timeCategories: (raw.timeCats || []).map(A.timeCategoryFromRow),
    timeEntries: (raw.timeEntries || []).map(A.timeEntryFromRow),
    attachments: (raw.attachments || []).map(A.attachmentFromRow),
    purchaseOrders: (() => { const items = groupBy(raw.poli || [], "purchase_order_id"); return (raw.pos || []).map(r => A.poFromRow(r, li(items[r.id]))); })(),
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
      // Ensure jobs with ready, un-invoiced lines have an open invoice task —
      // covers 'ready' set outside the app (e.g. a bulk data import).
      for (const so of (dbRef.current?.salesOrders || [])) {
        const hasReady = (so.lineItems || []).some(li => li.ready && !li.invoiced);
        const hasTask = (dbRef.current?.tasks || []).some(t => t.salesOrderId === so.id && t.type === "create_invoice" && t.status === "open");
        if (hasReady && !hasTask) await reconcileJobTask(so.id);
      }
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }, [session.user.id, setDb]);

  useEffect(() => { reload(); }, [reload]);

  /* ------------ internals ------------ */

  const fail = (e) => { onError("⚠ " + (e?.message || "Something went wrong — change not saved")); return null; };

  // No two checks may carry the same number. A number only frees up when the
  // check that used it is voided (its payments deleted). `allowIds` are the
  // payment rows that belong to the check being written.
  const guardCheckNumber = (parentType, p, allowIds = []) => {
    if (parentType !== "bill" || !isCheckPayment(p)) return;
    if (checkNumberTaken(dbRef.current, p.ref, allowIds))
      throw new Error(`Check #${normRef(p.ref)} has already been used. Void that check first, or use a different number.`);
  };

  // Claim the next number for a doc type atomically; bumps the local counter.
  async function claimNumber(docType) {
    const { data, error } = await supabase.rpc("next_doc_number", { p_doc_type: docType });
    if (error) throw error;
    if (SEQ_TYPES.includes(docType))
      setDb(d => ({ ...d, settings: { ...d.settings, counters: { ...d.settings.counters, [docType]: data + 1 } } }));
    return data;
  }

  // Invoice numbers: customer code + yymmdd + per-day 2-digit index
  // (VG260728-01), claimed atomically per customer+day. Falls back to the
  // Settings invoice prefix when the customer has no code.
  async function claimInvoiceNumber(customerId, date) {
    const d0 = dbRef.current;
    const c = d0.contacts.find(x => x.id === customerId);
    const prefix = String(c?.code || d0.settings.invPrefix || "INV").toUpperCase().replace(/\s+/g, "");
    const ymd = (date || todayISO()).slice(2).replace(/-/g, "");
    const n = await claimNumber(`inv:${prefix}:${ymd}`);
    return `${prefix}${ymd}-${String(n).padStart(2, "0")}`;
  }

  async function replaceLineItems(table, parentKey, parentId, items, toRows) {
    th(await supabase.from(table).delete().eq(parentKey, parentId));
    const rows = toRows ? toRows(items, parentId) : A.lineItemsToRows(items, parentKey, parentId);
    if (rows.length) th(await supabase.from(table).insert(rows));
  }

  // Record a deletion in the audit log (best-effort — never blocks the delete).
  // Stamped with the signed-in user's email so "who deleted this" is answerable.
  async function logDeletion(entityType, number, detail = "") {
    try {
      const row = { user_email: session.user.email || "", action: "delete", entity_type: entityType, entity_number: number || "", detail };
      const { data } = await supabase.from("audit_log").insert(row).select().maybeSingle();
      if (data) setDb(d => ({ ...d, auditLog: [A.auditFromRow(data), ...(d.auditLog || [])] }));
    } catch { /* auditing must not break the primary action */ }
  }

  // Keep a job's "create invoice" task in sync with its line readiness: open a
  // task when the SO has un-invoiced ready lines, close it when none remain.
  async function reconcileJobTask(soId) {
    const d0 = dbRef.current;
    const so = d0.salesOrders.find(s => s.id === soId);
    if (!so) return;
    const hasReady = (so.lineItems || []).some(li => li.ready && !li.invoiced);
    const openTask = (d0.tasks || []).find(t => t.salesOrderId === soId && t.type === "create_invoice" && t.status === "open");
    if (hasReady && !openTask) {
      const cust = d0.contacts.find(c => c.id === so.customerId)?.name || "";
      const task = { id: uid(), type: "create_invoice", status: "open", salesOrderId: soId, title: `Invoice ready items — ${so.number}`, detail: cust, createdBy: session.user.email };
      const { data } = await supabase.from("tasks").insert(A.taskToRow(task)).select().maybeSingle();
      setDb(d => ({ ...d, tasks: [data ? A.taskFromRow(data) : { ...task, createdAt: "" }, ...(d.tasks || [])] }));
    } else if (!hasReady && openTask) {
      th(await supabase.from("tasks").update({ status: "done", done_by: session.user.email }).eq("id", openTask.id));
      setDb(d => ({ ...d, tasks: d.tasks.map(t => t.id === openTask.id ? { ...t, status: "done", doneBy: session.user.email } : t) }));
    }
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
        const q = dbRef.current.quotes.find(x => x.id === id);
        th(await supabase.from("quotes").delete().eq("id", id)); // line items cascade
        setDb(d => ({ ...d, quotes: d.quotes.filter(q => q.id !== id) }));
        await logDeletion("quote", q?.number || "");
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
        await replaceLineItems("sales_order_line_items", "sales_order_id", so.id, so.lineItems, A.soLineItemsToRows);
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
    // SO → Invoice. Bills the selected lines (or every un-invoiced line when no
    // selection is given). The SO only flips to 'invoiced' once every line has
    // been billed; otherwise it stays 'open' with the remaining lines. Supports
    // a per-invoice number override (opts.number) and invoice date (opts.date).
    async generateInvoice(so, selectedLineIds = null, opts = {}) {
      try {
        const d0 = dbRef.current;
        const toBill = (so.lineItems || []).filter(li => selectedLineIds ? selectedLineIds.includes(li.id) : !li.invoiced);
        // Optional: bill logged time as T&M lines (unbilled entries for this job).
        const timeIds = opts.timeEntryIds || [];
        const timeToBill = (d0.timeEntries || []).filter(te => timeIds.includes(te.id) && !te.invoiceId);
        // Optional: extra lines typed on the invoice itself — freight, a change
        // order, a one-off part. They belong to the invoice only, so nothing on
        // the sales order is marked billed for them.
        const extras = (opts.extraLines || [])
          .filter(li => String(li.desc || "").trim() || Number(li.qty) || Number(li.unitPrice))
          .map(li => ({ id: uid(), desc: String(li.desc || "").trim(), qty: Number(li.qty) || 0, unit: li.unit || "", unitPrice: Number(li.unitPrice) || 0 }));
        if (!toBill.length && !timeToBill.length && !extras.length)
          throw new Error("Select at least one line item, time entry, or added line to invoice.");
        const date = opts.date || todayISO();
        let number;
        const manual = (opts.number || "").trim();
        if (!isAutoNumber(manual)) {
          if (d0.invoices.some(i => (i.number || "").toLowerCase() === manual.toLowerCase()))
            throw new Error(`Invoice number "${manual}" is already used.`);
          number = manual;
        } else {
          number = await claimInvoiceNumber(so.customerId, date);
        }
        const catName = id => (d0.timeCategories || []).find(c => c.id === id)?.name || "Labor";
        const timeLines = timeToBill.map(te => ({
          id: uid(), desc: `${catName(te.categoryId)}${te.description ? " — " + te.description : ""}${te.date ? " (" + te.date + ")" : ""}`,
          qty: te.hours, unit: "hr", unitPrice: te.rate,
        }));
        const inv = {
          id: uid(), number,
          salesOrderId: so.id, quoteId: so.quoteId, customerId: so.customerId, poNumber: so.poNumber,
          date, dueDate: addDays(date, d0.settings.terms),
          lineItems: [
            ...toBill.map(li => ({ id: uid(), desc: li.desc, qty: li.qty, unit: li.unit, unitPrice: li.unitPrice })),
            ...timeLines,
            ...extras,
          ],
          taxRate: so.taxRate, payments: [],
        };
        th(await supabase.from("invoices").insert(A.invoiceToRow(inv)));
        await replaceLineItems("invoice_line_items", "invoice_id", inv.id, inv.lineItems);
        const billedIds = toBill.map(li => li.id);
        if (billedIds.length)
          th(await supabase.from("sales_order_line_items").update({ invoiced: true, invoice_id: inv.id }).in("id", billedIds));
        const timeBilledIds = timeToBill.map(te => te.id);
        if (timeBilledIds.length)
          th(await supabase.from("time_entries").update({ invoice_id: inv.id }).in("id", timeBilledIds));
        const fullyBilled = (so.lineItems || []).length > 0 && (so.lineItems || []).every(li => li.invoiced || li.closed || billedIds.includes(li.id));
        if (fullyBilled)
          th(await supabase.from("sales_orders").update({ status: "invoiced", invoice_id: inv.id }).eq("id", so.id));
        setDb(d => ({
          ...d,
          invoices: [...d.invoices, inv],
          timeEntries: d.timeEntries.map(te => timeBilledIds.includes(te.id) ? { ...te, invoiceId: inv.id } : te),
          salesOrders: d.salesOrders.map(x => x.id === so.id ? {
            ...x,
            status: fullyBilled ? "invoiced" : "open",
            ...(fullyBilled ? { invoiceId: inv.id } : {}),
            lineItems: (x.lineItems || []).map(li => billedIds.includes(li.id) ? { ...li, invoiced: true, invoiceId: inv.id } : li),
          } : x),
        }));
        await reconcileJobTask(so.id);
        return inv;
      } catch (e) { return fail(e); }
    },
    // Undo the closing of an SO whose invoice was deleted — reopen it and clear
    // every line's invoiced flag so it can be billed again. Fixes SOs left
    // 'invoiced' by a delete that predated the cascade (e.g. TMJ892).
    async reopenSO(id) {
      try {
        th(await supabase.from("sales_orders").update({ status: "open", invoice_id: null }).eq("id", id));
        th(await supabase.from("sales_order_line_items").update({ invoiced: false, invoice_id: null }).eq("sales_order_id", id));
        setDb(d => ({ ...d, salesOrders: d.salesOrders.map(s => s.id === id
          ? { ...s, status: "open", invoiceId: "", lineItems: (s.lineItems || []).map(li => ({ ...li, invoiced: false, invoiceId: "" })) }
          : s) }));
        return true;
      } catch (e) { return fail(e); }
    },
    // Standalone create or edit of a sales order (not from a quote/proposal).
    // New ones claim the next SO number; line items copy through the SO adapter
    // so the invoiced/ready flags round-trip.
    async saveSalesOrder(s) {
      try {
        const isNew = !!s._new;
        const so = { ...s }; delete so._new;
        const manual = (so.number || "").trim();
        const dupe = num => dbRef.current.salesOrders.some(x => x.id !== so.id && (x.number || "").toLowerCase() === num.toLowerCase());
        if (isNew && isAutoNumber(manual)) {
          so.number = dbRef.current.settings.soPrefix + "-" + pad4(await claimNumber("so"));
        } else {
          // Manual number (override or edit): must not collide with another SO.
          if (dupe(manual)) throw new Error(`Sales order number "${manual}" is already used.`);
          so.number = manual;
        }
        th(await supabase.from("sales_orders").upsert(A.soToRow(so)));
        await replaceLineItems("sales_order_line_items", "sales_order_id", so.id, so.lineItems, A.soLineItemsToRows);
        setDb(d => ({ ...d, salesOrders: upsertList(d.salesOrders, so) }));
        return so;
      } catch (e) { return fail(e); }
    },
    async deleteSO(id) {
      try {
        const so = dbRef.current.salesOrders.find(s => s.id === id);
        th(await supabase.from("sales_orders").delete().eq("id", id));
        setDb(d => ({ ...d, salesOrders: d.salesOrders.filter(s => s.id !== id) }));
        await logDeletion("sales_order", so?.number || "");
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- job progress + tasks ---- */
    // Mark an SO line item complete/ready (or not), then reconcile the job's
    // invoice task.
    async setLineReady(soId, lineId, ready) {
      try {
        th(await supabase.from("sales_order_line_items").update({ ready }).eq("id", lineId));
        setDb(d => ({ ...d, salesOrders: d.salesOrders.map(s => s.id === soId
          ? { ...s, lineItems: (s.lineItems || []).map(li => li.id === lineId ? { ...li, ready } : li) } : s) }));
        await reconcileJobTask(soId);
        return true;
      } catch (e) { return fail(e); }
    },
    // Close an SO line you won't bill (cancelled scope). It clears from "to
    // invoice"; the SO reads complete once every line is invoiced or closed.
    async setLineClosed(soId, lineId, closed) {
      try {
        const patch = closed ? { closed: true, ready: false } : { closed: false };
        th(await supabase.from("sales_order_line_items").update(patch).eq("id", lineId));
        setDb(d => ({ ...d, salesOrders: d.salesOrders.map(s => s.id === soId
          ? { ...s, lineItems: (s.lineItems || []).map(li => li.id === lineId ? { ...li, ...patch } : li) } : s) }));
        const so = dbRef.current.salesOrders.find(s => s.id === soId);
        const lines = so?.lineItems || [];
        const newStatus = (lines.length > 0 && lines.every(li => li.invoiced || li.closed)) ? "invoiced" : "open";
        if (so && so.status !== newStatus) {
          th(await supabase.from("sales_orders").update({ status: newStatus }).eq("id", soId));
          setDb(d => ({ ...d, salesOrders: d.salesOrders.map(s => s.id === soId ? { ...s, status: newStatus } : s) }));
        }
        await reconcileJobTask(soId);
        return true;
      } catch (e) { return fail(e); }
    },
    async markInvoicePrinted(id) {
      try {
        th(await supabase.from("invoices").update({ printed: true }).eq("id", id));
        setDb(d => ({ ...d, invoices: d.invoices.map(i => i.id === id ? { ...i, printed: true } : i) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async setTaskStatus(taskId, status) {
      try {
        th(await supabase.from("tasks").update({ status, done_by: session.user.email }).eq("id", taskId));
        setDb(d => ({ ...d, tasks: d.tasks.map(t => t.id === taskId ? { ...t, status, doneBy: session.user.email } : t) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- time tracking ---- */
    async saveTimeCategory(c) {
      try {
        const cat = { ...c, rate: Number(c.rate) || 0 }; delete cat._new;
        th(await supabase.from("time_categories").upsert(A.timeCategoryToRow(cat)));
        setDb(d => ({ ...d, timeCategories: upsertList(d.timeCategories, cat) }));
        return cat;
      } catch (e) { return fail(e); }
    },
    async deleteTimeCategory(id) {
      try {
        th(await supabase.from("time_categories").delete().eq("id", id));
        setDb(d => ({ ...d, timeCategories: d.timeCategories.filter(c => c.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    // Save one instance of time — one or more line items at once.
    async saveTimeEntries(entries) {
      try {
        const rows = entries.map(e => ({ ...e, id: e.id || uid(), userEmail: e.userEmail || session.user.email, invoiceId: "" }));
        if (!rows.length) throw new Error("Add at least one time line.");
        th(await supabase.from("time_entries").insert(rows.map(A.timeEntryToRow)));
        setDb(d => ({ ...d, timeEntries: [...rows, ...d.timeEntries] }));
        return true;
      } catch (e) { return fail(e); }
    },
    async deleteTimeEntry(id) {
      try {
        th(await supabase.from("time_entries").delete().eq("id", id));
        setDb(d => ({ ...d, timeEntries: d.timeEntries.filter(e => e.id !== id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    // Approve (or un-approve) logged time. Only approved time can be billed.
    async setTimeApproval(id, approved) {
      try {
        const by = approved ? session.user.email : "";
        th(await supabase.from("time_entries").update({ approved, approved_by: by }).eq("id", id));
        setDb(d => ({ ...d, timeEntries: d.timeEntries.map(e => e.id === id ? { ...e, approved, approvedBy: by } : e) }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- attachments (files in Storage + metadata row) ---- */
    async uploadAttachment(parentType, parentId, file) {
      try {
        const orgId = dbRef.current.org.id;
        const safe = (file.name || "file").replace(/[^\w.\-]+/g, "_");
        const path = `${orgId}/${parentType}/${parentId}/${uid()}__${safe}`;
        const up = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (up.error) throw up.error;
        const att = { id: uid(), parentType, parentId, path, filename: file.name || safe, size: file.size || 0, contentType: file.type || "", uploadedBy: session.user.email };
        th(await supabase.from("attachments").insert({ id: att.id, org_id: orgId, parent_type: parentType, parent_id: parentId, path, filename: att.filename, size: att.size, content_type: att.contentType, uploaded_by: att.uploadedBy }));
        setDb(d => ({ ...d, attachments: [att, ...(d.attachments || [])] }));
        return att;
      } catch (e) { return fail(e); }
    },
    async deleteAttachment(att) {
      try {
        await supabase.storage.from("attachments").remove([att.path]);
        th(await supabase.from("attachments").delete().eq("id", att.id));
        setDb(d => ({ ...d, attachments: (d.attachments || []).filter(a => a.id !== att.id) }));
        return true;
      } catch (e) { return fail(e); }
    },
    // Short-lived signed URL to view/download a private file.
    async attachmentUrl(att) {
      try {
        const { data, error } = await supabase.storage.from("attachments").createSignedUrl(att.path, 3600);
        if (error) throw error;
        return data.signedUrl;
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
          const manual = (inv.number || "").trim();
          if (!isAutoNumber(manual)) {
            if (dbRef.current.invoices.some(x => (x.number || "").toLowerCase() === manual.toLowerCase()))
              throw new Error(`Invoice number "${manual}" is already used.`);
            inv.number = manual;
          } else {
            inv.number = await claimInvoiceNumber(inv.customerId, inv.date);
          }
          inv.payments = inv.payments || [];
        }
        th(await supabase.from("invoices").upsert(A.invoiceToRow(inv)));
        await replaceLineItems("invoice_line_items", "invoice_id", inv.id, inv.lineItems);
        setDb(d => ({ ...d, invoices: upsertList(d.invoices, inv) }));
        return inv;
      } catch (e) { return fail(e); }
    },
    // Delete an invoice and undo its side effects: reopen any SO it closed,
    // clear the invoiced flag on the SO lines it billed, drop any proposal
    // phase that pointed at it, and log the deletion.
    async deleteInvoice(id) {
      try {
        const d0 = dbRef.current;
        const inv = d0.invoices.find(i => i.id === id);
        const cust = d0.contacts.find(c => c.id === inv?.customerId)?.name || "";
        th(await supabase.from("sales_order_line_items").update({ invoiced: false, invoice_id: null }).eq("invoice_id", id));
        th(await supabase.from("time_entries").update({ invoice_id: null }).eq("invoice_id", id));
        const touchedSO = s => s.invoiceId === id || (s.lineItems || []).some(li => li.invoiceId === id);
        for (const s of d0.salesOrders.filter(touchedSO))
          th(await supabase.from("sales_orders").update({ status: "open", invoice_id: null }).eq("id", s.id));
        const touchedProp = p => (p.phases || []).some(ph => ph.invoiceId === id);
        for (const p of d0.proposals.filter(touchedProp)) {
          const phases = p.phases.map(ph => ph.invoiceId === id ? { ...ph, invoiceId: undefined } : ph);
          th(await supabase.from("proposals").update({ phases }).eq("id", p.id));
        }
        th(await supabase.from("payments").delete().eq("parent_id", id));
        th(await supabase.from("invoices").delete().eq("id", id));
        setDb(d => ({
          ...d,
          invoices: d.invoices.filter(i => i.id !== id),
          timeEntries: d.timeEntries.map(te => te.invoiceId === id ? { ...te, invoiceId: "" } : te),
          salesOrders: d.salesOrders.map(s => touchedSO(s)
            ? { ...s, status: "open", invoiceId: "", lineItems: (s.lineItems || []).map(li => li.invoiceId === id ? { ...li, invoiced: false, invoiceId: "" } : li) }
            : s),
          proposals: d.proposals.map(p => touchedProp(p)
            ? { ...p, phases: p.phases.map(ph => ph.invoiceId === id ? { ...ph, invoiceId: undefined } : ph) }
            : p),
        }));
        for (const s of d0.salesOrders.filter(touchedSO)) await reconcileJobTask(s.id);
        await logDeletion("invoice", inv?.number || "", cust ? `Customer: ${cust}` : "");
        return true;
      } catch (e) { return fail(e); }
    },
    async recordPayment(parentType, parentId, p) {
      try {
        guardCheckNumber(parentType, p);
        th(await supabase.from("payments").insert(A.paymentToRow(p, parentType, parentId)));
        setDb(d => parentType === "invoice"
          ? { ...d, invoices: d.invoices.map(i => i.id === parentId ? { ...i, payments: [...(i.payments || []), p] } : i) }
          : { ...d, bills: d.bills.map(b => b.id === parentId ? { ...b, payments: [...(b.payments || []), p] } : b) });
        return true;
      } catch (e) { return fail(e); }
    },

    // Many payments in one write — a batch pay run. Several rows may share a
    // check number (one check covering several bills); that is one check, so
    // the duplicate guard runs once per distinct number against what's already
    // on file. All-or-nothing: one insert, one state update.
    async recordPayments(entries) {
      try {
        const list = (entries || []).filter(e => Math.abs(Number(e.payment.amount) || 0) > 0.005);
        if (!list.length) throw new Error("Nothing to record — select at least one item with an amount.");
        const refs = new Set();
        list.filter(e => e.parentType === "bill" && isCheckPayment(e.payment)).forEach(e => refs.add(normRef(e.payment.ref)));
        refs.forEach(ref => guardCheckNumber("bill", { method: "Check", ref }));
        th(await supabase.from("payments").insert(list.map(e => A.paymentToRow(e.payment, e.parentType, e.parentId))));
        setDb(d => {
          const add = (doc, type) => {
            const mine = list.filter(e => e.parentType === type && e.parentId === doc.id).map(e => e.payment);
            return mine.length ? { ...doc, payments: [...(doc.payments || []), ...mine] } : doc;
          };
          return { ...d, bills: d.bills.map(b => add(b, "bill")), invoices: d.invoices.map(i => add(i, "invoice")) };
        });
        return list.map(e => e.payment);
      } catch (e) { return fail(e); }
    },

    // Correct a recorded payment in place. Bills and invoices reopen on their
    // own when an amount drops, because balances are derived (CLAUDE.md §6).
    async updatePayment(parentType, parentId, p) {
      try {
        const prev = (parentType === "invoice" ? dbRef.current.invoices : dbRef.current.bills)
          .find(x => x.id === parentId)?.payments?.find(x => x.id === p.id);
        const payment = { ...p, amount: round2(Number(p.amount) || 0), ref: normRef(p.ref) };
        // Keeping the same number on the same check is never a duplicate.
        if (normRef(prev?.ref) !== payment.ref || prev?.method !== payment.method) guardCheckNumber(parentType, payment, [payment.id]);
        th(await supabase.from("payments").update(A.paymentToRow(payment, parentType, parentId)).eq("id", payment.id));
        const swap = doc => doc.id === parentId
          ? { ...doc, payments: (doc.payments || []).map(x => x.id === payment.id ? payment : x) } : doc;
        setDb(d => parentType === "invoice"
          ? { ...d, invoices: d.invoices.map(swap) }
          : { ...d, bills: d.bills.map(swap) });
        return payment;
      } catch (e) { return fail(e); }
    },

    // Void: drop a whole set of payments at once (every bill on one check, or
    // every payment from a pay run that printed badly). The bills go back to
    // open and the check number is free again.
    async deletePayments(paymentIds) {
      try {
        const ids = [...new Set(paymentIds || [])];
        if (!ids.length) return true;
        th(await supabase.from("payments").delete().in("id", ids));
        const strip = doc => (doc.payments || []).some(p => ids.includes(p.id))
          ? { ...doc, payments: doc.payments.filter(p => !ids.includes(p.id)) } : doc;
        setDb(d => ({ ...d, bills: d.bills.map(strip), invoices: d.invoices.map(strip) }));
        return true;
      } catch (e) { return fail(e); }
    },

    // Customer receipt across many invoices on one check/transfer. Each
    // allocation becomes its own payment row (sharing the receipt's date /
    // method / ref) so one check reconciles several invoices at once. Credit
    // invoices carry a negative allocation, netting against the others.
    async recordReceipt(allocations, meta) {
      try {
        const rows = allocations
          .map(a => ({ invoiceId: a.invoiceId, payment: { id: uid(), amount: round2(Number(a.amount) || 0), date: meta.date, method: meta.method, ref: meta.ref || "" } }))
          .filter(r => Math.abs(r.payment.amount) > 0.005);
        if (!rows.length) throw new Error("Nothing to apply — select at least one item with an amount.");
        th(await supabase.from("payments").insert(rows.map(r => A.paymentToRow(r.payment, "invoice", r.invoiceId))));
        setDb(d => ({
          ...d,
          invoices: d.invoices.map(i => {
            const mine = rows.filter(r => r.invoiceId === i.id).map(r => r.payment);
            return mine.length ? { ...i, payments: [...(i.payments || []), ...mine] } : i;
          }),
        }));
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- bills ---- */
    async saveBill(b) {
      try {
        const isNew = !!b._new;
        const bill = { ...b, amount: Number(b.amount) || 0 }; delete bill._new;
        const ref = (bill.ref || "").trim();
        if (!ref) throw new Error("Vendor invoice # (Ref) is required — it can't be blank.");
        const dup = dbRef.current.bills.find(x => x.id !== bill.id && x.vendorId === bill.vendorId
          && (x.ref || "").trim().toLowerCase() === ref.toLowerCase());
        if (dup) throw new Error(`A bill with Ref "${ref}" already exists for this vendor (${dup.number}).`);
        bill.ref = ref;
        if (isNew) bill.number = dbRef.current.settings.billPrefix + "-" + pad4(await claimNumber("bill"));
        th(await supabase.from("bills").upsert(A.billToRow(bill)));
        setDb(d => ({ ...d, bills: upsertList(d.bills, bill) }));
        return bill;
      } catch (e) { return fail(e); }
    },
    async deleteBill(id) {
      try {
        const bill = dbRef.current.bills.find(b => b.id === id);
        th(await supabase.from("payments").delete().eq("parent_id", id));
        th(await supabase.from("bills").delete().eq("id", id));
        setDb(d => ({ ...d, bills: d.bills.filter(b => b.id !== id) }));
        await logDeletion("bill", bill?.number || "", bill?.ref ? `Ref: ${bill.ref}` : "");
        return true;
      } catch (e) { return fail(e); }
    },

    /* ---- purchase orders ---- */
    async savePurchaseOrder(p) {
      try {
        const isNew = !!p._new;
        const po = { ...p }; delete po._new;
        if (isNew) po.number = (dbRef.current.settings.poPrefix || "PO") + "-" + pad4(await claimNumber("po"));
        th(await supabase.from("purchase_orders").upsert(A.poToRow(po)));
        await replaceLineItems("purchase_order_line_items", "purchase_order_id", po.id, po.lineItems);
        setDb(d => ({ ...d, purchaseOrders: upsertList(d.purchaseOrders, po) }));
        return po;
      } catch (e) { return fail(e); }
    },
    async setPOStatus(id, status) {
      try {
        th(await supabase.from("purchase_orders").update({ status }).eq("id", id));
        setDb(d => ({ ...d, purchaseOrders: d.purchaseOrders.map(p => p.id === id ? { ...p, status } : p) }));
        return true;
      } catch (e) { return fail(e); }
    },
    async deletePurchaseOrder(id) {
      try {
        const po = dbRef.current.purchaseOrders.find(p => p.id === id);
        th(await supabase.from("purchase_orders").delete().eq("id", id));
        setDb(d => ({ ...d, purchaseOrders: d.purchaseOrders.filter(p => p.id !== id) }));
        await logDeletion("purchase_order", po?.number || "");
        return true;
      } catch (e) { return fail(e); }
    },
    // Turn a PO into a vendor bill (amount from the PO), link them, and mark the
    // PO received. Guards against billing the same PO twice.
    async createBillFromPO(po) {
      try {
        const d0 = dbRef.current;
        if (d0.bills.some(b => b.purchaseOrderId === po.id)) throw new Error(`A bill was already created from ${po.number}.`);
        const bill = {
          id: uid(), number: (d0.settings.billPrefix || "BILL") + "-" + pad4(await claimNumber("bill")),
          vendorId: po.vendorId, date: todayISO(), dueDate: addDays(todayISO(), d0.settings.terms),
          amount: round2(lineTotals(po.lineItems, po.taxRate).total), ref: po.number, notes: `From PO ${po.number}`,
          salesOrderId: po.salesOrderId || "", purchaseOrderId: po.id, payments: [],
        };
        th(await supabase.from("bills").insert(A.billToRow(bill)));
        th(await supabase.from("purchase_orders").update({ status: "received" }).eq("id", po.id));
        setDb(d => ({
          ...d,
          bills: [...d.bills, bill],
          purchaseOrders: d.purchaseOrders.map(p => p.id === po.id ? { ...p, status: "received" } : p),
        }));
        return bill;
      } catch (e) { return fail(e); }
    },

    // Re-insert a just-deleted record (+ its children) to undo a delete. Covers
    // the document types with straightforward, side-effect-free deletes.
    async restoreRecord(type, rec) {
      try {
        if (type === "sales_order") {
          th(await supabase.from("sales_orders").insert(A.soToRow(rec)));
          if (rec.lineItems?.length) th(await supabase.from("sales_order_line_items").insert(A.soLineItemsToRows(rec.lineItems, rec.id)));
          setDb(d => ({ ...d, salesOrders: upsertList(d.salesOrders, rec) }));
        } else if (type === "quote") {
          th(await supabase.from("quotes").insert(A.quoteToRow(rec)));
          if (rec.lineItems?.length) th(await supabase.from("quote_line_items").insert(A.lineItemsToRows(rec.lineItems, "quote_id", rec.id)));
          setDb(d => ({ ...d, quotes: upsertList(d.quotes, rec) }));
        } else if (type === "bill") {
          th(await supabase.from("bills").insert(A.billToRow(rec)));
          if (rec.payments?.length) th(await supabase.from("payments").insert(rec.payments.map(p => A.paymentToRow(p, "bill", rec.id))));
          setDb(d => ({ ...d, bills: upsertList(d.bills, rec) }));
        } else if (type === "expense") {
          th(await supabase.from("expenses").insert(A.expenseToRow(rec)));
          setDb(d => ({ ...d, expenses: upsertList(d.expenses, rec) }));
        } else if (type === "purchase_order") {
          th(await supabase.from("purchase_orders").insert(A.poToRow(rec)));
          if (rec.lineItems?.length) th(await supabase.from("purchase_order_line_items").insert(A.lineItemsToRows(rec.lineItems, "purchase_order_id", rec.id)));
          setDb(d => ({ ...d, purchaseOrders: upsertList(d.purchaseOrders, rec) }));
        } else if (type === "contact") {
          th(await supabase.from("contacts").insert(A.contactToRow(rec)));
          setDb(d => ({ ...d, contacts: upsertList(d.contacts, rec) }));
        } else { return null; }
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
        const x = dbRef.current.expenses.find(e => e.id === id);
        th(await supabase.from("expenses").delete().eq("id", id));
        setDb(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
        await logDeletion("expense", x?.category || "", x ? `${x.vendor || ""} ${x.amount || ""}`.trim() : "");
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
        const c = dbRef.current.contacts.find(x => x.id === id);
        th(await supabase.from("contacts").delete().eq("id", id));
        setDb(d => ({ ...d, contacts: d.contacts.filter(c => c.id !== id) }));
        await logDeletion("contact", c?.name || "", c?.type || "");
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

    // Run the backup edge function immediately for this org (per its settings).
    async runBackupNow() {
      try {
        const { data, error } = await supabase.functions.invoke("scheduled-backup");
        if (error) {
          let msg = error.message;
          try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
          throw new Error(msg);
        }
        if (data && data.ok === false) throw new Error(data.error);
        return data;
      } catch (e) { return fail(e); }
    },
    // List stored backup files for this org (newest first).
    async listBackups() {
      try {
        const orgId = dbRef.current.org.id;
        const { data, error } = await supabase.storage.from("backups").list(orgId, { limit: 100, sortBy: { column: "name", order: "desc" } });
        if (error) throw error;
        return (data || []).filter(f => f.name.endsWith(".json")).map(f => ({ name: f.name, path: `${orgId}/${f.name}`, size: f.metadata?.size || 0, updatedAt: f.updated_at || f.created_at || "" }));
      } catch (e) { return fail(e); }
    },
    // Short-lived signed URL to download a stored backup file.
    async backupUrl(path) {
      try {
        const { data, error } = await supabase.storage.from("backups").createSignedUrl(path, 300);
        if (error) throw error;
        return data.signedUrl;
      } catch (e) { return fail(e); }
    },

    /* ---- team / users (admin only; enforced by RLS + the edge function) ---- */
    // Create a login for a teammate with an initial password (feature 6). The
    // service-role edge function makes the auth user and the membership row.
    async createUser({ email, password, role, permissions }) {
      try {
        const { data, error } = await supabase.functions.invoke("admin-create-user", {
          body: { orgId: dbRef.current.org.id, email, password, role, permissions },
        });
        if (error) {
          // supabase-js reports a generic "non-2xx" message; the real reason is
          // in the function's JSON body (error.context is the Response).
          let msg = error.message;
          try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
          throw new Error(msg);
        }
        if (data && data.ok === false) throw new Error(data.error);
        await reload();
        return true;
      } catch (e) { return fail(e); }
    },
    // Admin resets another user's password via the same edge function.
    async resetUserPassword(email, password) {
      try {
        const { data, error } = await supabase.functions.invoke("admin-create-user", {
          body: { orgId: dbRef.current.org.id, email, password, action: "reset-password" },
        });
        if (error) {
          let msg = error.message;
          try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
          throw new Error(msg);
        }
        if (data && data.ok === false) throw new Error(data.error);
        return true;
      } catch (e) { return fail(e); }
    },
    // Change a member's role and/or per-area permissions (feature 7).
    async updateMember(email, patch) {
      try {
        const upd = {};
        if (patch.role !== undefined) upd.role = patch.role;
        if (patch.permissions !== undefined) upd.permissions = patch.permissions;
        th(await supabase.from("org_members").update(upd).eq("org_id", dbRef.current.org.id).eq("email", email));
        setDb(d => ({ ...d, members: d.members.map(m => m.email === email ? { ...m, ...patch } : m) }));
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
        const p = dbRef.current.proposals.find(x => x.id === id);
        th(await supabase.from("proposals").delete().eq("id", id));
        setDb(d => ({ ...d, proposals: d.proposals.filter(p => p.id !== id) }));
        await logDeletion("proposal", p?.number || "");
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
        await replaceLineItems("sales_order_line_items", "sales_order_id", so.id, so.lineItems, A.soLineItemsToRows);
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
          id: uid(), number: await claimInvoiceNumber(p.customerId, todayISO()),
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
        const contactPeople = arr("contactPeople").map(p => ({ ...p, id: uid(), contactId: nid(p.contactId) }));
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
        await ins("contact_people", contactPeople.map(A.personToRow));
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
