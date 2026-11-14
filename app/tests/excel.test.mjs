import { test } from "node:test";
import assert from "node:assert/strict";
import { cellValue, listTitle } from "../src/lib/excel.js";

test("Excel export: money and counts as numbers, ISO dates as dates, document numbers as text", () => {
  assert.deepEqual(cellValue("1234.50"), { value: 1234.5, fmt: "#,##0.00" });
  assert.deepEqual(cellValue("-25.00"), { value: -25, fmt: "#,##0.00" });
  assert.deepEqual(cellValue("4870"), { value: 4870, fmt: "0" });
  assert.equal(cellValue("2026-11-14").value.toISOString().slice(0, 10), "2026-11-14");
  assert.deepEqual(cellValue("INV-VG261016-01"), { value: "INV-VG261016-01" });
  assert.deepEqual(cellValue("0042"), { value: "0042" });       // a leading zero stays as typed
  assert.deepEqual(cellValue(""), { value: null });
  assert.equal(listTitle("aged-receivables-detail"), "Aged Receivables Detail");
});
