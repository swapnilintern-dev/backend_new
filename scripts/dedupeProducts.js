// =============================================================================
// One-time cleanup: remove duplicate catalogue products.
//
// The Life Saving and Tablet sheets were each bulk-uploaded TWICE, leaving every
// one of those medicines in the catalogue two times (264 identical pairs), so
// vendors saw each one listed twice.
//
// For every group of products sharing the same title (trimmed, case-insensitive)
// this keeps the OLDEST document and removes the others — but ONLY a copy that:
//   • is identical to the kept one in every business field, and
//   • is not referenced anywhere: no order line, vendor cart, saved item,
//     outlet stock row or product batch points at it.
// Anything that fails either check is left alone and reported, never guessed.
//
// SAFE BY DEFAULT: without --apply it only reports what it WOULD do.
//
//   node scripts/dedupeProducts.js            # dry run — changes nothing
//   node scripts/dedupeProducts.js --apply    # backs up, then deletes
//
// Every removed document is written to scripts/backups/ first, so the run can
// be reversed with mongoimport / insertMany if ever needed.
// =============================================================================

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import Product from "../model/productModel.js";

const APPLY = process.argv.includes("--apply");
const here = path.dirname(fileURLToPath(import.meta.url));

/** Fields that do NOT make two copies different. */
const IGNORED = new Set(["_id", "id", "createdAt", "updatedAt", "__v", "isExpiringSoon"]);

/** Canonical form of a document for comparison: keys sorted, and every `_id`
 *  dropped at ANY depth (image sub-documents get their own fresh _id on each
 *  insert, so two identical uploads never share those). */
const canonical = (v, top = false) => {
  if (Array.isArray(v)) return v.map((x) => canonical(x));
  if (v && typeof v === "object" && !(v instanceof Date) && v._bsontype !== "ObjectId") {
    return Object.keys(v)
      .filter((k) => k !== "_id" && !(top && IGNORED.has(k)))
      .sort()
      .map((k) => [k, canonical(v[k])]);
  }
  return v;
};
const fingerprint = (doc) => JSON.stringify(canonical(doc, true));

/**
 * Every ObjectId stored ANYWHERE in the database outside the products
 * collection — orders, vendor/outlet carts, saved items, stock, batches,
 * invoices, notifications, and any collection added later.
 *
 * Deliberately a full scan rather than a list of known fields: a reference we
 * forgot to list would otherwise let a product that is still in use be deleted.
 */
const collectReferencedIds = async (db) => {
  const ids = new Set();
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (v instanceof mongoose.Types.ObjectId || v?._bsontype === "ObjectId") {
      ids.add(String(v));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      Object.values(v).forEach(walk);
    }
  };

  for (const { name } of await db.listCollections().toArray()) {
    if (name === Product.collection.collectionName || name.startsWith("system.")) continue;
    for await (const doc of db.collection(name).find({})) walk(doc);
  }
  return ids;
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_UR);
  const db = mongoose.connection.db;

  console.log(APPLY ? "MODE: APPLY — duplicates WILL be deleted\n" : "MODE: DRY RUN — nothing will change\n");

  const groups = await Product.aggregate([
    {
      $group: {
        _id: { $toLower: { $trim: { input: "$title" } } },
        n: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { n: { $gt: 1 } } },
  ]);

  const referenced = await collectReferencedIds(db);

  const toDelete = [];
  const skipped = [];

  for (const g of groups) {
    // Oldest first: ties on createdAt fall back to _id, which is time-ordered.
    const docs = await Product.find({ _id: { $in: g.ids } })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    const [keep, ...extras] = docs;
    const keepPrint = fingerprint(keep);

    for (const extra of extras) {
      if (referenced.has(String(extra._id))) {
        skipped.push({ title: extra.title, id: String(extra._id), reason: "referenced by an order / cart / stock / batch" });
      } else if (fingerprint(extra) !== keepPrint) {
        skipped.push({ title: extra.title, id: String(extra._id), reason: "differs from the kept copy" });
      } else {
        toDelete.push(extra);
      }
    }
  }

  console.log(`Duplicate title groups : ${groups.length}`);
  console.log(`Copies to remove       : ${toDelete.length}`);
  console.log(`Copies left alone      : ${skipped.length}`);
  skipped.slice(0, 20).forEach((s) => console.log(`   - "${s.title}" (${s.id}): ${s.reason}`));

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to delete.");
    await mongoose.disconnect();
    return;
  }

  if (!toDelete.length) {
    console.log("\nNothing to delete.");
    await mongoose.disconnect();
    return;
  }

  // Back up BEFORE deleting.
  const dir = path.join(here, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `deleted-duplicate-products-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(toDelete, null, 2));
  console.log(`\nBackup written: ${file}`);

  // Re-check references at the last moment: a vendor could have added one of
  // these to a cart since the scan above.
  const latest = await collectReferencedIds(db);
  const finalIds = toDelete.map((d) => d._id).filter((id) => !latest.has(String(id)));
  if (finalIds.length !== toDelete.length) {
    console.log(`  ${toDelete.length - finalIds.length} copies became referenced during the run — kept.`);
  }

  const res = await Product.deleteMany({ _id: { $in: finalIds } });
  console.log(`Deleted: ${res.deletedCount}`);
  console.log(`Products remaining: ${await Product.countDocuments()}`);

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error("Dedupe failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
