import mongoose from "mongoose";

// Discount coupon managed by the marketing team and applied by customers at
// checkout. `code` is unique (stored uppercase).
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: "" },
    percentOff: { type: Number, required: true },   // e.g. 20 = 20% off
    maxDiscount: { type: Number },                  // optional cap (₹)
    active: { type: Boolean, default: true },
    expired: { type: Boolean, default: false },
    redemptions: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Coupon = mongoose.model("Coupon", couponSchema);
export default Coupon;
