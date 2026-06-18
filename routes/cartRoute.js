import express from "express"
import isAuthenticated from "../middlewares/isAuthenticated.js";
import { addCart, clearCart, decreaseItem, getCart, increaseItem, removeCartItem } from "../controller/cartController.js";

const router = express.Router() ;


router.post("/add-cart/:id", isAuthenticated ,  addCart) ;

router.get("/getCart-product" , isAuthenticated , getCart ) ;

router.delete("/remove-cart-item/:id", isAuthenticated , removeCartItem ) ;

router.post("/increase-cart-item/:id" , isAuthenticated , increaseItem ) ;

router.post("/dec-cart-itm/:id", isAuthenticated , decreaseItem ) ;

router.post("/clear-cart" , isAuthenticated , clearCart ) ;


export default router ;