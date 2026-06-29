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

router.get("/all-products", getAllProducts ) ;
router.put("/update-product/:id", upload.single("image"), updateProduct ) ;
router.delete("/delete-product/:id" , deleteProduct ) ;

export default router;