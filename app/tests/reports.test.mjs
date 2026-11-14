import { test } from "node:test";
import assert from "node:assert/strict";
import { agedReceivables } from "../src/calc/reports.js";
import { monthClose } from "../src/calc/close.js";
import { dueDateFor } from "../src/lib/terms.js";
import { inv, pay, books } from "./helpers.mjs";

test("aged receivables: buckets by days past due; an unapplied credit counts in Current", () => {
  const db = books({ invoices: [
    inv("a", { total: 100, due: "2026-11-20" }), inv("b", { total: 200, due: "2026-11-01" }),
    inv("c", { total: 300, due: "2026-09-01" }), inv("d", { total: 400, due: "2026-06-01" }),
    inv("e", { total: 50, due: "2026-10-01", payments: [pay("p", 30, "2026-10-15", { discount: 20 })] }),
    inv("cr", { kind: "credit", total: -75, due: "2026-11-05" }),
  ] });
  const r = agedReceivables(db, "2026-11-14");
  const row = r.rows.find(x => x.key === "c");
  assert.equal(row.cur, 100 - 75);
  assert.equal(row.d30, 200);
  assert.equal(row.d90, 300);
  assert.equal(row.d90p, 400);
  assert.equal(row.total, 925);            // the settled invoice (cash + discount) is gone
});

test("month-end close: ready only when bank and every statement for the month are in", () => {
  const db = books({
    settings: { accounts: { cash: "1020", cards: [{ id: "k", name: "Card", account: "2150" }], lockDate: "2026-09-30" } },
    bankReconciliations: [{ account: "1020", statementDate: "2026-10-31", status: "done" }],
    cardStatements: [{ cardAccount: "2150", closingDate: "2026-09-27" }],
  });
  const oct = monthClose(db, "2026-10", { today: "2026-11-14" });
  assert.equal(oct.bank.state, "done");
  assert.equal(oct.cards[0].state, "missing");
  assert.equal(oct.ready, false);
  assert.equal(oct.locked, false);
  db.settings.accounts.closeSkips = { "2026-10": ["2150"] };
  assert.equal(monthClose(db, "2026-10", { today: "2026-11-14" }).ready, true);
  assert.equal(monthClose(db, "2026-09", { today: "2026-11-14" }).locked, true);
  assert.equal(monthClose(db, "2026-08", { today: "2026-11-14" }).cards[0].state, "na");   // before the card's first statement
  assert.equal(monthClose(db, "2026-11", { today: "2026-11-14" }).bank.state, "pending");
});

test("due date from the party's terms", () => {
  const db = books();
  db.contacts[0].terms = 45;
  assert.equal(dueDateFor(db, "c", "2026-10-01"), "2026-11-15");
});

test("cash forecast: overdue invoices stay out unless counted; bills and the card come out on time", async () => {
  const { cashForecast } = await import("../src/calc/forecast.js");
  const db = books({
    settings: { accounts: { cash: "1020", cards: [{ id: "k", name: "Card", account: "2150" }] } },
    invoices: [inv("late", { total: 1000, due: "2026-10-01" }), inv("soon", { total: 500, due: "2026-11-20" })],
    bills: [{ id: "b", number: "B", vendorId: "v", date: "2026-11-01", dueDate: "2026-11-18", amount: 300, lines: [], payments: [] }],
    journalEntries: [{ id: "o", date: "2026-11-01", lines: [{ account: "1020", debit: 2000, credit: 0 }, { account: "3910", debit: 0, credit: 2000 }] }],
    cardStatements: [{ cardAccount: "2150", closingDate: "2026-10-28", newBalance: 400 }],
  });
  const f = cashForecast(db, "2026-11-14");
  assert.equal(f.start, 2000);
  assert.equal(f.overdueIn, 1000);
  const end = f.weeks[f.weeks.length - 1].balance;
  assert.equal(end, 2000 + 500 - 300 - 400);
  assert.equal(cashForecast(db, "2026-11-14", { includeOverdue: true }).weeks[0].in, 1000);
});
