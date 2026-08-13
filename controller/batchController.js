import Product from "../model/productModel.js";
import ProductBatch from "../model/productBatchModel.js";
import {
    withInventoryTxn,
    recalcProductStock,
    getSellableProductBatches,
    previewProductAllocation,
    normalizeAllocations,
    InsufficientStockError,
} from "../utils/inventory.js";
import { parseDateInput } from "../utils/parseDate.js";

// ===========================================================================
// Batch CRUD — Marketing manages the inventory lots behind a product.
//
//   GET    /product/:id/batches            list all batches for a product
//   POST   /product/:id/batches            add a new batch
//   PUT    /batch/:batchId                 edit a batch
//   DELETE /batch/:batchId                 delete a batch
//
// Read-only FEFO helpers — the batch pickers in Manual Order and Stock
// Assignment call these so the app never computes inventory itself:
//   GET    /product/:id/available-batches  sellable lots only, FEFO order
//   POST   /allocate-preview               dry-run allocation (+ overrides)
//
// Every mutation runs in a transaction and recomputes the product's mirror
// fields (stock = SUM(available_quantity); batch_no/exp_date = FEFO-front) so
// the rest of the app keeps reading stock exactly as before.
// ===========================================================================

// --- Validation helpers ----------------------------------------------------

const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));

/// Marker returned when a date was sent but could not be understood, so the
/// caller answers 400 instead of writing an Invalid Date into the lot. Every
/// format the rest of the app accepts is listed in utils/parseDate.js.
const BAD_DATE = Symbol("bad-date");

/// undefined → not sent · BAD_DATE → sent but unparseable · Date → parsed.
const batchDate = (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    return parseDateInput(v) ?? BAD_DATE;
};

const DATE_HINT =
    "Use DD-MM-YYYY (31-12-2028) or YYYY-MM-DD (2028-12-31).";

/// Shared field validation for add/update. Returns a string error message, or
/// null when valid. `merged` is the effective batch after applying the update.
function validateBatch(merged) {
    if (!merged.batch_number || !String(merged.batch_number).trim()) {
        return "Batch number is required";
    }
    if (
        merged.purchase_quantity === undefined ||
        !Number.isFinite(merged.purchase_quantity) ||
        merged.purchase_quantity < 0
    ) {
        return "Purchase quantity must be a non-negative number";
    }
    if (
        merged.available_quantity === undefined ||
        !Number.isFinite(merged.available_quantity) ||
        merged.available_quantity < 0
    ) {
        return "Available quantity must be a non-negative number";
    }
    if (merged.available_quantity > merged.purchase_quantity) {
        return "Available quantity cannot exceed purchase quantity";
    }
    if (
        merged.manufacturing_date &&
        merged.expiry_date &&
        new Date(merged.expiry_date) < new Date(merged.manufacturing_date)
    ) {
        return "Expiry date cannot be before manufacturing date";
    }
    return null;
}

// --- List ------------------------------------------------------------------

