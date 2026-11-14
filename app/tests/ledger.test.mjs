import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTotals, paid, settled, balance, billBalance, invoiceStatus } from "../src/calc/ledger.js";
import { billLines, shareByLines } from "../src/calc/accounts.js";
import { journal, trialBalance } from "../src/calc/gl.js";
import { inv, pay, books, net } from "./helpers.mjs";

test("cash vs settled: a discount closes the document but is not cash", () => {
  const i = inv("a", { total: 1000, payments: [pay("p", 980, "2026-07-05", { discount: 20 })] });
  assert.equal(paid(i), 980);
  assert.equal(settled(i), 1000);
  assert.equal(balance(i), 0);
  assert.equal(invoiceStatus(i), "paid");
  assert.equal(billBalance({ amount: 500, payments: [pay("q", 450, "2026-07-05", { discount: 50 })] }), 0);
});

test("lineTotals: tax on the subtotal", () => {
  assert.deepEqual(lineTotals([{ qty: 2, unitPrice: 50 }], 6), { sub: 100, tax: 6, total: 106 });
});

test("cash basis: a part-paid invoice recognizes revenue as cash comes in, the last cent on the last receipt", () => {
  const db = books({ invoices: [inv("a", { total: 100, payments: [pay("p1", 33.33, "2026-07-01"), pay("p2", 66.67, "2026-07-20")] })] });
  const j = journal(db, { close: false });
  assert.equal(net(j, "1020"), 100);
  assert.equal(net(j, "4000"), -100);
});

test("cash basis: a credit memo netted into a receipt posts its cash share (Venture E1136)", () => {
  // Six invoices paid $51,369.50 less a $2,516 credit memo = one $48,853.50 deposit.
  const db = books({ invoices: [
    inv("a", { total: 51369.5, payments: [pay("p1", 51369.5, "2026-07-10", { ref: "E1136" })] }),
    inv("cr", { kind: "credit", total: -2516, payments: [pay("p2", -2516, "2026-07-10", { ref: "E1136" })] }),
  ] });
  const j = journal(db, { close: false });
  assert.equal(net(j, "1020"), 48853.5);
  assert.equal(net(j, "4000"), -48853.5);
});

test("a credit applied to an invoice (method Credit) moves no cash", () => {
  const db = books({ invoices: [
    inv("a", { total: 500, payments: [pay("x1", 100, "2026-07-10", { method: "Credit", ref: "CM-1" })] }),
    inv("cr", { kind: "credit", total: -100, payments: [pay("x2", -100, "2026-07-10", { method: "Credit", ref: "CM-1" })] }),
  ] });
  assert.equal(net(journal(db, { close: false }), "1020"), 0);
});

test("itemized bill: lines post to their own accounts; a part payment is shared in proportion", () => {
  const bill = { id: "b", number: "BILL-1", vendorId: "v", date: "2026-10-01", amount: 1000, ref: "9814",
    lines: [{ id: "l1", desc: "Panel", amount: 333.33, account: "", salesOrderId: "s1", costCategory: "panel" },
      { id: "l2", desc: "Cable", amount: 666.67, account: "5100", salesOrderId: "s2", costCategory: "cables" }],
    payments: [pay("bp", 500, "2026-10-05")] };
  const db = books({ bills: [bill] });
  const j = journal(db, { close: false });
  assert.equal(net(j, "5000"), 166.67);
  assert.equal(net(j, "5100"), 333.33);
  assert.equal(net(j, "1020"), -500);
  assert.equal(billLines(db, { ...bill, lines: [] })[0].account, "5000");   // a one-line bill takes the vendor's account
  db.settings.accounts.basis = "accrual";
  assert.equal(net(journal(db, { close: false }), "2000"), -500);          // A/P: 1,000 billed less 500 paid
});

test("shareByLines: cents land on the last line", () => {
  assert.deepEqual(shareByLines([{ amount: 1 }, { amount: 1 }, { amount: 1 }], 100), [33.33, 33.34, 33.33]);
  assert.equal(shareByLines([{ amount: 2 }, { amount: 1 }], 10).reduce((a, b) => a + b, 0), 10);
});

test("the trial balance always balances", () => {
  const db = books({
    invoices: [inv("a", { total: 1200, payments: [pay("p", 1000, "2026-08-01")] })],
    bills: [{ id: "b", number: "B", vendorId: "v", date: "2026-08-01", amount: 300, lines: [], payments: [pay("bp", 280, "2026-08-02", { discount: 20 })] }],
    expenses: [{ id: "e", date: "2026-08-03", amount: 45.5, account: "6450", cashAccount: "1020" }],
    journalEntries: [{ id: "j", date: "2026-08-04", lines: [{ account: "1020", debit: 20000, credit: 0 }, { account: "2600", debit: 0, credit: 20000 }] }],
  });
  for (const basis of ["cash", "accrual"]) {
    db.settings.accounts.basis = basis;
    const tb = trialBalance(db, "2026-12-31");
    const rows = tb.rows || tb;
    const d = rows.reduce((t, r) => t + (r.debit || 0), 0), c = rows.reduce((t, r) => t + (r.credit || 0), 0);
    assert.ok(Math.abs(d - c) < 0.005, `${basis}: debits ${d} vs credits ${c}`);
  }
});
