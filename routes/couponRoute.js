import express from "express";
import { addCoupon, deleteCoupon, getCoupons, toggleCoupon } from "../controller/couponController.js";

const router = express.Router();

router.get("/coupons", getCoupons);
router.post("/coupons", addCoupon);
router.put("/coupons/:code/toggle", toggleCoupon);
router.delete("/coupons/:code", deleteCoupon);

export default router;
