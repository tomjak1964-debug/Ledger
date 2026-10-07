#!/usr/bin/env python3
"""Turn the shop's job-tracking sheet (VENTURE_SECONDARY_ESTIMATES_*.xlsx) into
a SQL data fix that gives each matching sales order what the sheet knew about
it: the job number, the description, the specs it was priced from, the
proposal budget, and the actual costs the sheet carried (migration 028).

    python3 tools/job-sheet-sql.py VENTURE_SECONDARY_ESTIMATES_261007.xlsx [--only TMJ880,TMJ881,...] > fix.sql

--only keeps the fix to the sales orders Ledger has (list them with
`select string_agg(number, ',') from sales_orders`), so it isn't hundreds of
statements that match nothing.

A sheet row matches a sales order by its SO number (column E, "914" is
TMJ914), or by PO number (column C) when E is blank. Rows that match nothing
in Ledger simply update nothing. The fix is safe to re-run: a job number or
description typed in Ledger is kept, specs and budget are only filled when
empty, and the sheet's cost rows are replaced rather than added twice.

Columns read (row 3 is the heading, data from row 4):
  A job number  B fixture (F1, LH…)  C PO number  D PO amount  E SO number
  T description
  U fixture type  V sonic gen  W horns  X panel size  Y PLC  Z program
  AA I/O blocks  AB proposal date (Excel serial)  AD cameras
  AE–AM the proposal's price lines -> sales_orders.budget
  L panel cost  N HMI/bingo board  O base cables  P I/O blocks  Q Data National
    material -> job_costs (source 'sheet'); M (panel invoice) is not a cost.
Only the standard library is used (an .xlsx is a zip of XML).
"""
import datetime, html, json, re, sys, zipfile

BUDGET = [("AE", "eng", "Engineering / Start-Up"), ("AF", "dnCheckout", "Data National Checkout"),
          ("AG", "panel", "Control Panel"), ("AH", "blockIo", "Block I/O"),
          ("AI", "dnMaterial", "Data National Material"), ("AJ", "fieldWiring", "Field Wiring"),
          ("AK", "runoff", "Run Off Support"), ("AL", "remotePanels", "Remote Panels"),
          ("AM", "remoteHmi", "Remote HMI")]
SPECS = [("U", "machineType", False), ("V", "generators", True), ("W", "horns", True),
         ("X", "panelSize", False), ("Y", "plc", False), ("Z", "program", False),
         ("AA", "ioBlocks", True), ("AD", "cameras", True)]
COSTS = [("L", "panel", "Panel cost"), ("N", "hmi", "Bingo board HMI"), ("O", "cables", "Base cables"),
         ("P", "ioBlocks", "I/O blocks"), ("Q", "dnMaterial", "Data National material")]


def read_sheet(path):
    z = zipfile.ZipFile(path)
    shared = [html.unescape("".join(re.findall(r"<t[^>]*>([^<]*)</t>", si)))
              for si in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
    rows = {}
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    for body in re.findall(r"<row [^>]*>(.*?)</row>", sheet, re.S):
        for attrs, inner in re.findall(r"<c ([^>]*?)(?:/>|>(.*?)</c>)", body, re.S):
            col, row = re.search(r'r="([A-Z]+)(\d+)"', attrs).groups()
            v = re.search(r"<v>([^<]*)</v>", inner or "")
            val = v.group(1) if v else ""
            if 't="s"' in attrs and val:
                val = shared[int(val)]
            inline = re.search(r"<is>.*?<t[^>]*>([^<]*)", inner or "", re.S)
            if inline:
                val = inline.group(1)
            rows.setdefault(int(row), {})[col] = html.unescape(val).strip()
    return rows


def num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def main(path, only=None):
    rows = read_sheet(path)
    jobs = {}   # one per SO number (or PO), the sheet's last row winning
    for r in sorted(rows):
        if r < 4:
            continue
        c = rows[r]
        so, po = c.get("E", ""), c.get("C", "")
        if not (so or po) or not (c.get("A") or c.get("T")):
            continue
        so_number = ("TMJ" + so) if re.fullmatch(r"\d+", so) else so
        job = c.get("A", "") + ("-" + c["B"] if c.get("B") else "")
        specs = {}
        for col, key, is_num in SPECS:
            v = c.get(col, "")
            if v not in ("", "0") or (is_num and v == "0" and key == "ioBlocks"):
                specs[key] = num(v) if is_num else v
        if c.get("AB", "").replace(".", "", 1).isdigit():
            specs["proposalDate"] = (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(c["AB"])))).isoformat()
        budget = [{"key": k, "label": label, "amount": num(c.get(col))} for col, k, label in BUDGET if num(c.get(col))]
        costs = [(k, label, num(c.get(col))) for col, k, label in COSTS if num(c.get(col))]
        jobs[so_number or "PO:" + po] = dict(row=r, so=so_number, po=po, job=job, desc=c.get("T", ""),
                                            amount=num(c.get("D")), specs=specs, budget=budget, costs=costs)

    if only:
        jobs = {k: j for k, j in jobs.items() if j["so"] in only}
    out = ["-- Job-tracking sheet -> sales orders (migration 028). Generated by tools/job-sheet-sql.py",
           f"-- from {path.split('/')[-1]}; {len(jobs)} sheet jobs. Apply in one transaction.", ""]
    for j in jobs.values():
        where = f"number = {q(j['so'])}" if j["so"] else f"po_number = {q(j['po'])}"
        out.append(f"-- sheet row {j['row']}: {j['job']} · {j['desc']} · PO {j['po']} · {j['amount']:.2f}")
        out.append(
            "update sales_orders set "
            f"job_number = coalesce(nullif(job_number, ''), {q(j['job'])}), "
            f"description = coalesce(nullif(description, ''), {q(j['desc'])}), "
            f"specs = case when specs = '{{}}'::jsonb then {q(json.dumps(j['specs']))}::jsonb else specs end, "
            f"budget = case when budget = '[]'::jsonb then {q(json.dumps(j['budget']))}::jsonb else budget end "
            f"where {where};")
        out.append(f"delete from job_costs where source = 'sheet' and sales_order_id in (select id from sales_orders where {where});")
        for k, label, amount in j["costs"]:
            out.append("insert into job_costs (org_id, sales_order_id, date, category, description, amount, source) "
                       f"select org_id, id, coalesce(date, current_date), {q(k)}, {q(label + ' (from the job sheet)')}, {amount:.2f}, 'sheet' "
                       f"from sales_orders where {where};")
        out.append("")
    print("\n".join(out))


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        i = args.index("--only")
        only = set(x.strip() for x in args[i + 1].split(",") if x.strip())
        del args[i:i + 2]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0], only)
