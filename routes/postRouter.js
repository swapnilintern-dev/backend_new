import express from "express";
import addnewProduct, { deleteProduct, getAllProducts, updateProduct } from "../controller/postController.js";
import upload from "../middlewares/multer.js";
// import  addCart from "../controller/cartController.js";

import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

router.post(
  "/add-product",
  upload.single("image"),
  addnewProduct
);

router.get("/all-products", getAllProducts);
router.put("/update-product/:id", upload.single("image"), updateProduct);
router.delete("/delete-product/:id", deleteProduct);
router.get("/share-prod/:id", isAuthenticated, copyUrl);
router.post("/save-prod", isAuthenticated, saveItem);
router.get("/all-saved", isAuthenticated, AllsaveItem);


export default router;