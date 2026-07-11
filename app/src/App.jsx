import { useState, useCallback } from "react";
import { supabase } from "./lib/supabaseClient.js";
import { useLedger } from "./lib/store.js";
import { cls } from "./lib/helpers.js";
import { invoiceStatus, paid } from "./calc/ledger.js";
import { Ico, ICONS } from "./components/ui.jsx";
import DocumentView from "./components/DocumentView.jsx";
import Dashboard from "./views/Dashboard.jsx";
import ReportsView from "./views/Reports.jsx";
import QuotesView from "./views/Quotes.jsx";
import SalesOrdersView from "./views/SalesOrders.jsx";
import InvoicesView from "./views/Invoices.jsx";
import ReceivablesView from "./views/Receivables.jsx";
import PayablesView from "./views/Payables.jsx";
import ExpensesView from "./views/Expenses.jsx";
import ContactsView from "./views/Contacts.jsx";
import CatalogView from "./views/Catalog.jsx";
import SettingsView from "./views/Settings.jsx";

const NAV = [
  {
    group: "Overview", items: [
      { k: "dashboard", label: "Dashboard", icon: ICONS.dash },
      { k: "reports", label: "Reports", icon: ICONS.reports },
    ]
  },
  {
    group: "Sell", items: [
      { k: "quotes", label: "Quotes", icon: ICONS.quote },
      { k: "salesOrders", label: "Sales Orders", icon: ICONS.so },
      { k: "invoices", label: "Invoices", icon: ICONS.inv },
      { k: "receivables", label: "Receivables", icon: ICONS.ar },
    ]
  },
  {
    group: "Spend", items: [
      { k: "payables", label: "Payables", icon: ICONS.ap },
      { k: "expenses", label: "Expenses", icon: ICONS.exp },
    ]
  },
  {
    group: "Records", items: [
      { k: "contacts", label: "Contacts", icon: ICONS.contacts },
      { k: "catalog", label: "Item Catalog", icon: ICONS.catalog },
      { k: "settings", label: "Settings", icon: ICONS.settings },
    ]
  },
];
const TITLES = {
  dashboard: ["Dashboard", "Your quote-to-cash pipeline at a glance"], quotes: ["Quotes", "Build, send, and track quotes"],
  salesOrders: ["Sales Orders", "Confirmed orders awaiting invoicing"], invoices: ["Invoices", "Issued invoices and payments"],
  receivables: ["Receivables", "What customers owe you, by age"], payables: ["Payables", "Vendor bills you owe"],
  expenses: ["Expenses", "Business spend by category"], contacts: ["Contacts", "Customers and vendors"],
  catalog: ["Item Catalog", "Reusable quote line items"], settings: ["Settings", "Company info and defaults"],
  reports: ["Reports", "P&L, sales tax, customers, and statements"]
};

export default function App({ session }) {
  const [view, setView] = useState("dashboard");
  const [doc, setDoc] = useState(null); // {kind,doc}
  const [toastMsg, setToastMsg] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const toast = useCallback((m) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600); }, []);
  const { db, loading, loadError, actions } = useLedger(session, toast);
  const openDoc = (kind, d) => setDoc({ kind, doc: d });
  const go = (v) => { setView(v); setNavOpen(false); window.scrollTo(0, 0); };

  if (loading) return <div className="boot">Loading your books…</div>;
  if (loadError || !db) return <div className="boot"><div>
    <p>Couldn't load your data: {loadError || "unknown error"}</p>
    <button className="btn primary" onClick={() => actions.reload()}>Try Again</button>
  </div></div>;

  const counts = {
    quotes: db.quotes.filter(q => q.status === "draft" || q.status === "sent").length,
    salesOrders: db.salesOrders.filter(s => s.status === "open").length,
    invoices: db.invoices.filter(i => ["unpaid", "partial", "overdue"].includes(invoiceStatus(i))).length,
    payables: db.bills.filter(b => ((Number(b.amount) || 0) - paid(b)) > 0.005).length,
  };

  const [t, sub] = TITLES[view];
  const props = { db, actions, toast, openDoc, go, session };

  return <div className="app">
    <div className={cls("sidebar", navOpen && "open")}>
      <div className="brand">
        <div className="brand-mark">L</div>
        <div><div className="brand-name">Ledger</div><div className="brand-sub">Quote → Cash</div></div>
      </div>
      <nav className="nav">
        {NAV.map(g => <div key={g.group}>
          <div className="nav-group">{g.group}</div>
          {g.items.map(it => <button key={it.k} className={cls("nav-item", view === it.k && "active")} onClick={() => go(it.k)}>
            <Ico d={it.icon} size={17} />{it.label}
            {counts[it.k] > 0 && <span className="count">{counts[it.k]}</span>}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-foot">
        <div>{db.settings.company || "Your Company"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.email}</span>
          <button className="link-btn" style={{ color: "#7FB0FF", flex: "none" }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </div>

    <div className="main">
      <div className="topbar">
        <button className="btn ghost icon menu-btn" onClick={() => setNavOpen(o => !o)}><Ico d={ICONS.menu} size={20} /></button>
        <div><h1>{t}</h1><div className="sub">{sub}</div></div>
        <div className="topbar-actions">
          <button className="btn ghost icon" title="Refresh from server" onClick={() => actions.reload()}><Ico d={ICONS.refresh} size={17} /></button>
        </div>
      </div>
      <div className="content">
        {view === "dashboard" && <Dashboard {...props} />}
        {view === "reports" && <ReportsView {...props} />}
        {view === "quotes" && <QuotesView {...props} />}
        {view === "salesOrders" && <SalesOrdersView {...props} />}
        {view === "invoices" && <InvoicesView {...props} />}
        {view === "receivables" && <ReceivablesView {...props} />}
        {view === "payables" && <PayablesView {...props} />}
        {view === "expenses" && <ExpensesView {...props} />}
        {view === "contacts" && <ContactsView {...props} />}
        {view === "catalog" && <CatalogView {...props} />}
        {view === "settings" && <SettingsView {...props} />}
      </div>
    </div>

    {doc && <DocumentView kind={doc.kind} doc={doc.doc}
      contact={db.contacts.find(c => c.id === doc.doc.customerId)} settings={db.settings} onClose={() => setDoc(null)} />}
    {toastMsg && <div className="toast"><Ico d={ICONS.check} size={16} />{toastMsg}</div>}
  </div>;
}
