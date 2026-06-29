import mongoose from "mongoose";

// Promo banner shown on the customer home carousel. Managed by the marketing
// team. Colours are stored as hex strings (e.g. "#4CAF82"); the app renders a
// gradient from startColor -> endColor.
const bannerSchema = new mongoose.Schema(
  {
    tag: { type: String, default: "OFFER" },        // e.g. "BULK OFFER"
    title: { type: String, required: true },          // main banner text
    ctaLabel: { type: String, default: "Shop Now" },
    startColor: { type: String, default: "#4CAF82" },
    endColor: { type: String, default: "#2E7D5E" },
    categoryId: { type: String },                      // optional deep-link target
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Banner = mongoose.model("Banner", bannerSchema);
export default Banner;
