import mongoose from "mongoose";
import Product from "../model/productModel.js";
import ProductBatch from "../model/productBatchModel.js";

// ---------------------------------------------------------------------------
// Inventory engine — the SINGLE source of truth for stock math.
//
// Every order path (vendor cart, buy-now, marketing manual, outlet-stock
// assignment) consumes stock through here so the frontend never calculates
// inventory. Consumption is FEFO (First-Expiry-First-Out): the batch with the
// earliest expiry is drained first.
//
// All mutating functions take a mongoose `session` and MUST run inside a
// transaction (see withInventoryTxn) so a short line rolls the whole order
// back — no oversell, no half-deducted orders.
// ---------------------------------------------------------------------------

/// Thrown when the requested quantity exceeds the total available stock. The
/// message is safe to surface verbatim to the client (mirrors the existing
/// "Insufficient stock" wording used across the controllers).
export class InsufficientStockError extends Error {
    constructor(message) {
        super(message);
        this.name = "InsufficientStockError";
        this.statusCode = 400;
    }
}

/// Runs `work(session)` inside a Mongo transaction (Atlas replica set). Commits
/// on success, rolls back on any throw, and always ends the session. Callers
/// get the value returned by `work`.
export async function withInventoryTxn(work) {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await work(session);
        });
        return result;
    } finally {
        session.endSession();
    }
}

/// Recomputes the product's mirror fields from its batches, in `session`:
///   - stock     = SUM(available_quantity) across all batches
///   - batch_no  = the FEFO-front batch's number  (earliest expiry, qty > 0)
///   - exp_date  = the FEFO-front batch's expiry
/// Keeping these mirrors current means every existing reader (customer catalog,
/// admin, reports, outlet, invoice snapshots) keeps working unchanged.
export async function recalcProductStock(productId, session) {
    const batches = await ProductBatch.find({ product_id: productId })
        .session(session)
        .lean();

    const totalStock = batches.reduce(
        (sum, b) => sum + (Number(b.available_quantity) || 0),
        0
    );

    // FEFO-front = earliest expiry among batches that still hold stock. Batches
    // without an expiry sort last (treated as "never expires").
    const inStock = batches
        .filter((b) => (Number(b.available_quantity) || 0) > 0)
        .sort((a, b) => expiryMs(a) - expiryMs(b));
    const front = inStock[0];

    const update = { stock: totalStock };
    if (front) {
        update.batch_no = front.batch_number;
        update.exp_date = front.expiry_date;
    }
    // When nothing is in stock we leave batch_no/exp_date as-is (last known),
    // so the invoice/UI don't suddenly blank out on a sold-out product.

    await Product.updateOne({ _id: productId }, { $set: update }, { session });
    return totalStock;
}

/// Consumes `qty` units of `productId` FEFO, inside `session`.
/// Returns the allocation breakdown:
///   [{ batch, batch_number, expiry_date, quantity }]
/// which the caller snapshots onto the order line. Throws InsufficientStockError
/// (rolling the transaction back) when stock is short — checked up-front AND
/// enforced per-batch by a guarded atomic decrement so concurrent orders can
/// never oversell.
export async function allocateFEFO(productId, qty, session) {
    const need = Number(qty);
    if (!Number.isFinite(need) || need <= 0) {
        throw new InsufficientStockError("Invalid order quantity");
    }

    // Earliest expiry first; a null expiry sorts last. Secondary sort by
    // createdAt keeps allocation deterministic for same-expiry batches.
    const batches = await ProductBatch.find({
        product_id: productId,
        available_quantity: { $gt: 0 },
    })
        .session(session)
        .sort({ expiry_date: 1, createdAt: 1 });

    const available = batches.reduce(
        (sum, b) => sum + (Number(b.available_quantity) || 0),
        0
    );
    if (available < need) {
        const product = await Product.findById(productId).session(session).lean();
        const name = product ? product.title : "product";
        throw new InsufficientStockError(
            `Insufficient stock for ${name}: available ${available}, ordered ${need}`
        );
    }

    const allocations = [];
    let remaining = need;

    for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(batch.available_quantity) || 0);
        if (take <= 0) continue;

        // Guarded atomic decrement: only succeeds if the batch still holds at
        // least `take`. If a concurrent transaction drained it first this
        // returns null and we skip to the next batch (or ultimately run short
        // and throw below), so two racing orders can never both take the same
        // units.
        const updated = await ProductBatch.findOneAndUpdate(
            { _id: batch._id, available_quantity: { $gte: take } },
            { $inc: { available_quantity: -take } },
            { session, new: true }
        );
        if (!updated) continue;

        allocations.push({
            batch: batch._id,
            batch_number: batch.batch_number,
            expiry_date: batch.expiry_date,
            quantity: take,
        });
        remaining -= take;
    }

    if (remaining > 0) {
        // Lost a race for some units after the up-front check — abort the whole
        // transaction rather than deliver a short order.
        throw new InsufficientStockError(
            "Stock changed during checkout, please retry"
        );
    }

    await recalcProductStock(productId, session);
    return allocations;
}

/// Returns stock to a product's batches — used by cancel/restore. `entries` is
/// either the order line's `allocations` array (preferred, exact batches) or a
/// legacy snapshot { batch_no, exp_date, quantity } for pre-migration orders.
/// A matching batch (by batch_number) is credited; if it was deleted the batch
/// is recreated so nothing is lost.
export async function releaseStock(productId, entries, session) {
    const list = Array.isArray(entries) ? entries : [entries];

    for (const e of list) {
        const qty = Number(e.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        const number = e.batch_number || e.batch_no;
        let batch = null;
        if (e.batch) {
            batch = await ProductBatch.findOne({
                _id: e.batch,
                product_id: productId,
            }).session(session);
        }
        if (!batch && number) {
            batch = await ProductBatch.findOne({
                product_id: productId,
                batch_number: number,
            }).session(session);
        }

        if (batch) {
            batch.available_quantity += qty;
            // A restore can push available above the original purchase count
            // (e.g. re-batched stock); bump purchase_quantity to stay consistent.
            if (batch.available_quantity > batch.purchase_quantity) {
                batch.purchase_quantity = batch.available_quantity;
            }
            await batch.save({ session });
        } else {
            // Batch was deleted since the sale — recreate it so the returned
            // units are not lost.
            await ProductBatch.create(
                [
                    {
                        product_id: productId,
                        batch_number: number || `RESTORE-${Date.now()}`,
                        purchase_quantity: qty,
                        available_quantity: qty,
                        expiry_date: e.expiry_date || e.exp_date,
                    },
                ],
                { session }
            );
        }
    }

    await recalcProductStock(productId, session);
}

// --- helpers ---------------------------------------------------------------

function expiryMs(batch) {
    if (!batch.expiry_date) return Number.POSITIVE_INFINITY;
    return new Date(batch.expiry_date).getTime();
}
