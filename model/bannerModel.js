import mongoose from "mongoose";

// Promo banner shown on the customer home carousel. Managed by the marketing
// team. A banner is now IMAGE-first: the marketing team uploads a creative
// (stored on Cloudinary) which the app renders edge-to-edge. The colours/text
// fields are kept as a fallback for older, image-less banners (the app renders
// a gradient from startColor -> endColor when there is no image).
const bannerSchema = new mongoose.Schema(
  {
    tag: { type: String, default: "OFFER" },        // e.g. "BULK OFFER" (fallback text)
    title: { type: String, default: "" },             // main banner text (fallback)
    ctaLabel: { type: String, default: "Shop Now" },
    startColor: { type: String, default: "#4CAF82" },
    endColor: { type: String, default: "#2E7D5E" },
    categoryId: { type: String },                      // optional deep-link target
    // Uploaded creative (Cloudinary). publicId is kept so the image can be
    // removed from Cloudinary when the banner is deleted.
    image: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Banner = mongoose.model("Banner", bannerSchema);
export default Banner;
