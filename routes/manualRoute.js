import express from "express"
import manualCart, { manualOrder } from "../controller/manualOrderController.js";


const router = express.Router() ;


router.post('/manual-cart/:vendorId/:itemId' , manualCart) ;

router.post('/manual-order/:vendorId' , manualOrder );


export default router ;