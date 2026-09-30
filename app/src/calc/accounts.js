// The chart of accounts and the rules that pick an account for a document.
//
// Accounts live in the `accounts` table (System → Chart of Accounts); each is
// a number ("1020"), a name and a type from ACCOUNT_TYPES. Documents carry the
// account NUMBER as text, never the row id, so renumbering a chart is a
// deliberate act and a backup reads the same way in any org.
//
// Which account a document posts to is decided once, here, and read by the
// general ledger (calc/gl.js) and by every editor that offers a choice:
//   invoice / credit note → its own income account, else the customer's sales
//                           account, else the default income account
//   vendor bill           → its own expense account, else the vendor's, else
//                           the default expense account
//   expense entry         → its own account, else the one its category maps
//                           to, else the default expense account
//   payment / receipt     → its own cash account, else the default (Checking)

export const ACCOUNT_TYPES = [
  "Cash", "Accounts Receivable", "Inventory", "Other Current Assets", "Fixed Assets", "Accumulated Depreciation",
  "Accounts Payable", "Other Current Liabilities", "Long Term Liabilities",
  "Equity-doesn't close", "Equity-Retained Earnings", "Equity-gets closed",
  "Income", "Cost of Sales", "Expenses",
];

// Where a type sits on the balance sheet or income statement, and which side
// its normal balance is on. Assets and expenses grow on the debit side;
// liabilities, equity and income grow on the credit side.
export const TYPE_GROUP = {
  "Cash": "asset", "Accounts Receivable": "asset", "Inventory": "asset", "Other Current Assets": "asset",
  "Fixed Assets": "asset", "Accumulated Depreciation": "asset",
  "Accounts Payable": "liability", "Other Current Liabilities": "liability", "Long Term Liabilities": "liability",
  "Equity-doesn't close": "equity", "Equity-Retained Earnings": "equity", "Equity-gets closed": "equity",
  "Income": "income", "Cost of Sales": "cos", "Expenses": "expense",
};
export const normalSide = type => (["asset", "expense", "cos"].includes(TYPE_GROUP[type]) ? "debit" : "credit");
// The accounts a year-end close empties into Retained Earnings: every income,
// cost of sales and expense account, and equity typed "gets closed" (Distributions).
export const closesAtYearEnd = type => ["income", "cos", "expense"].includes(TYPE_GROUP[type]) || type === "Equity-gets closed";

// The accounts the app posts to on its own. Each is a chart number; Settings →
// Accounts lets the shop point them elsewhere.
export const DEFAULT_ACCOUNT_SETTINGS = {
  basis: "cash",            // "cash": revenue when a receipt lands, expenses when a bill is paid; "accrual": when issued / entered
  ar: "1100",               // Accounts Receivable
  ap: "2000",               // Accounts Payable
  cash: "1020",             // Checking Account — what pays bills and takes deposits
  salesTax: "2310",         // Sales Tax Payable
  salesDiscount: "4900",    // Sales/Fees Discounts — an early-payment term a customer took
  purchaseDiscount: "6900", // Purchase Disc-Expense Items — a term the shop took on a bill
  income: "4000",           // Professional Fees — a customer with no sales account of their own
  expense: "6750",          // Control Panel Expenses — a vendor with no expense account of their own
  retainedEarnings: "3910", // where income, cost, expense and distribution balances close to at year-end
  fiscalYearEndMonth: 12,   // the fiscal year ends on the last day of this month
};
export const accountSettings = settings => ({ ...DEFAULT_ACCOUNT_SETTINGS, ...(settings?.accounts || {}) });
export const isCashBasis = settings => accountSettings(settings).basis !== "accrual";
export const basisLabel = settings => (isCashBasis(settings) ? "Cash basis" : "Accrual basis");

// The legacy expense categories (helpers.js EXPENSE_CATS) mapped onto the
// chart, so an expense logged before accounts existed still lands somewhere
// sensible on the income statement.
export const CATEGORY_ACCOUNTS = {
  "Materials": "6751", "Subcontractor": "6700", "Tools & Equipment": "6350", "Software": "6570",
  "Travel": "6710", "Vehicle/Fuel": "6710", "Office": "6450", "Utilities": "6400", "Insurance": "6950",
  "Professional Fees": "6650", "Other": "6550",
};

// 1099 reporting kinds a vendor can carry.
export const TEN99_TYPES = [["", "None"], ["nec", "1099-NEC"], ["misc", "1099-MISC"]];
export const ten99Label = t => TEN99_TYPES.find(([k]) => k === (t || ""))?.[1] || "None";

const key = s => String(s || "").trim();
// The chart the app reads: the org's own accounts once any are loaded, else
// the built-in TMJ chart — so every picker and report names accounts from the
// first day, before anyone has been to System → Chart of Accounts.
export const chart = db => ((db.accounts || []).length ? db.accounts : DEFAULT_ACCOUNTS);
export const chartLoaded = db => (db.accounts || []).length > 0;
export const accountByNumber = (db, number) => chart(db).find(a => key(a.number) === key(number)) || null;
export const accountName = (db, number) => accountByNumber(db, number)?.name || "";
export const accountLabel = (db, number) => number ? `${number}${accountName(db, number) ? " · " + accountName(db, number) : ""}` : "";
export const accountsOfType = (db, types) => chart(db).filter(a => a.active !== false && (!types || types.includes(a.type)));

