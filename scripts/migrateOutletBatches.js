// ===========================================================================
// One-off migration: give every existing outlet-held stock a batch record, so
// outlet POS billing can allocate FEFO. WITHOUT losing any data.
//
//   Run from the `server/` directory:   node scripts/migrateOutletBatches.js
//
// Idempotent: an (outlet, product) that already has ≥1 outlet batch is skipped.
// Never deletes outletStock.quantity — it stays as the auto-synced total.
// ===========================================================================
import dotenv from "dotenv";
import mongoose from "mongoose";
import OutletStock from "../model/outletStockModel.js";
import OutletStockBatch from "../model/outletStockBatchModel.js";

dotenv.config();

async function main() {
    const uri = process.env.MONGO_UR;
    if (!uri) {
        console.error("MONGO_UR is not set — aborting.");
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("Connected. Scanning outlet stock…");

    // Populate the product so we can carry its (mirror) batch_no/exp_date onto
    // the legacy outlet batch — the best expiry we know for pre-existing stock.
    const rows = await OutletStock.find().populate("product").lean();
    let created = 0;
    let skipped = 0;
    let empty = 0;

    for (const r of rows) {
        const qty = Number(r.quantity) || 0;
        if (qty <= 0) {
            empty++;
            continue;
        }

        const already = await OutletStockBatch.countDocuments({
            outlet: r.outlet,
            product: r.product?._id || r.product,
        });
        if (already > 0) {
            skipped++;
            continue;
        }

        const p = r.product || {};
        await OutletStockBatch.create({
            outlet: r.outlet,
            product: p._id || r.product,
            batch_number:
                p.batch_no && String(p.batch_no).trim()
                    ? String(p.batch_no).trim()
                    : `LEGACY-${r._id}`,
            available_quantity: qty,
            expiry_date: p.exp_date || undefined,
            selling_price: Number(p.price) || 0,
            purchase_price: Number(p.mrp) || Number(p.price) || 0,
        });
        created++;
    }

    console.log(
        `Done. Outlet batches created: ${created}, skipped (already had batches): ${skipped}, zero-qty rows: ${empty}, total rows: ${rows.length}`
    );

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