export const getProductBatches = async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId).lean();
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        // FEFO order — the way stock will actually be consumed.
        const batches = await ProductBatch.find({ product_id: productId }).sort({
            expiry_date: 1,
            createdAt: 1,
        });

        return res.status(200).json({
            success: true,
            message: "Batches fetched successfully",
            stock: product.stock,
            batches,
        });
    } catch (err) {
        console.error("getProductBatches error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// --- FEFO read-only helpers -------------------------------------------------

/// The product's SELLABLE catalog batches (available > 0, not expired) in FEFO
/// order — the nearest expiry first. This is what the Manual Order and Stock
/// Assignment batch pickers list: an expired or emptied lot never appears, so
/// it can never be selected.
///   GET /vsArogya/product/:id/available-batches
export const getProductAvailableBatches = async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId).lean();
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        const batches = await getSellableProductBatches(productId);
        const sellableStock = batches.reduce(
            (sum, b) => sum + (Number(b.available_quantity) || 0),
            0
        );

        return res.status(200).json({
            success: true,
            message: "Available batches fetched successfully",
            // Physical total (unchanged meaning) vs what can actually be sold.
            stock: product.stock,
            sellable_stock: sellableStock,
            batches: batches.map((b) => ({
                _id: b._id,
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
            })),
        });
    } catch (err) {
        console.error("getProductAvailableBatches error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

/// Non-mutating FEFO allocation of a requested quantity across a product's
/// catalog batches, honouring any manual overrides. Returns the breakdown, how
/// much is still unallocated, and the batches available to pick from.
///   POST /vsArogya/allocate-preview  { productId, quantity, overrides? }
export const productAllocatePreview = async (req, res) => {
    try {
        const { productId, quantity, overrides } = req.body || {};
        if (!productId) {
            return res.status(400).json({ success: false, message: "productId is required" });
        }
        const product = await Product.findById(productId).lean();
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        const { allocations, remaining, availableBatches } =
            await previewProductAllocation(
                productId,
                quantity,
                normalizeAllocations(overrides)
            );

        return res.status(200).json({
            success: true,
            allocations,
            remaining,
            availableBatches,
        });
    } catch (err) {
        if (err instanceof InsufficientStockError) {
            return res.status(400).json({ success: false, message: err.message });
        }
        console.error("productAllocatePreview error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// --- Add -------------------------------------------------------------------

export const addProductBatch = async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        const b = req.body;
        // A new lot: available defaults to purchase when not sent explicitly.
        const purchase = num(b.purchase_quantity);
        const available =
            num(b.available_quantity) !== undefined ? num(b.available_quantity) : purchase;

        const mfgDate = batchDate(b.manufacturing_date);
        const expDate = batchDate(b.expiry_date);
        if (mfgDate === BAD_DATE) {
            return res.status(400).json({
                success: false,
                message: `Invalid manufacturing date. ${DATE_HINT}`,
            });
        }
        if (expDate === BAD_DATE) {
            return res.status(400).json({
                success: false,
                message: `Invalid expiry date. ${DATE_HINT}`,
            });
        }

        const draft = {
            product_id: productId,
            batch_number: b.batch_number ? String(b.batch_number).trim() : "",
            purchase_quantity: purchase,
            available_quantity: available,
            purchase_price: num(b.purchase_price) ?? 0,
            selling_price: num(b.selling_price) ?? 0,
            manufacturing_date: mfgDate,
            expiry_date: expDate,
            supplier: b.supplier || "",
        };

        const invalid = validateBatch(draft);
        if (invalid) {
            return res.status(400).json({ success: false, message: invalid });
        }

        // No duplicate batch_number within this product.
        const dup = await ProductBatch.findOne({
            product_id: productId,
            batch_number: draft.batch_number,
        });
        if (dup) {
            return res.status(400).json({
                success: false,
                message: `Batch "${draft.batch_number}" already exists for this product`,
            });
        }

        const batch = await withInventoryTxn(async (session) => {
            const created = await ProductBatch.create([draft], { session });
            await recalcProductStock(productId, session);
            return created[0];
        });

        return res.status(201).json({
            success: true,
            message: "Batch added successfully",
            batch,
        });
    } catch (err) {
        // Duplicate-key race caught by the unique index.
        if (err && err.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Batch number already exists for this product",
            });
        }
        console.error("addProductBatch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// --- Update ----------------------------------------------------------------

export const updateProductBatch = async (req, res) => {
    try {
        const batchId = req.params.batchId;
        const existing = await ProductBatch.findById(batchId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Batch not found" });
        }

        const b = req.body;
        const setIf = (key, val) => { if (val !== undefined) existing[key] = val; };

        if (b.batch_number !== undefined) {
            const trimmed = String(b.batch_number).trim();
            // No duplicate batch_number within the same product (excluding self).
            if (trimmed && trimmed !== existing.batch_number) {
                const dup = await ProductBatch.findOne({
                    product_id: existing.product_id,
                    batch_number: trimmed,
                    _id: { $ne: existing._id },
                });
                if (dup) {
                    return res.status(400).json({
                        success: false,
                        message: `Batch "${trimmed}" already exists for this product`,
                    });
                }
            }
            existing.batch_number = trimmed;
        }

        setIf("purchase_quantity", num(b.purchase_quantity));
        setIf("available_quantity", num(b.available_quantity));
        setIf("purchase_price", num(b.purchase_price));
        setIf("selling_price", num(b.selling_price));
        setIf("supplier", b.supplier);
        if (b.manufacturing_date !== undefined) {
            const mfgDate = batchDate(b.manufacturing_date);
            if (mfgDate === BAD_DATE) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid manufacturing date. ${DATE_HINT}`,
                });
            }
            existing.manufacturing_date = mfgDate;
        }
        if (b.expiry_date !== undefined) {
            const expDate = batchDate(b.expiry_date);
            if (expDate === BAD_DATE) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid expiry date. ${DATE_HINT}`,
                });
            }
            existing.expiry_date = expDate;
        }

        const invalid = validateBatch({
            batch_number: existing.batch_number,
            purchase_quantity: existing.purchase_quantity,
            available_quantity: existing.available_quantity,
            manufacturing_date: existing.manufacturing_date,
            expiry_date: existing.expiry_date,
        });
        if (invalid) {
            return res.status(400).json({ success: false, message: invalid });
        }

        const batch = await withInventoryTxn(async (session) => {
            await existing.save({ session });
            await recalcProductStock(existing.product_id, session);
            return existing;
        });

        return res.status(200).json({
            success: true,
            message: "Batch updated successfully",
            batch,
        });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Batch number already exists for this product",
            });
        }
        console.error("updateProductBatch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// --- Delete ----------------------------------------------------------------

export const deleteProductBatch = async (req, res) => {
    try {
        const batchId = req.params.batchId;
        const existing = await ProductBatch.findById(batchId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Batch not found" });
        }
        const productId = existing.product_id;

        await withInventoryTxn(async (session) => {
            await ProductBatch.deleteOne({ _id: batchId }, { session });
            await recalcProductStock(productId, session);
        });

        return res.status(200).json({
            success: true,
            message: "Batch deleted successfully",
        });
    } catch (err) {
        console.error("deleteProductBatch error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};
