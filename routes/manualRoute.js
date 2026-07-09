import express from "express";
import { createManualOrder } from "../controller/manualOrderController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

// Marketing creates an order on an approved vendor's behalf (phone order).
// vendorId + items travel in the JSON body; isAuthenticated sets req.id to the
// staff user for the createdBy audit trail. Mounted under /vsArogya.
router.post("/manual-order", isAuthenticated, createManualOrder);

export default router;
