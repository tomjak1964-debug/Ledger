import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, isDue, templateFrom, docFromTemplate, templateTotal } from "../src/calc/recurring.js";
import { books } from "./helpers.mjs";

test("advance: a week, a month (the 31st falls back to month-end), a quarter, a year", () => {
  assert.equal(advance("2026-11-14", "week"), "2026-11-21");
  assert.equal(advance("2026-01-31", "month"), "2026-02-28");
  assert.equal(advance("2026-12-15", "month"), "2027-01-15");
  assert.equal(advance("2026-11-30", "quarter"), "2027-02-28");
  assert.equal(advance("2028-02-29", "year"), "2029-02-28");
});

test("due: active, on or past its date, not past its end", () => {
  assert.equal(isDue({ active: true, nextDate: "2026-11-01" }, "2026-11-14"), true);
  assert.equal(isDue({ active: false, nextDate: "2026-11-01" }, "2026-11-14"), false);
  assert.equal(isDue({ active: true, nextDate: "2026-12-01" }, "2026-11-14"), false);
  assert.equal(isDue({ active: true, nextDate: "2026-12-01", endDate: "2026-11-30" }, "2026-12-14"), false);
});

test("a recurring invoice repeats lines and tax, gets a new number and the customer's terms", () => {
  const db = books();
  db.contacts[0].terms = 30;
  const t = templateFrom("invoice", { customerId: "c", taxRate: 6, notes: "Monthly support", lineItems: [{ id: "x", desc: "Support", qty: 1, unitPrice: 500 }], payments: [{ amount: 1 }] });
  assert.equal(Math.round(templateTotal("invoice", t) * 100) / 100, 530);
  const inv = docFromTemplate(db, { kind: "invoice", name: "Support", template: t }, "2026-12-01");
  assert.equal(inv.number, "(auto)");
  assert.equal(inv.date, "2026-12-01");
  assert.equal(inv.dueDate, "2026-12-31");
  assert.deepEqual(inv.payments, []);
  assert.notEqual(inv.lineItems[0].id, "x");
});

test("a recurring bill keeps its lines and jobs, and gets a REC- invoice number of its date", () => {
  const db = books();
  const t = templateFrom("bill", { vendorId: "v", amount: 1200, lines: [], expenseAccount: "6400", salesOrderId: "s1", costCategory: "other" });
  const bill = docFromTemplate(db, { kind: "bill", name: "Rent", template: t }, "2026-12-01");
  assert.equal(bill.ref, "REC-261201");
  assert.equal(bill.amount, 1200);
  assert.equal(bill.lines[0].salesOrderId, "s1");
  assert.equal(bill.lines[0].account, "6400");
});
