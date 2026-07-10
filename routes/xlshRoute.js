import express from "express"
import { all_vendor, exportOrders } from "../controller/xlsheetController.js";

const router = express.Router() ;

router.get('/order-report' , exportOrders ) ;
router.get('/vendor-report' , all_vendor ) 

export default router ;