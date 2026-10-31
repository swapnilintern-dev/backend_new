import express from "express";
import { addCoupon, deleteCoupon, getCoupons, toggleCoupon } from "../controller/couponController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";
import requireRole from "../middlewares/requireRole.js";

const router = express.Router();

// Coupons now take real money off an order (see placeOrder), so only staff may
// create / switch / delete them. Listing stays public — the customer cart
// shows the active codes.
const couponStaff = [isAuthenticated, requireRole("marketing", "admin")];

router.get("/coupons", getCoupons);
router.post("/coupons", ...couponStaff, addCoupon);
router.put("/coupons/:code/toggle", ...couponStaff, toggleCoupon);
router.delete("/coupons/:code", ...couponStaff, deleteCoupon);

export default router;
