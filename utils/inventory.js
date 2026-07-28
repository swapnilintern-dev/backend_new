import mongoose from "mongoose";
import Product from "../model/productModel.js";
import ProductBatch from "../model/productBatchModel.js";
import OutletStock from "../model/outletStockModel.js";
import OutletStockBatch from "../model/outletStockBatchModel.js";

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

/// The catalog batches of a product that may still be SOLD or ASSIGNED:
/// available > 0 and not past expiry, in FEFO order (earliest expiry first,
/// then oldest entry). Batches without an expiry sort last ("never expires").
///
/// Expired lots are deliberately excluded everywhere stock leaves the catalog —
/// they stay in ProductBatch (and in product.stock, which remains the PHYSICAL
/// total) so Marketing can still see and write them off in the Batch Manager,
/// but no order, manual order or outlet assignment can ever consume them.
/// `session` optional (reads).
export async function getSellableProductBatches(productId, session) {
    const now = new Date();
    const q = ProductBatch.find({
        product_id: productId,
        available_quantity: { $gt: 0 },
        $or: [{ expiry_date: { $gt: now } }, { expiry_date: null }],
    }).sort({ expiry_date: 1, createdAt: 1 });
    if (session) q.session(session);
    return q;
}

/// Computes a FEFO allocation for `qty` over a product's CATALOG batches
/// WITHOUT mutating anything — powers the marketing preview + override
/// validation, and is the planning half of allocateFEFO.
///
/// `overrides` (optional) is an array of { batch?, batch_number?, quantity }
/// the user pinned. Pinned quantities are validated against the batch's
/// availability, deduped, and applied first; the remainder is auto-filled FEFO
/// across the batches not already pinned.
///
/// Returns { allocations, remaining, availableBatches }.
export async function previewProductAllocation(productId, qty, overrides, session) {
    const need = Number(qty);
    const batches = await getSellableProductBatches(productId, session);
    const byId = new Map(batches.map((b) => [String(b._id), b]));
    const byNumber = new Map(batches.map((b) => [b.batch_number, b]));

    const availableBatches = batches.map((b) => ({
        batch: b._id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        manufacturing_date: b.manufacturing_date,
        available_quantity: b.available_quantity,
        purchase_quantity: b.purchase_quantity,
        purchase_price: b.purchase_price,
        selling_price: b.selling_price,
        supplier: b.supplier,
        isExpiringSoon: b.isExpiringSoon,
        created_at: b.createdAt,
    }));

    if (!Number.isFinite(need) || need <= 0) {
        return { allocations: [], remaining: need || 0, availableBatches };
    }

    const allocations = [];
    const used = new Set();
    let remaining = need;

    // 1) Apply valid overrides first. An unknown id/number means the batch is
    //    expired, emptied or deleted since the picker loaded — it is skipped so
    //    the FEFO auto-fill below covers those units instead.
    for (const ov of Array.isArray(overrides) ? overrides : []) {
        const take = Number(ov.quantity);
        if (!Number.isFinite(take) || take <= 0) continue;

        const b = ov.batch
            ? byId.get(String(ov.batch))
            : byNumber.get(ov.batch_number);
        if (!b) continue;
        if (used.has(String(b._id))) continue; // no duplicate allocations
        if (take > b.available_quantity) {
            throw new InsufficientStockError(
                `Batch ${b.batch_number} has only ${b.available_quantity} available`
            );
        }
        if (take > remaining) {
            throw new InsufficientStockError(
                "Allocated more than the requested quantity"
            );
        }
        allocations.push(allocationOf(b, take));
        used.add(String(b._id));
        remaining -= take;
    }

    // 2) Auto-fill the remainder FEFO across not-yet-pinned batches.
    for (const b of batches) {
        if (remaining <= 0) break;
        if (used.has(String(b._id))) continue;
        const take = Math.min(remaining, Number(b.available_quantity) || 0);
        if (take <= 0) continue;
        allocations.push(allocationOf(b, take));
        used.add(String(b._id));
        remaining -= take;
    }

    return { allocations, remaining, availableBatches };
}

