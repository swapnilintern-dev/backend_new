import express from "express"
import isAuthenticated from "../middlewares/isAuthenticated.js";
import requireActiveVendor from "../middlewares/requireActiveVendor.js";
import createPayment, { verifyPayment } from "../controller/paymentController.js";

const router = express.Router() ;

// An inactive vendor cannot START a payment. verify-payment stays open so a
// payment already made is still recorded against its order.
router.post("/create-payment/:id" , isAuthenticated , requireActiveVendor , createPayment ) ;
router.post("/verify-payment" , isAuthenticated , verifyPayment ) ;

export default router