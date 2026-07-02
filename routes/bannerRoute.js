import express from "express";
import { addBanner, deleteBanner, getBanners } from "../controller/bannerController.js";
import upload from "../middlewares/multer.js";

const router = express.Router();

router.get("/promo-banners", getBanners);
router.post("/promo-banners", upload.single("image"), addBanner);
router.delete("/promo-banners/:id", deleteBanner);

export default router;
