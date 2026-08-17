import express from "express";
import {
    getProductBatches,
    getProductAvailableBatches,
    productAllocatePreview,
    addProductBatch,
    updateProductBatch,
    deleteProductBatch,
} from "../controller/batchController.js";

const router = express.Router();

// Batch management for a product (Marketing). Left unauthenticated to match the
// existing product CRUD routes (/add-product, /update-product) in postRouter.js.
router.get("/product/:id/batches", getProductBatches);

// Read-only FEFO helpers for the batch pickers (Manual Order, Stock Assignment).
// Declared before the generic /product/:id/batches mutations below; distinct
// paths, so no existing route changes meaning.
router.get("/product/:id/available-batches", getProductAvailableBatches);
router.post("/allocate-preview", productAllocatePreview);
router.post("/product/:id/batches", addProductBatch);
router.put("/batch/:batchId", updateProductBatch);
router.delete("/batch/:batchId", deleteProductBatch);

export default router;
