import express from "express";
import isAuthenticated from "../middlewares/isAuthenticated.js";
import { downloadInvoice, previewInvoice } from "../controller/invoiceController.js";

const router = express.Router();

// Both are scoped to the logged-in buyer (the controller verifies the order
// belongs to the caller before rendering anything).
router.get("/invoice/:id/preview", isAuthenticated, previewInvoice);
router.get("/invoice/:id/pdf", isAuthenticated, downloadInvoice);

export default router;
