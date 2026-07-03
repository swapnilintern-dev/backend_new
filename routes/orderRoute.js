import express from "express";
import placeOrder, { cancelOrder, getOrders, placeSingleOrder } from "../controller/orderController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

router.post("/place-order/:id" , isAuthenticated ,  placeOrder ) ;

router.post("/place-single-ord/:id" , isAuthenticated , placeSingleOrder ) ;

router.get("/get-order" , isAuthenticated , getOrders ) ;

router.put("/cancel-order/:id"  , isAuthenticated, cancelOrder ) ;



export default router ;