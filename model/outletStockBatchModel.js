import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// OutletStockBatch — a batch of a product physically held by ONE outlet.
//
// The catalog product owns its batches (productBatch). When marketing assigns
// stock to an outlet (addOutletStock) it consumes catalog batches FEFO, and the
// SAME batch identity (number + expiry) is recorded here so the outlet knows
// exactly which lots it holds. Outlet POS billing then allocates FEFO across
// THESE rows.
//
// outletStock.quantity stays as the auto-synced total (mirror), the same way
// product.stock mirrors the catalog batches — so every existing outlet reader
// keeps working with no change.
// ---------------------------------------------------------------------------
const outletStockBatchSchema = new mongoose.Schema(
    {
        outlet: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Outlet",
            required: true,
            index: true,
        },
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "product",
            required: true,
            index: true,
        },

        // The catalog batch this outlet lot originated from (audit trail). Not a
        // hard link — the catalog batch may be fully consumed/deleted later.
        source_batch: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "productBatch",
        },

        batch_number: {
            type: String,
            required: true,
            trim: true,
        },

        available_quantity: {
            type: Number,
            required: true,
            min: 0,
        },

        purchase_price: { type: Number, default: 0 },
        selling_price: { type: Number, default: 0 },
        expiry_date: { type: Date },
        supplier: { type: String, default: "" },
    },
    { timestamps: true }
);

// One row per (outlet, product, batch_number): assigning more of the same batch
// increments the existing row rather than duplicating it.
outletStockBatchSchema.index(
    { outlet: 1, product: 1, batch_number: 1 },
    { unique: true }
);

// FEFO reads: "this outlet's batches of this product, earliest expiry first".
outletStockBatchSchema.index({ outlet: 1, product: 1, expiry_date: 1 });

// Same ≤90-day live flag as the catalog batch, so outlet-side expiry alerts stay
// consistent — computed from the current server date on every serialization.
outletStockBatchSchema.virtual("isExpiringSoon").get(function () {
    if (!this.expiry_date) return false;
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.ceil(
        (new Date(this.expiry_date).getTime() - Date.now()) / msPerDay
    );
    return daysLeft <= 90;
});

outletStockBatchSchema.set("toJSON", { virtuals: true });
outletStockBatchSchema.set("toObject", { virtuals: true });

const OutletStockBatch = mongoose.model(
    "outletStockBatch",
    outletStockBatchSchema
);

export default OutletStockBatch;
