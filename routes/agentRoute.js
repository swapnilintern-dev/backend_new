import express from "express"
import { getPincodeOrders, pincode_vendors } from "../controller/agentController.js";

const router = express.Router() ;

router.post("/pin-vendors/:id" , pincode_vendors) ;
router.post("/pin-orders/:id" , getPincodeOrders)

export default router 