// =============================================================================
// Fill composition / uses / storage / sideEffects / precautions / directions on
// products that ALREADY exist, from the company's product-details workbooks.
//
// UPDATE-ONLY:
//   • never inserts a product — a sheet row with no matching product is only
//     reported (e.g. the Vaccine sheet, whose products are not uploaded yet);
//   • writes ONLY the six medicine-info fields — price, MRP, stock, batches,
//     GST, discounts, doctor/wholesaler rates, images etc. are never touched;
//   • an empty Excel cell never blanks a value that is already stored.
//
// Products are matched on their title (trimmed, case-insensitive, whitespace
// collapsed). Re-running is safe: values that already match are left alone, so
// a second run reports 0 changes.
//
// SAFE BY DEFAULT: without --apply it only reports what it WOULD change.
//
//   node scripts/importMedicineInfo.js                       # dry run
//   node scripts/importMedicineInfo.js --apply               # backs up, then writes
//   node scripts/importMedicineInfo.js --apply a.xlsx b.xlsx # other workbooks
//
// The previous values of every product it changes are written to
// scripts/backups/ first.
// =============================================================================

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import XLSX from "xlsx";

import Product from "../model/productModel.js";
import {
  MEDICINE_TEXT_FIELDS,
  cleanText,
  infoFromDetails,
  infoFromProductRow,
  productIdOf,
  productNameOf,
  readDetailSheets,
  readTableWithHeader,
} from "../utils/medicineInfo.js";

const APPLY = process.argv.includes("--apply");
const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_FILES = [
  "Product Details Final (Life Saving).xlsx",
  "Product Details Final (Tablet Groups) .xlsx",
  "Products Details Final (Vaccine).xlsx",
].map((f) => path.join(os.homedir(), "Downloads", f));

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FILES = argFiles.length ? argFiles : DEFAULT_FILES;

const INFO_FIELDS = [...MEDICINE_TEXT_FIELDS, "sideEffects"];
const titleKey = (t) => cleanText(t).toLowerCase();

/** Reads one workbook into Map<titleKey, info>, keeping only non-empty values. */
const readWorkbook = (file) => {
  const workbook = XLSX.readFile(file);
  let productSheet = null;
  let rows = [];
  for (const name of workbook.SheetNames) {
    rows = readTableWithHeader(XLSX, workbook.Sheets[name], ["productid", "product"]);
    if (rows.length) {
      productSheet = name;
      break;
    }
  }
  if (!productSheet) throw new Error(`No product sheet (Product ID + Product columns) in ${file}`);

  const details = readDetailSheets(XLSX, workbook, productSheet);
  const byTitle = new Map();
  const conflicts = [];

  for (const row of rows) {
    const key = productNameOf(row);
    if (!key) continue;

    const info = {
      ...infoFromProductRow(row),
      ...infoFromDetails(details.byId.get(productIdOf(row)) || details.byName.get(key)),
    };
    // Drop empties: a blank cell must never wipe stored data.
    for (const f of INFO_FIELDS) {
      const v = info[f];
      if (v === undefined || (Array.isArray(v) ? !v.length : !v)) delete info[f];
    }

    if (byTitle.has(key)) {
      if (JSON.stringify(byTitle.get(key)) !== JSON.stringify(info)) conflicts.push(key);
      continue; // first row wins; a conflicting repeat is reported, not merged
    }
    byTitle.set(key, info);
  }
  return { productSheet, byTitle, conflicts };
};

const sameValue = (a, b) => JSON.stringify(a ?? (Array.isArray(b) ? [] : "")) === JSON.stringify(b);

const main = async () => {
  console.log(APPLY ? "MODE: APPLY — products WILL be updated\n" : "MODE: DRY RUN — nothing will change\n");

  // 1. Read every workbook first, so a bad file aborts before any write.
  const sheetInfo = new Map(); // titleKey -> { info, file }
  const crossFile = [];
  for (const file of FILES) {
    if (!fs.existsSync(file)) {
      console.log(`SKIP (file not found): ${file}`);
      continue;
    }
    const { productSheet, byTitle, conflicts } = readWorkbook(file);
    console.log(`${path.basename(file)} → sheet "${productSheet}": ${byTitle.size} products`);
    if (conflicts.length) console.log(`   ${conflicts.length} titles repeated with different data (first kept): ${conflicts.slice(0, 5).join(", ")}`);
    for (const [key, info] of byTitle) {
      if (sheetInfo.has(key)) {
        crossFile.push(key);
        continue;
      }
      sheetInfo.set(key, { info, file: path.basename(file) });
    }
  }
  if (crossFile.length) console.log(`\n${crossFile.length} titles appear in more than one file (first file kept).`);

  // 2. Match against the catalogue.
  await mongoose.connect(process.env.MONGO_UR);
  const products = await Product.find({}, { title: 1, ...Object.fromEntries(INFO_FIELDS.map((f) => [f, 1])) }).lean();
  const byKey = new Map();
  for (const p of products) {
    const k = titleKey(p.title);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }

  const ops = [];
  const backup = [];
  const unmatched = {};
  const fieldCounts = Object.fromEntries(INFO_FIELDS.map((f) => [f, 0]));
  let matched = 0;
  let alreadyUpToDate = 0;

  for (const [key, { info, file }] of sheetInfo) {
    const targets = byKey.get(key);
    if (!targets) {
      (unmatched[file] ||= []).push(key);
      continue;
    }
    matched++;
    for (const p of targets) {
      const set = {};
      for (const [f, v] of Object.entries(info)) {
        if (!sameValue(p[f], v)) set[f] = v;
      }
      if (!Object.keys(set).length) {
        alreadyUpToDate++;
        continue;
      }
      Object.keys(set).forEach((f) => fieldCounts[f]++);
      backup.push({ _id: p._id, title: p.title, ...Object.fromEntries(INFO_FIELDS.map((f) => [f, p[f]])) });
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: set } } });
    }
  }

  console.log(`\nSheet products        : ${sheetInfo.size}`);
  console.log(`Matched to catalogue  : ${matched}`);
  console.log(`Products to update    : ${ops.length}`);
  console.log(`Already up to date    : ${alreadyUpToDate}`);
  console.log(`Field changes         : ${INFO_FIELDS.map((f) => `${f} ${fieldCounts[f]}`).join(", ")}`);
  for (const [file, keys] of Object.entries(unmatched)) {
    console.log(`Not in catalogue (${file}): ${keys.length} — skipped, nothing inserted`);
    keys.slice(0, 5).forEach((k) => console.log(`   - ${k}`));
    if (keys.length > 5) console.log(`   … and ${keys.length - 5} more`);
  }

  if (!APPLY || !ops.length) {
    console.log(APPLY ? "\nNothing to update." : "\nDry run only. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const dir = path.join(here, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backupFile = path.join(dir, `medicine-info-before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${backupFile}`);

  // Native driver write: sets ONLY the listed fields and leaves every other
  // field — including updatedAt — exactly as it was.
  const res = await Product.collection.bulkWrite(ops, { ordered: false });
  console.log(`Updated: ${res.modifiedCount}`);

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error("Import failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
