import Product from "../model/productModel.js";
import ProductBatch from "../model/productBatchModel.js";
import {
    withInventoryTxn,
    recalcProductStock,
} from "../utils/inventory.js";

// ===========================================================================
// Batch CRUD — Marketing manages the inventory lots behind a product.
//
//   GET    /product/:id/batches   list all batches for a product
//   POST   /product/:id/batches   add a new batch
//   PUT    /batch/:batchId        edit a batch
//   DELETE /batch/:batchId        delete a batch
//
// Every mutation runs in a transaction and recomputes the product's mirror
// fields (stock = SUM(available_quantity); batch_no/exp_date = FEFO-front) so
// the rest of the app keeps reading stock exactly as before.
// ===========================================================================

// --- Validation helpers ----------------------------------------------------

const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));

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

        const draft = {
            product_id: productId,
            batch_number: b.batch_number ? String(b.batch_number).trim() : "",
            purchase_quantity: purchase,
            available_quantity: available,
            purchase_price: num(b.purchase_price) ?? 0,
            selling_price: num(b.selling_price) ?? 0,
            manufacturing_date: b.manufacturing_date ? new Date(b.manufacturing_date) : undefined,
            expiry_date: b.expiry_date ? new Date(b.expiry_date) : undefined,
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
            existing.manufacturing_date = b.manufacturing_date ? new Date(b.manufacturing_date) : undefined;
        }
        if (b.expiry_date !== undefined) {
            existing.expiry_date = b.expiry_date ? new Date(b.expiry_date) : undefined;
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