export const incomeAccountOf = (db, inv) => {
  const cust = db.contacts.find(c => c.id === inv.customerId);
  return key(inv.incomeAccount) || key(cust?.salesAccount) || accountSettings(db.settings).income;
};
export const expenseAccountOfBill = (db, bill) => {
  const vend = db.contacts.find(c => c.id === bill.vendorId);
  return key(bill.expenseAccount) || key(vend?.expenseAccount) || accountSettings(db.settings).expense;
};
export const expenseAccountOfExpense = (db, e) =>
  key(e.account) || CATEGORY_ACCOUNTS[e.category] || accountSettings(db.settings).expense;
export const cashAccountOf = (db, p) => key(p?.cashAccount) || accountSettings(db.settings).cash;

// TMJ Engineering's chart, as printed from Sage (Import/Chart of Accounts
// 09252026.pdf). Seeds an empty chart, or tops one up by number.
export const DEFAULT_ACCOUNTS = [
  ["1010", "Cash on Hand", "Cash"],
  ["1020", "Checking Account", "Cash"],
  ["1100", "Accounts Receivable", "Accounts Receivable"],
  ["1150", "Allowance for Doubtful Account", "Accounts Receivable"],
  ["1200", "Inventory", "Inventory"],
  ["1400", "Prepaid Expenses", "Other Current Assets"],
  ["1500", "Property and Equipment", "Fixed Assets"],
  ["1900", "Accum. Depreciation - Prop & Equip", "Accumulated Depreciation"],
  ["2000", "Accounts Payable", "Accounts Payable"],
  ["2310", "Sales Tax Payable", "Other Current Liabilities"],
  ["2320", "Deductions Payable", "Other Current Liabilities"],
  ["2330", "Federal Payroll Taxes Payable", "Other Current Liabilities"],
  ["2340", "FUTA Payable", "Other Current Liabilities"],
  ["2350", "State Payroll Taxes Payable", "Other Current Liabilities"],
  ["2360", "SUTA Payable", "Other Current Liabilities"],
  ["2370", "Local Taxes Payable", "Other Current Liabilities"],
  ["2380", "Income Taxes Payable", "Other Current Liabilities"],
  ["2390", "401K Payable", "Other Current Liabilities"],
  ["2400", "Customer Deposits", "Other Current Liabilities"],
  ["2500", "Current Portion Long-Term Debt", "Other Current Liabilities"],
  ["2700", "Long Term Debt-Noncurrent", "Long Term Liabilities"],
  ["3909", "Beginning Balance Equity", "Equity-doesn't close"],
  ["3910", "Retained Earnings", "Equity-Retained Earnings"],
  ["3920", "Paid-in Capital", "Equity-doesn't close"],
  ["3930", "Common Stock", "Equity-doesn't close"],
  ["3940", "Distributions", "Equity-gets closed"],
  ["4000", "Professional Fees", "Income"],
  ["4050", "Sales of Materials", "Income"],
  ["4100", "Interest Income", "Income"],
  ["4200", "Finance Charge Income", "Income"],
  ["4300", "Other Income", "Income"],
  ["4900", "Sales/Fees Discounts", "Income"],
  ["5000", "Cost of Sales", "Cost of Sales"],
  ["5400", "Cost of Sales-Salary & Wage", "Cost of Sales"],
  ["5900", "Inventory Adjustments", "Cost of Sales"],
  ["6000", "Wages Expense", "Expenses"],
  ["6050", "Employee Benefit Programs Exp", "Expenses"],
  ["6060", "401K Employer", "Expenses"],
  ["6100", "Payroll Tax Expense", "Expenses"],
  ["6150", "Bad Debt Expense", "Expenses"],
  ["6200", "Income Tax Expense", "Expenses"],
  ["6250", "Other Taxes Expense", "Expenses"],
  ["6300", "Rent or Lease Expense", "Expenses"],
  ["6350", "Maintenance & Repairs Expense", "Expenses"],
  ["6400", "Utilities Expense", "Expenses"],
  ["6450", "Office Supplies Expense", "Expenses"],
  ["6500", "Telephone Expense", "Expenses"],
  ["6550", "Other Office Expense", "Expenses"],
  ["6560", "Legal Fees", "Expenses"],
  ["6570", "Software Purchases", "Expenses"],
  ["6600", "Advertising Expense", "Expenses"],
  ["6610", "Charitable Contributions", "Expenses"],
  ["6650", "Commissions and Fees Expense", "Expenses"],
  ["6700", "Engineering Support Expense", "Expenses"],
  ["6710", "Travel Expenses", "Expenses"],
  ["6720", "Guest Entertainment", "Expenses"],
  ["6750", "Control Panel Expenses", "Expenses"],
  ["6751", "Material Expense", "Expenses"],
  ["6760", "Field Wiring Expense", "Expenses"],
  ["6800", "Freight Expense", "Expenses"],
  ["6850", "Service Charge Expense", "Expenses"],
  ["6900", "Purchase Disc-Expense Items", "Expenses"],
  ["6950", "Insurance Expense", "Expenses"],
  ["7050", "Depreciation Expense", "Expenses"],
  ["7100", "Gain/Loss - Sale of Assets Exp", "Expenses"],
].map(([number, name, type], i) => ({ number, name, type, active: true, sort: i }));
