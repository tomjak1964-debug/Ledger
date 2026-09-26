// Reading a quote chart — the spreadsheet the shop keeps one row per machine,
// the source the proposals are written from. It takes the file as it comes off
// the estimator's desk (.xlsx straight from Excel, a .csv, or rows pasted out
// of a sheet) and hands back one record per machine, already in the shape a
// proposal wants.
//
// The .xlsx reader is the same trick tools/reconcile.mjs uses: an .xlsx is a
// zip of XML, and the browser will inflate it (DecompressionStream), so there
// is no library to add and nothing to keep in step with one.

/* ---------------- .xlsx: just enough of the format ---------------- */

const dv = b => new DataView(b.buffer, b.byteOffset, b.byteLength);

// Walk the local file headers. Good enough for what Excel writes, and it never
// has to seek the central directory.
async function unzip(buf) {
  const b = new Uint8Array(buf), d = dv(b), files = new Map();
  let i = 0;
  while (i + 4 <= b.length && d.getUint32(i, true) === 0x04034b50) {
    const method = d.getUint16(i + 8, true);
    let size = d.getUint32(i + 18, true);
    const nameLen = d.getUint16(i + 26, true), extraLen = d.getUint16(i + 28, true);
    const name = new TextDecoder().decode(b.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extraLen;
    if ((d.getUint16(i + 6, true) & 0x08) && !size) {
      // Sizes live in the trailing descriptor — find it by the next signature.
      let j = start;
      while (j + 4 <= b.length && d.getUint32(j, true) !== 0x08074b50) j++;
      size = j - start;
      files.set(name, await inflate(b.subarray(start, j), method));
      i = j + 16;
      continue;
    }
    files.set(name, await inflate(b.subarray(start, start + size), method));
    i = start + size;
  }
  return files;
}

async function inflate(bytes, method) {
  if (method === 0) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const textOf = (xml, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>|<${tag}[^>]*/>`, "g");
  let m;
  while ((m = re.exec(xml))) out.push(m[1] ?? "");
  return out;
};
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const colOf = ref => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// → array of rows, each an array of cell strings, blanks included.
export async function parseXlsx(buf) {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const get = name => (files.has(name) ? dec.decode(files.get(name)) : "");
  const shared = textOf(get("xl/sharedStrings.xml"), "si")
    .map(si => unesc(textOf(si, "t").join("")));
  const sheetName = [...files.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("No worksheet found in that file.");
  const sheet = dec.decode(files.get(sheetName));
  const rows = [];
  for (const row of sheet.match(/<row[\s\S]*?<\/row>|<row[^>]*\/>/g) || []) {
    const cells = [];
    for (const m of row.matchAll(/<c ([^>]*?)\/>|<c ([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = m[1] || m[2] || "", body = m[3] || "";
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      let val = "";
      if (type === "inlineStr") val = unesc(textOf(body, "t").join(""));
      else {
        const v = textOf(body, "v")[0];
        if (v != null) val = type === "s" ? (shared[+v] ?? "") : unesc(v);
      }
      if (ref) cells[colOf(ref)] = val; else cells.push(val);
    }
    rows.push([...cells].map(c => c ?? ""));
  }
  return rows;
}

/* ---------------- pasted rows / .csv ---------------- */

// Tabs win when the text has any, which is what pasting out of Excel gives.
export function parseDelimited(text) {
  const sep = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\r") { /* CRLF */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function readChartFile(file) {
  if (/\.xlsx?$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  return parseDelimited(await file.text());
}

/* ---------------- chart → proposal records ---------------- */

const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Every column the chart carries, by its heading. Anything else is ignored —
// the chart has working columns (the weighted point count and its division)
// that the app recomputes itself.
const COLUMNS = {
  // Deliberately no bare "quote": the chart also has an empty QUOTE column
  // (the quoted dollar figure), and it would otherwise blank the quote number.
  quotenumber: "quoteNumber", quoteno: "quoteNumber",
  jobnumber: "jobNumber", jobno: "jobNumber", job: "jobNumber",
  description: "description", part: "description",
  enduser: "endUser", customer: "endUser",
  location: "location", plant: "location",
  type: "typeName", machinetype: "typeName",
  nests: "nests", generators: "generators", sonicgenerators: "generators", welds: "welds",
  pp: "pp", pickpoints: "pp", clamps: "clamps", clips: "clips", tabs: "tabs",
  shuttle: "shuttle", shuttles: "shuttle", platen: "platen", platens: "platen",
  cameras: "cameras", ioblks: "ioBlocks", ioblocks: "ioBlocks", datanat: "dataNational",
  torque: "torque", torquetools: "torque", iolink: "ioLink", iolinkdevices: "ioLink",
};
const SPEC_KEYS = ["nests", "generators", "welds", "pp", "clamps", "clips", "tabs", "shuttle", "platen", "cameras", "torque", "ioLink"];

// The heading row is whichever row names the most columns we know — the chart
// may carry a title line above it.
function findHeader(rows) {
  let best = -1, bestHits = 0;
  rows.slice(0, 10).forEach((row, i) => {
    const hits = row.filter(c => COLUMNS[key(c)]).length;
    if (hits > bestHits) { bestHits = hits; best = i; }
  });
  return bestHits >= 3 ? best : -1;
}

const num = v => { const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };

// Rows → one record per machine. Rows with nothing identifying them (the blank
// totals line at the foot of a chart) are dropped.
export function mapChart(rows) {
  const h = findHeader(rows);
  if (h < 0) throw new Error("Couldn't find the heading row — it needs columns like Description, Type and Welds.");
  const cols = rows[h].map(c => COLUMNS[key(c)] || null);
  const out = [];
  for (const row of rows.slice(h + 1)) {
    const rec = { specs: {} };
    cols.forEach((field, i) => {
      if (!field) return;
      const raw = String(row[i] ?? "").trim();
      if (SPEC_KEYS.includes(field)) rec.specs[field] = num(raw);
      else if (field === "ioBlocks") rec.ioBlocks = raw === "" ? "" : num(raw);
      else if (field === "dataNational") rec.specs.dataNational = raw !== "" && num(raw) !== 0;
      else if (raw !== "" || rec[field] == null) rec[field] = raw;   // a later blank never wins
    });
    if (!rec.description && !rec.jobNumber && !rec.quoteNumber) continue;
    for (const k of SPEC_KEYS) rec.specs[k] = rec.specs[k] ?? 0;
    out.push(rec);
  }
  return out;
}

// "Small Sonuc" is how the chart spells it; match it to "Small Sonic".
export const typeKey = s => key(s).replace(/sonuc/g, "sonic");
export const matchMachineType = (name, machineTypes) => {
  const k = typeKey(name);
  if (!k) return null;
  return machineTypes.find(m => typeKey(m.name) === k)
    || machineTypes.find(m => typeKey(m.name).startsWith(k) || k.startsWith(typeKey(m.name)))
    || null;
};
