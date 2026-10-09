// What a review task is about, read from its title (noteActivity in store.js
// writes them), and the page that shows it.
export function reviewTarget(t) {
  const s = t.title || "";
  if (/^New quote/.test(s)) return { kind: "Quote", page: "quotes" };
  if (/^New proposal/.test(s)) return { kind: "Proposal", page: "proposals" };
  if (/^Time logged/.test(s)) return { kind: "Time", page: "timeTracking" };
  if (/^Service report/.test(s)) return { kind: "Service report", page: "timeTracking" };
  if (/^New sales order/.test(s)) return { kind: "Sales order", page: "salesOrders" };
  return { kind: "Job", page: "jobs" };
}
export const isReviewTask = t => t.type === "review";
