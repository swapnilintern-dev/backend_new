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

// POST /promo-banners — create a banner (marketing).
export const addBanner = async (req, res) => {
  try {
    const { tag, title, ctaLabel, startColor, endColor, categoryId } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const banner = await Banner.create({
      tag,
      title,
      ctaLabel,
      startColor,
      endColor,
      categoryId,
    });

    return res.status(201).json({ success: true, message: "Banner created", banner });
  } catch (er) {
    console.log("addBanner error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};

// DELETE /promo-banners/:id — remove a banner (marketing).
export const deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }
    return res.status(200).json({ success: true, message: "Banner deleted" });
  } catch (er) {
    console.log("deleteBanner error:", er);
    return res.status(500).json({ success: false, message: er.message });
  }
};
