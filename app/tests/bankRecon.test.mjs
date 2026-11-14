import { test } from "node:test";
import assert from "node:assert/strict";
import { matchStatement, cashRegister } from "../src/calc/bankRecon.js";
import { inv, pay, books } from "./helpers.mjs";

const item = (key, date, amount, extra = {}) => ({ key, date, amount, type: "payment", party: "", ref: "", ...extra });

test("same amount: the line naming the payee wins over an earlier line read first (Sept $500 Venus vs ATM)", () => {
  const items = [item("payment:venus", "2026-09-09", -500, { party: "Venus Controls", ref: "260909-01a" })];
  const lines = [{ id: 1, date: "2026-09-08", desc: "ATM Withdrawal 26 Mile Rd", amount: -500 },
    { id: 2, date: "2026-09-09", desc: "Instpmntout Venus Controls 09/09 15274", amount: -500 }];
  const m = matchStatement(lines, items);
  assert.equal(m[0].item, null);
  assert.equal(m[1].item.key, "payment:venus");
});

test("same amount, no names: the closest date wins across the whole statement", () => {
  const items = [item("a", "2026-09-10", -100)];
  const lines = [{ id: 1, date: "2026-09-03", desc: "x", amount: -100 }, { id: 2, date: "2026-09-11", desc: "y", amount: -100 }];
  const m = matchStatement(lines, items);
  assert.equal(m[1].item?.key, "a");
  assert.equal(m[0].item, null);
});

test("check number beats date", () => {
  const items = [item("c1", "2026-09-01", -250, { ref: "4870" }), item("c2", "2026-09-20", -250, { ref: "4871" })];
  const m = matchStatement([{ id: 1, date: "2026-09-21", desc: "Check 4870", checkNo: "4870", amount: -250 }], items);
  assert.equal(m[0].item.key, "c1");
});

test("one bank line, several rows sharing a reference and date that add up (a transfer paying three bills)", () => {
  const items = [21251, 18875, 21251].map((a, i) => item("b" + i, "2026-09-10", -a, { ref: "E260909-01", party: "Venus Controls" }));
  const m = matchStatement([{ id: 1, date: "2026-09-09", desc: "Instpmntout Venus Controls", amount: -61377 }], items);
  assert.equal(m[0].group.length, 3);
});

test("close but not equal is offered as a correction, never matched", () => {
  const m = matchStatement([{ id: 1, date: "2026-09-09", desc: "x", amount: -6344 }], [item("p", "2026-09-08", -6334)]);
  assert.equal(m[0].item, null);
  assert.equal(m[0].near.key, "p");
});

test("the register carries a netted credit memo, so the group matches the deposit (Venture E1136)", () => {
  const db = books({ invoices: [
    inv("a", { total: 51369.5, payments: [pay("p1", 51369.5, "2026-07-10", { ref: "E1136" })] }),
    inv("cr", { kind: "credit", total: -2516, payments: [pay("p2", -2516, "2026-07-10", { ref: "E1136" })] }),
  ] });
  const reg = cashRegister(db, "1020");
  const m = matchStatement([{ id: 1, date: "2026-07-10", desc: "Corporate ACH Vge Venture Global", amount: 48853.5 }], reg);
  assert.equal(m[0].group?.length, 2);
});