/// One allocation entry. `batch`/`batch_number`/`expiry_date`/`quantity` are the
/// fields orderModel.orderItems.allocations persists; the lot's prices ride
/// along (not persisted on the order) so an outlet credit can inherit the
/// batch's own pricing rather than the product's.
function allocationOf(b, quantity) {
    return {
        batch: b._id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        quantity,
        purchase_price: b.purchase_price,
        selling_price: b.selling_price,
        supplier: b.supplier,
    };
}

/// Consumes `qty` units of `productId` FEFO (honouring any valid `overrides`),
/// inside `session`. Returns the allocation breakdown:
///   [{ batch, batch_number, expiry_date, quantity }]
/// which the caller snapshots onto the order line. Throws InsufficientStockError
/// (rolling the transaction back) when stock is short — checked up-front AND
/// enforced per-batch by a guarded atomic decrement so concurrent orders can
/// never oversell.
///
/// `overrides` is optional and defaults to pure FEFO, so every existing caller
/// (`allocateFEFO(productId, qty, session)`) behaves exactly as before.
export async function allocateFEFO(productId, qty, session, overrides) {
    const need = Number(qty);
    if (!Number.isFinite(need) || need <= 0) {
        throw new InsufficientStockError("Invalid order quantity");
    }

    // Resolve the intended allocation (with overrides) against a fresh read.
    const { allocations, remaining } = await previewProductAllocation(
        productId,
        need,
        overrides,
        session
    );

    if (remaining > 0) {
        const product = await Product.findById(productId).session(session).lean();
        const name = product ? product.title : "product";
        const sellable = need - remaining;
        // Expired lots are excluded above but still counted in product.stock,
        // so say so plainly rather than leave a confusing mismatch.
        const expired = await expiredQuantity(productId, session);
        const suffix = expired > 0 ? ` (${expired} expired and cannot be sold)` : "";
        throw new InsufficientStockError(
            `Insufficient stock for ${name}: available ${sellable}, ordered ${need}${suffix}`
        );
    }

    // Apply with a guarded atomic decrement per batch: it only succeeds if the
    // batch still holds at least that many units. If a concurrent transaction
    // drained it first the whole order is rolled back rather than short-shipped,
    // so two racing orders can never both take the same units.
    for (const a of allocations) {
        const updated = await ProductBatch.findOneAndUpdate(
            { _id: a.batch, available_quantity: { $gte: a.quantity } },
            { $inc: { available_quantity: -a.quantity } },
            { session, new: true }
        );
        if (!updated) {
            throw new InsufficientStockError(
                "Stock changed during checkout, please retry"
            );
        }
    }

    await recalcProductStock(productId, session);
    return allocations;
}

