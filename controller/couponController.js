import Coupon from "../model/couponModel.js";

// GET /coupons — all coupons (marketing list; customers filter active locally).
export const getCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, coupons });
  } catch (er) {
    console.log("getCoupons error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};

// POST /coupons — create a coupon (marketing).
export const addCoupon = async (req, res) => {
  try {
    const { code, description, percentOff, maxDiscount } = req.body;

    if (!code || percentOff === undefined || percentOff === null || percentOff === "") {
      return res.status(400).json({ success: false, message: "Code and percentOff are required" });
    }

    const normalized = code.toUpperCase().trim();
    const exists = await Coupon.findOne({ code: normalized });
    if (exists) {
      return res.status(409).json({ success: false, message: "Coupon code already exists" });
    }

    const coupon = await Coupon.create({
      code: normalized,
      description: description || "",
      percentOff: Number(percentOff),
      maxDiscount: maxDiscount === undefined || maxDiscount === "" ? undefined : Number(maxDiscount),
    });

    return res.status(201).json({ success: true, message: "Coupon created", coupon });
  } catch (er) {
    console.log("addCoupon error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};

// PUT /coupons/:code/toggle — flip active on/off (marketing).
export const toggleCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findOne({ code: req.params.code.toUpperCase() });
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    coupon.active = !coupon.active;
    await coupon.save();
    return res.status(200).json({ success: true, message: "Coupon updated", coupon });
  } catch (er) {
    console.log("toggleCoupon error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};

// DELETE /coupons/:code — remove a coupon (marketing).
export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findOneAndDelete({ code: req.params.code.toUpperCase() });
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    return res.status(200).json({ success: true, message: "Coupon deleted" });
  } catch (er) {
    console.log("deleteCoupon error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};
