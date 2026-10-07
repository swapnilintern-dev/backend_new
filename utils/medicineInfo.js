// =============================================================================
// Medicine information fields — ONE set of rules for every write path.
//
// composition / uses / storage / precautions / directions are plain text, and
// sideEffects is a LIST (the company's product sheets carry one side effect per
// row, up to ~22 per medicine, and the app renders them as bullets).
//
// These are display-only fields. Nothing here touches price, stock, batches or
// discounts — the add / update / bulk-upload / import paths all read through
// this module so the four can never normalise the same value differently.
// =============================================================================

/** The plain-text fields, in the order the app shows them. */
export const MEDICINE_TEXT_FIELDS = [
  "composition",
  "uses",
  "storage",
  "precautions",
  "directions",
];

/** Upper bound on side-effect entries kept per medicine. The largest real
 *  product has 22; this only stops a malformed upload from storing thousands. */
const MAX_SIDE_EFFECTS = 60;

/** Collapses runs of whitespace (Excel cells often carry line breaks and
 *  doubled spaces) and trims the ends. */
export const cleanText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Normalises side effects into a clean, de-duplicated array.
 *
 * Accepts:
 *   • an array                         (JSON body, or the import script)
 *   • a JSON-array string  '["a","b"]' (multipart forms send everything as text)
 *   • a string split on NEW LINES, ";" or "|"
 *
 * Deliberately NOT split on commas: entries such as "Pain, redness and swelling
 * at the injection site" are a single side effect, and cutting them apart
 * would turn one sentence into three meaningless fragments.
 */
export const parseSideEffects = (value) => {
  if (value === undefined || value === null) return [];

  let items;
  if (Array.isArray(value)) {
    items = value;
  } else {
    const text = String(value).trim();
    if (!text) return [];

    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        // Not JSON after all — fall through to plain-text splitting.
      }
    }
    if (!items) items = text.split(/\r?\n|;|\|/);
  }

  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const item = cleanText(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue; // case-insensitive de-duplication
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_SIDE_EFFECTS) break;
  }
  return out;
};

/**
 * Picks the medicine-info fields out of a request body.
 *
 * Only keys that are PRESENT in the body appear in the result, so an update
 * that does not mention a field leaves the stored value untouched. An empty
 * string IS present, and clears the field — that is how an editor removes text.
 */
export const pickMedicineInfo = (body = {}) => {
  const out = {};
  for (const key of MEDICINE_TEXT_FIELDS) {
    if (body[key] !== undefined) out[key] = cleanText(body[key]);
  }
  if (body.sideEffects !== undefined) {
    out.sideEffects = parseSideEffects(body.sideEffects);
  }
  return out;
};

// =============================================================================
// Spreadsheet helpers — shared by the bulk upload and the one-time importer.
//
// The company's product sheets ship in TWO parts:
//   • a product sheet  — one row per medicine, with Composition / Use of Product
//                        / Storage columns;
//   • a details sheet  — LONG format, one row per (medicine, detail):
//                          vProdID | vName | detail_type | detail
//                        where detail_type is "Side-Effects" (many rows),
//                        "Precautions" and "Usage Direction".
// =============================================================================

/** Lower-cases and strips everything but letters/digits, so "Storage ",
 *  "Use of Product" and "use_of_product" all compare equal. */
const normKey = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header aliases for the product-sheet columns, normalised. */
const PRODUCT_SHEET_ALIASES = {
  composition: ["composition", "saltcomposition"],
  uses: ["uses", "useofproduct"],
  storage: ["storage"],
  precautions: ["precautions", "precaution"],
  directions: ["directions", "usagedirection", "directionsforuse"],
  sideEffects: ["sideeffects", "sideeffect"],
};

/**
 * The sheet range starting at `offset` rows into the sheet's own used range.
 *
 * NOT `{ range: offset }`: a numeric range is an ABSOLUTE row index, while
 * `header: 1` row indexes are relative to the sheet's "!ref". The two only line
 * up when the used range starts at A1 — and in one of the company files it
 * starts at A2, so a numeric range reads the empty row above the real header
 * and silently returns nothing.
 */
const rangeFrom = (XLSX, sheet, offset) => {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  range.s.r += offset;
  return range;
};

/**
 * Reads the first sheet-like table whose header row contains `mustHave` (all
 * normalised keys), searching the first few rows for it. Returns [] when no
 * such header exists.
 */
export const readTableWithHeader = (XLSX, sheet, mustHave) => {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = raw.slice(0, 10).findIndex((cells) => {
    const keys = cells.map(normKey);
    return mustHave.every((k) => keys.includes(k));
  });
  if (headerRow < 0) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    range: rangeFrom(XLSX, sheet, headerRow),
    defval: "",
  });
};

