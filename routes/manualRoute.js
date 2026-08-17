import express from "express";
import manualCart, {  manualOrder } from "../controller/manualOrderController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

// Marketing creates an order on an approved vendor's behalf (phone order).
// vendorId (and, for the cart, the productId) travel in the ROUTE — the app
// fills vendorId in from the vendor it selected. Mounted under /vsArogya.
//   POST /manual-cart/:vendorId/:itemId  → add one unit of a product to the
//                                          selected vendor's cart
//   POST /manual-order/:vendorId         → place the order from that cart
router.post("/manual-cart/:vendorId/:itemId", manualCart);
router.post("/manual-order/:vendorId", manualOrder);

export default router;
