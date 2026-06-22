import express from "express";
import addnewProduct, { deleteProduct, getAllProducts } from "../controller/postController.js";
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
router.delete("/delete-product/:id" , deleteProduct ) ;

export default router;