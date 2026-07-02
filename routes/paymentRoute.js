import express from "express"
import isAuthenticated from "../middlewares/isAuthenticated.js";
import createPayment, { verifyPayment } from "../controller/paymentController.js";

const router = express.Router() ;

router.post("/create-payment/:id" , isAuthenticated , createPayment ) ;
router.post("/verify-payment" , isAuthenticated , verifyPayment ) ;

export default router