/// How many units of a product sit in already-expired lots (reporting only —
/// these are never allocated).
async function expiredQuantity(productId, session) {
    const now = new Date();
    const q = ProductBatch.find({
        product_id: productId,
        available_quantity: { $gt: 0 },
        expiry_date: { $lte: now },
    }).lean();
    if (session) q.session(session);
    const expired = await q;
    return expired.reduce((sum, b) => sum + (Number(b.available_quantity) || 0), 0);
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

// ===========================================================================
// OUTLET-SCOPED inventory — the same FEFO engine, but over the batches a single
// outlet physically holds (outletStockBatch). outletStock.quantity is the
// auto-synced total mirror, exactly like product.stock mirrors catalog batches.
// ===========================================================================

/// Recomputes an outlet's stock mirror for a product, in `session`:
///   outletStock.quantity = SUM(available_quantity) over the outlet's batches.
export async function recalcOutletStock(outletId, productId, session) {
    const batches = await OutletStockBatch.find({
        outlet: outletId,
        product: productId,
    })
        .session(session)
        .lean();

    const total = batches.reduce(
        (sum, b) => sum + (Number(b.available_quantity) || 0),
        0
    );

    await OutletStock.updateOne(
        { outlet: outletId, product: productId },
        { $set: { quantity: total }, $setOnInsert: { outlet: outletId, product: productId } },
        { session, upsert: true }
    );
    return total;
}

/// Credits an outlet with `allocations` (from a catalog FEFO consume at
/// assignment time), upserting matching outletStockBatch rows, in `session`.
/// Each entry: { batch_number, expiry_date, quantity, batch(sourceId), ... }.
export async function creditOutletBatches(outletId, productId, allocations, session, extra = {}) {
    for (const a of allocations) {
        const qty = Number(a.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        // Increment the matching (outlet, product, batch_number) row, or create
        // it. upsert + $inc keeps concurrent assignments correct.
        await OutletStockBatch.updateOne(
            { outlet: outletId, product: productId, batch_number: a.batch_number },
            {
                $inc: { available_quantity: qty },
                $setOnInsert: {
                    outlet: outletId,
                    product: productId,
                    batch_number: a.batch_number,
                    expiry_date: a.expiry_date,
                    source_batch: a.batch,
                    // Batch-level pricing wins when the catalog lot carries it
                    // (so an outlet bill quotes the price of the lot it holds);
                    // the product-level fallback keeps older lots working.
                    purchase_price: a.purchase_price || extra.purchase_price || 0,
                    selling_price: a.selling_price || extra.selling_price || 0,
                    supplier: a.supplier || extra.supplier || "",
                },
            },
            { session, upsert: true }
        );
    }
    await recalcOutletStock(outletId, productId, session);
}

/// The outlet's batches for a product that can still be sold: available > 0 and
/// not expired, sorted FEFO (earliest expiry first). Used by the preview and
/// the manual-override picker. `session` optional (reads).
export async function getSellableOutletBatches(outletId, productId, session) {
    const now = new Date();
    const q = OutletStockBatch.find({
        outlet: outletId,
        product: productId,
        available_quantity: { $gt: 0 },
        $or: [{ expiry_date: { $gt: now } }, { expiry_date: null }],
    }).sort({ expiry_date: 1, createdAt: 1 });
    if (session) q.session(session);
    return q;
}

/// Computes a FEFO allocation for `qty` over the outlet's batches WITHOUT
/// mutating anything — for the billing preview + override validation.
///
/// `overrides` (optional) is an array of { batch_number?, batch?, quantity }
/// the user pinned. Pinned quantities are validated against the batch's
/// availability, deduped, and applied first; the remaining quantity is then
/// auto-filled FEFO across the batches not already pinned.
///
/// Returns { allocations, remaining, availableBatches }.
export async function previewOutletAllocation(outletId, productId, qty, overrides, session) {
    const need = Number(qty);
    const batches = await getSellableOutletBatches(outletId, productId, session);
    const byId = new Map(batches.map((b) => [String(b._id), b]));
    const byNumber = new Map(batches.map((b) => [b.batch_number, b]));

    const availableBatches = batches.map((b) => ({
        batch: b._id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        available_quantity: b.available_quantity,
        created_at: b.createdAt,
    }));

    if (!Number.isFinite(need) || need <= 0) {
        return { allocations: [], remaining: need || 0, availableBatches };
    }

    const allocations = [];
    const used = new Set();
    let remaining = need;

    // 1) Apply valid overrides first.
    for (const ov of Array.isArray(overrides) ? overrides : []) {
        const take = Number(ov.quantity);
        if (!Number.isFinite(take) || take <= 0) continue;

        const b = ov.batch
            ? byId.get(String(ov.batch))
            : byNumber.get(ov.batch_number);
        if (!b) continue; // unknown/expired/empty batch → ignore silently
        if (used.has(String(b._id))) continue; // no duplicate allocations
        if (take > b.available_quantity) {
            throw new InsufficientStockError(
                `Batch ${b.batch_number} has only ${b.available_quantity} available`
            );
        }
        if (take > remaining) {
            throw new InsufficientStockError(
                "Allocated more than the requested quantity"
            );
        }
        allocations.push({
            batch: b._id,
            batch_number: b.batch_number,
            expiry_date: b.expiry_date,
            quantity: take,
        });
        used.add(String(b._id));
        remaining -= take;
    }

    // 2) Auto-fill the remainder FEFO across not-yet-used batches.
    for (const b of batches) {
        if (remaining <= 0) break;
        if (used.has(String(b._id))) continue;
        const take = Math.min(remaining, Number(b.available_quantity) || 0);
        if (take <= 0) continue;
        allocations.push({
            batch: b._id,
            batch_number: b.batch_number,
            expiry_date: b.expiry_date,
            quantity: take,
        });
        used.add(String(b._id));
        remaining -= take;
    }

    return { allocations, remaining, availableBatches };
}

/// Consumes `qty` of a product from an outlet's batches FEFO (honouring valid
/// `overrides`), inside `session`. Guarded atomic decrement so concurrent bills
/// can't oversell. Returns the final allocations, then recomputes the mirror.
export async function allocateOutletFEFO(outletId, productId, qty, overrides, session) {
    const need = Number(qty);
    if (!Number.isFinite(need) || need <= 0) {
        throw new InsufficientStockError("Invalid bill quantity");
    }

    // Resolve the intended allocation (with overrides) against a fresh read.
    const { allocations, remaining } = await previewOutletAllocation(
        outletId,
        productId,
        need,
        overrides,
        session
    );
    if (remaining > 0) {
        const product = await Product.findById(productId).session(session).lean();
        const name = product ? product.title : "product";
        throw new InsufficientStockError(
            `Insufficient outlet stock for ${name}: short by ${remaining}`
        );
    }

    // Apply with a guarded decrement per batch.
    for (const a of allocations) {
        const updated = await OutletStockBatch.findOneAndUpdate(
            { _id: a.batch, available_quantity: { $gte: a.quantity } },
            { $inc: { available_quantity: -a.quantity } },
            { session, new: true }
        );
        if (!updated) {
            throw new InsufficientStockError(
                "Stock changed during billing, please retry"
            );
        }
    }

    await recalcOutletStock(outletId, productId, session);
    return allocations;
}

/// Returns billed units to an outlet's batches — cancel/restore. `entries` is
/// the order line's allocations snapshot (or a legacy {batch_no, quantity}).
export async function releaseOutletStock(outletId, productId, entries, session) {
    const list = Array.isArray(entries) ? entries : [entries];
    for (const e of list) {
        const qty = Number(e.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const number = e.batch_number || e.batch_no;

        let batch = null;
        if (e.batch) {
            batch = await OutletStockBatch.findOne({
                _id: e.batch,
                outlet: outletId,
                product: productId,
            }).session(session);
        }
        if (!batch && number) {
            batch = await OutletStockBatch.findOne({
                outlet: outletId,
                product: productId,
                batch_number: number,
            }).session(session);
        }

        if (batch) {
            batch.available_quantity += qty;
            await batch.save({ session });
        } else {
            await OutletStockBatch.create(
                [
                    {
                        outlet: outletId,
                        product: productId,
                        batch_number: number || `RESTORE-${Date.now()}`,
                        available_quantity: qty,
                        expiry_date: e.expiry_date || e.exp_date,
                    },
                ],
                { session }
            );
        }
    }
    await recalcOutletStock(outletId, productId, session);
}

// --- helpers ---------------------------------------------------------------

/// Cleans a client-supplied batch-override array into the shape the allocation
/// engine and the cart schemas accept: only entries that identify a batch (id
/// or number) with a positive quantity survive, and a malformed id is dropped
/// rather than thrown on (the engine simply auto-fills those units FEFO).
/// Returns [] for anything that isn't an array, so an omitted field is exactly
/// the same as "no override" — pure FEFO.
export function normalizeAllocations(raw) {
    if (!Array.isArray(raw)) return [];
    const cleaned = [];
    for (const a of raw) {
        if (!a || typeof a !== "object") continue;
        const quantity = Number(a.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;

        const batch =
            a.batch && mongoose.isValidObjectId(a.batch) ? a.batch : undefined;
        const batch_number =
            a.batch_number !== undefined && a.batch_number !== null
                ? String(a.batch_number).trim()
                : undefined;
        if (!batch && !batch_number) continue;

        cleaned.push({ batch, batch_number, quantity: Math.floor(quantity) });
    }
    return cleaned;
}

function expiryMs(batch) {
    if (!batch.expiry_date) return Number.POSITIVE_INFINITY;
    return new Date(batch.expiry_date).getTime();
}
