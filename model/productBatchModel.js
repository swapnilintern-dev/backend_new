import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// ProductBatch — one physical purchase lot of a product.
//
// A product is restocked repeatedly over months/years, and every purchase has
// its OWN quantity, expiry and pricing. Rather than overwriting a single
// batch_no/exp_date on the product (the old design), each lot is stored as an
// independent ProductBatch. Stock is consumed FEFO (First-Expiry-First-Out)
// across these lots by server/utils/inventory.js.
//
// The product keeps `stock`/`batch_no`/`exp_date` as auto-synced MIRRORS
// (product.stock === SUM(available_quantity); batch_no/exp_date === the
// FEFO-front batch) so every existing reader keeps working with no migration.
// ---------------------------------------------------------------------------
const productBatchSchema = new mongoose.Schema(
    {
        product_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "product",
            required: true,
            index: true,
        },

        // Supplier's batch/lot number as printed on the pack. Unique per product
        // (compound index below) — the same number may legitimately recur across
        // different products.
        batch_number: {
            type: String,
            required: true,
            trim: true,
        },

        // How many units this lot was bought with (immutable reference).
        purchase_quantity: {
            type: Number,
            required: true,
            min: 0,
        },

        // How many units of this lot are still on hand. FEFO decrements this;
        // never goes below 0 (guarded by the allocation engine).
        available_quantity: {
            type: Number,
            required: true,
            min: 0,
        },

        purchase_price: { type: Number, default: 0 },
        selling_price: { type: Number, default: 0 },

        manufacturing_date: { type: Date },
        expiry_date: { type: Date },

        supplier: { type: String, default: "" },
    },
    { timestamps: true }
);

// No duplicate batch_number within the same product (spec validation, also
// enforced at the DB layer so a race can't slip a duplicate through).
productBatchSchema.index({ product_id: 1, batch_number: 1 }, { unique: true });

// FEFO reads: "batches of this product, earliest expiry first".
productBatchSchema.index({ product_id: 1, expiry_date: 1 });

// Live expiry flag — same 90-day rule as productModel's virtual, so batch-level
// alerts stay consistent with the product-level one. Computed from the current
// server date on every serialization (no cron/timer/DB write).
productBatchSchema.virtual("isExpiringSoon").get(function () {
    if (!this.expiry_date) return false;
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.ceil(
        (new Date(this.expiry_date).getTime() - Date.now()) / msPerDay
    );
    return daysLeft <= 90;
});

productBatchSchema.set("toJSON", { virtuals: true });
productBatchSchema.set("toObject", { virtuals: true });

const ProductBatch = mongoose.model("productBatch", productBatchSchema);

export default ProductBatch;
