// Small builders for test books. Every figure is made up; the shapes are the app's own.
export const inv = (id, { number = id, customerId = "c", date = "2026-07-01", due, total, kind = "invoice", payments = [], taxRate = 0 } = {}) =>
  ({ id, number, customerId, date, dueDate: due || date, taxRate, kind, lineItems: [{ id: id + "-l", qty: 1, unitPrice: total }], payments });
export const pay = (id, amount, date, { method = "ACH / Wire", ref = "", discount = 0 } = {}) => ({ id, amount, discount, date, method, ref });
export const books = (over = {}) => ({
  settings: { accounts: {}, company: "Test Co" }, accounts: [],
  contacts: [{ id: "c", type: "customer", name: "Venture Global Engineering" }, { id: "v", type: "vendor", name: "Venus Controls", expenseAccount: "5000" }],
  invoices: [], bills: [], expenses: [], journalEntries: [], salesOrders: [], ...over,
});
// The lines a journal posts to one account, as debit − credit.
export const net = (entries, account) => Math.round(entries.flatMap(e => e.lines).filter(l => String(l.account) === account)
  .reduce((t, l) => t + (l.debit || 0) - (l.credit || 0), 0) * 100) / 100;
