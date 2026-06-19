import express from "express";
import approvalneedUser, { statusApproval } from "../controller/adminController.js";

const router = express.Router() ;

router.get("/pending-vendor" , approvalneedUser) ;
router.put("/approval-mail/:id" , statusApproval ) ;

export default router ;