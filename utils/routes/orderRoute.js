import express from "express";
import placeOrder, { getOrders, placeSingleOrder } from "../controller/orderController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router() ;

router.post("/place-order" , isAuthenticated ,  placeOrder ) ;

router.post("/place-single-ord/:id" , isAuthenticated , placeSingleOrder ) ;

router.get("/get-order" , isAuthenticated , getOrders ) ;



export default router ;