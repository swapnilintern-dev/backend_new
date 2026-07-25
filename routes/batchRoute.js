import express from "express";
import {
    getProductBatches,
    addProductBatch,
    updateProductBatch,
    deleteProductBatch,
} from "../controller/batchController.js";

const router = express.Router();

// Batch management for a product (Marketing). Left unauthenticated to match the
// existing product CRUD routes (/add-product, /update-product) in postRouter.js.
router.get("/product/:id/batches", getProductBatches);
router.post("/product/:id/batches", addProductBatch);
router.put("/batch/:batchId", updateProductBatch);
router.delete("/batch/:batchId", deleteProductBatch);

export default router;
