import express from "express";
import placeOrder, { cancelOrder, getOrders, placeSingleOrder } from "../controller/orderController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

// App '/place-order' (bina id) POST karta hai aur controller req.params.id
// use hi nahi karta. Pehle route '/place-order/:id' tha → match nahi hota tha
// → 404 → order kabhi backend tak nahi jaata tha. Ab :id hataya.
router.post("/place-order" , isAuthenticated ,  placeOrder ) ;

router.post("/place-single-ord/:id" , isAuthenticated , placeSingleOrder ) ;

router.get("/get-order" , isAuthenticated , getOrders ) ;

router.put("/cancel-order/:id"  , isAuthenticated, cancelOrder ) ;



export default router ;