import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLoanText, loanCheck, planLoanStatement } from "../src/lib/loanStatement.js";
import { parseCardText } from "../src/lib/cardStatement.js";

// A line of credit statement in PNC's layout, as pdf.js reads it. Made-up figures.
const LOC = [
  "Business Line of Credit Statement", "For the period 03/07/2026 to 04/07/2026", "Account XXXXXXXXXXXXXXXX1234",
  "Previous Balance $10,000.00 New Balance $10,050.00", "Payments $150.00 Total Payment Due $160.00",
  "Fees Charged $100.00", "Interest Charged $100.00", "Statement Closing Date 04/07/26",
  "04/02/26 04/02/26 PAYMENT REC'D - THANK YOU -150.00", "03/02/26 03/13/26 ANNUAL FEE ASSESSED $100.00",
  "TOTAL FEES FOR THIS PERIOD $100.00", "04/07/26 04/07/26 INTEREST CHARGE $100.00",
];

test("line of credit statement: read, typed, and balanced", () => {
  const st = parseLoanText(LOC);
  assert.equal(st.closingDate, "2026-04-07");
  assert.equal(st.periodFrom, "2026-03-07");
  assert.equal(st.previousBalance, 10000);
  assert.equal(st.newBalance, 10050);
  assert.deepEqual(st.lines.map(l => [l.kind, l.amount]), [["payment", -150], ["fee", 100], ["interest", 100]]);
  assert.equal(loanCheck(st), 0);
});

test("line of credit posting: payment Dr line / Cr bank; interest and fees to expense; an existing draw is linked", () => {
  const loan = { name: "LOC", account: "2600" };
  const st = parseLoanText(LOC);
  const plan = planLoanStatement({ journalEntries: [], loanStatements: [] }, loan, st);
  const p = plan.cash[0].entry.lines;
  assert.deepEqual(p.map(l => [l.account, l.debit || 0, l.credit || 0]), [["2600", 150, 0], ["1020", 0, 150]]);
  const c = plan.chargesEntry.lines.map(l => [l.account, l.debit || 0, l.credit || 0]);
  assert.deepEqual(c, [["6850", 100, 0], ["7150", 100, 0], ["2600", 0, 200]]);
  // A draw already booked from the bank side is linked, not entered twice.
  const draw = parseLoanText(["Statement Closing Date 02/05/26", "01/09/26 01/12/26 ONLINE TRANS $20,000.00"]);
  const je = { id: "je19", number: "JE-0019", date: "2026-01-09", lines: [{ account: "1020", debit: 20000, credit: 0 }, { account: "2600", debit: 0, credit: 20000 }] };
  assert.equal(planLoanStatement({ journalEntries: [je], loanStatements: [] }, loan, draw).cash[0].existing.id, "je19");
});

test("card statement: charges, a credit, a payment; the margin code before a date is dropped", () => {
  const st = parseCardText([
    "Billing Period: 02/27/26-03/27/26", "Statement Closing Date 03/27/26",
    "Previous Balance $100.00", "New Balance $175.00",
    "Payments, Credits and Adjustments", "03/02 PAYMENT THANK YOU -$100.00", "03/05 03/06 AMAZON RETURN -$25.00",
    "Standard Purchases", "03/10 03/11 HOME DEPOT 1234 STERLING HTS MI $150.00", "27670003/19 NETFLIX.COM $50.00",
  ], { year: 2026 });
  const kinds = st.lines.map(l => [l.kind, l.amount]);
  assert.deepEqual(kinds, [["payment", -100], ["credit", -25], ["charge", 150], ["charge", 50]]);
  assert.equal(st.previousBalance, 100);
  assert.equal(st.newBalance, 175);
});
