import { useState } from "react";
import { rangeFor, defaultCustom } from "../lib/dateRanges.js";
import FilterBar from "./FilterBar.jsx";

// One date-range + party filter, wired up for a list view in three lines:
//
//   const f = useFilters({ partyKind: "customer", contacts: db.contacts });
//   ... {f.bar()} ...
//   ... db.invoices.filter(i => f.keep(i.date, i.customerId)) ...
//
// Lists default to All Time so the view opens showing everything, the way it
// did before there were filters.
export function useFilters({ partyKind, contacts, initialPreset = "all" } = {}) {
  const [preset, setPreset] = useState(initialPreset);
  const [custom, setCustom] = useState(defaultCustom);
  const [partyId, setPartyId] = useState("");
  const [from, to] = rangeFor(preset, custom);
  const active = preset !== initialPreset || !!partyId;
  const reset = () => { setPreset(initialPreset); setPartyId(""); };

  // Keep a row when its date falls in the range and it belongs to the party.
  // Pass party = undefined on views with no party filter.
  const keep = (date, party) => {
    if (from && (date || "") < from) return false;
    if (to && (date || "") > to) return false;
    if (partyId && party !== partyId) return false;
    return true;
  };

  const bar = (children) => <FilterBar
    preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom}
    partyKind={partyKind} partyId={partyId} onParty={setPartyId} contacts={contacts}>
    {children}
    {active && <button className="btn sm" onClick={reset}>Clear</button>}
  </FilterBar>;

  return { preset, custom, partyId, from, to, active, reset, keep, bar };
}
