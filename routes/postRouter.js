import express from "express";
import addnewProduct, { deleteProduct, getAllProducts, updateProduct, copyUrl, saveItem, AllsaveItem } from "../controller/postController.js";
import upload, { uploadProductMedia } from "../middlewares/multer.js";
// import  addCart from "../controller/cartController.js";

import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

// Wraps the product-media multer middleware so multer's own errors (file too
// large, wrong type, too many files) come back as a clean 400 JSON instead of
// bubbling to the generic 500 handler.
const productMedia = (req, res, next) =>
  uploadProductMedia(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });

router.post(
  "/add-product",
  productMedia,
  addnewProduct
);

router.get("/all-products", getAllProducts);
router.put("/update-product/:id", productMedia, updateProduct);
router.delete("/delete-product/:id", deleteProduct);
router.get("/share-prod/:id", isAuthenticated, copyUrl);
// saveItem controller req.params.id use karta hai — route me :id zaroori.
router.post("/save-prod/:id", isAuthenticated, saveItem);
router.get("/all-saved", isAuthenticated, AllsaveItem);


export default router;