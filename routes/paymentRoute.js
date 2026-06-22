import express from "express"
import isAuthenticated from "../middlewares/isAuthenticated.js";
import createPayment from "../controller/paymentController.js";

const router = express.Router() ;

router.post("/create-payment/:id" , isAuthenticated , createPayment ) ;

export default router 