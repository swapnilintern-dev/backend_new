// ===========================================================================
// One-off migration: materialise each existing product's single batch into the
// new ProductBatch collection, WITHOUT losing any data.
//
//   Run from the `server/` directory:   node scripts/migrateBatches.js
//
// Idempotent: a product that already has ≥1 batch is skipped, so re-running is
// safe. Never deletes product.stock / batch_no / exp_date — those stay as the
// auto-synced mirrors the rest of the app reads.
// ===========================================================================
import dotenv from "dotenv";
import mongoose from "mongoose";
import Product from "../model/productModel.js";
import ProductBatch from "../model/productBatchModel.js";

dotenv.config();

async function main() {
    const uri = process.env.MONGO_UR;
    if (!uri) {
        console.error("MONGO_UR is not set — aborting.");
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("Connected. Scanning products…");

    const products = await Product.find().lean();
    let created = 0;
    let skipped = 0;

    for (const p of products) {
        const already = await ProductBatch.countDocuments({ product_id: p._id });
        if (already > 0) {
            skipped++;
            continue;
        }

        const stock = Number(p.stock) || 0;
        const batchNumber =
            p.batch_no && String(p.batch_no).trim()
                ? String(p.batch_no).trim()
                : `LEGACY-${p._id}`;

        await ProductBatch.create({
            product_id: p._id,
            batch_number: batchNumber,
            purchase_quantity: stock,
            available_quantity: stock,
            purchase_price: Number(p.mrp) || Number(p.price) || 0,
            selling_price: Number(p.price) || 0,
            expiry_date: p.exp_date || undefined,
        });
        created++;
    }

    console.log(
        `Done. Batches created: ${created}, products skipped (already had batches): ${skipped}, total products: ${products.length}`
    );

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
