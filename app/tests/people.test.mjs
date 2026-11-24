import { test } from "node:test";
import assert from "node:assert/strict";
import { salutationFor } from "../src/lib/people.js";

test("greeting: a title takes the last name, no title keeps the whole name", () => {
  assert.equal(salutationFor("Mr. John Murphy", "Acme"), "Mr. Murphy:");
  assert.equal(salutationFor("Ms Jane Smith", "Acme"), "Ms Smith:");
  assert.equal(salutationFor("Bevin Lu", "HYY Mould"), "Bevin Lu:");
  assert.equal(salutationFor("  Bevin   Lu ", "HYY Mould"), "Bevin Lu:");
  assert.equal(salutationFor("Mr.", "Acme"), "Mr.:");
  assert.equal(salutationFor("", "HYY Mould"), "HYY Mould Team:");
  assert.equal(salutationFor(undefined, ""), "Customer Team:");
});