/** Reads a cell by any of its aliases, tolerating stray spaces/case in headers. */
const readAliased = (row, aliases) => {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normKey(key))) return value;
  }
  return undefined;
};

/** Maps a details-sheet `detail_type` onto a field, or null if unrecognised.
 *  Both "Precautions" and the singular "Precaution" occur in the real data. */
export const detailTypeToField = (type) => {
  const t = normKey(type);
  if (t === "sideeffects" || t === "sideeffect") return "sideEffects";
  if (t === "precautions" || t === "precaution") return "precautions";
  if (["usagedirection", "usagedirections", "directions", "direction"].includes(t)) {
    return "directions";
  }
  return null;
};

/** The medicine-info fields carried directly on a product-sheet row. Only
 *  columns that exist in the sheet are returned. */
export const infoFromProductRow = (row) => {
  const out = {};
  for (const [field, aliases] of Object.entries(PRODUCT_SHEET_ALIASES)) {
    const value = readAliased(row, aliases);
    if (value === undefined) continue;
    out[field] = field === "sideEffects" ? parseSideEffects(value) : cleanText(value);
  }
  return out;
};

/** The id / name a row is matched on, normalised. */
export const productIdOf = (row) =>
  normKey(readAliased(row, ["productid", "vprodid", "prodid"]));
export const productNameOf = (row) =>
  cleanText(readAliased(row, ["title", "product", "productname", "vname"])).toLowerCase();

/**
 * Collects every details sheet in a workbook into a lookup.
 *
 * A sheet counts as a details sheet if a row near the top carries the vProdID
 * and detail_type headers. The header is NOT always the first row — one of the
 * company files has a blank row above it — so it is located, not assumed.
 *
 * Returns { byId, byName }: Maps to
 *   { sideEffects: string[], precautions: string[], directions: string[] }.
 */
export const readDetailSheets = (XLSX, workbook, skipSheet) => {
  const byId = new Map();
  const byName = new Map();

  for (const sheetName of workbook.SheetNames) {
    if (sheetName === skipSheet) continue;
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const headerRow = raw.slice(0, 10).findIndex((cells) => {
      const keys = cells.map(normKey);
      return keys.includes("vprodid") && keys.includes("detailtype");
    });
    if (headerRow < 0) continue; // not a details sheet

    const rows = XLSX.utils.sheet_to_json(sheet, {
      range: rangeFrom(XLSX, sheet, headerRow),
      defval: "",
    });

    // Rows whose id AND name cells were left blank during data entry. In the
    // real files these sit in the middle of one medicine's block (e.g. two of
    // Mycofit-S 360's side effects), so a blank row INHERITS the product only
    // when the nearest rows above and below both belong to the SAME product.
    // At a boundary between two products it is ambiguous and is skipped rather
    // than guessed.
    const keyOf = (r) => ({ id: productIdOf(r), name: productNameOf(r) });
    const isBlank = (k) => !k.id && !k.name;
    const keys = rows.map(keyOf);
    const resolved = keys.map((k, i) => {
      if (!isBlank(k)) return k;
      let up = i - 1;
      while (up >= 0 && isBlank(keys[up])) up--;
      let down = i + 1;
      while (down < keys.length && isBlank(keys[down])) down++;
      const above = keys[up];
      const below = keys[down];
      if (above && below && above.id === below.id && above.name === below.name) return above;
      return k; // ambiguous — stays blank and is skipped below
    });

    rows.forEach((row, i) => {
      const field = detailTypeToField(readAliased(row, ["detailtype"]));
      const text = cleanText(readAliased(row, ["detail", "details"]));
      if (!field || !text) return;

      const { id, name } = resolved[i];
      for (const [map, key] of [[byId, id], [byName, name]]) {
        if (!key) continue;
        if (!map.has(key)) map.set(key, { sideEffects: [], precautions: [], directions: [] });
        map.get(key)[field].push(text);
      }
    });
  }
  return { byId, byName };
};

/**
 * Folds a details-sheet bucket into product fields: side effects become a
 * de-duplicated list; precautions and directions (normally one row each) are
 * joined into a single paragraph.
 */
export const infoFromDetails = (bucket) => {
  if (!bucket) return {};
  const out = {};
  if (bucket.sideEffects.length) out.sideEffects = parseSideEffects(bucket.sideEffects);
  if (bucket.precautions.length) out.precautions = cleanText(bucket.precautions.join(" "));
  if (bucket.directions.length) out.directions = cleanText(bucket.directions.join(" "));
  return out;
};
