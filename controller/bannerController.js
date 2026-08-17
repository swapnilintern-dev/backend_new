import sharp from "sharp";
import cloudinary from "../utils/cloudinary.js";
import Banner from "../model/bannerModel.js";

// GET /promo-banners — active banners for the customer home carousel.
export const getBanners = async (req, res) => {
  try {
    const banners = await Banner.find({ active: true }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, banners });
  } catch (er) {
    console.log("getBanners error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};

// POST /promo-banners — create a banner (marketing). Expects a multipart body
// with an `image` file part (the creative) plus optional text/colour fields.
export const addBanner = async (req, res) => {
  try {
    const { tag, title, ctaLabel, startColor, endColor, categoryId } = req.body;

    const file = req.file;

    // Image-first banners: require a creative (a title-only fallback banner is
    // still allowed for backward compatibility).
    if (!file && !title) {
      return res
        .status(400)
        .json({ success: false, message: "A banner image is required" });
    }

    let image = { url: "", publicId: "" };

    if (file) {
      // Optimize: cap width for a wide banner, keep the uploaded aspect ratio.
      const optimizedImgBuffer = await sharp(file.buffer)
        .resize({ width: 1280, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();

      const fileUri = `data:image/jpeg;base64,${optimizedImgBuffer.toString(
        "base64"
      )}`;

      const cloudResponse = await cloudinary.uploader.upload(fileUri, {
        folder: "banners",
      });

      image = {
        url: cloudResponse.secure_url,
        publicId: cloudResponse.public_id,
      };
    }

    const banner = await Banner.create({
      tag: tag || "OFFER",
      title: title || "",
      ctaLabel: ctaLabel || "Shop Now",
      startColor: startColor || "#4CAF82",
      endColor: endColor || "#2E7D5E",
      categoryId: categoryId || undefined,
      image,
    });

    return res
      .status(201)
      .json({ success: true, message: "Banner created", banner });
  } catch (er) {
    console.log("addBanner error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};

// DELETE /promo-banners/:id — remove a banner (marketing). Also removes the
// creative from Cloudinary so orphaned images don't accumulate.
export const deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    if (banner.image && banner.image.publicId) {
      try {
        await cloudinary.uploader.destroy(banner.image.publicId);
      } catch (imgErr) {
        // Non-fatal: the banner is already deleted; log and move on.
        console.log("deleteBanner cloudinary error:", imgErr.message);
      }
    }

    return res.status(200).json({ success: true, message: "Banner deleted" });
  } catch (er) {
    console.log("deleteBanner error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};
