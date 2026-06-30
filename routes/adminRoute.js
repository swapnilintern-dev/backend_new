import express from "express";
import approvalneedUser, { confirmOrder, deliveredOrder, getAllActiveVendor, getAllOrder, getallVendors, getSingleOrder, outofDelivery, rejectApproval, shippedOrder, statusApproval, totalSell  } from "../controller/adminController.js";

const router = express.Router() ;

router.get("/pending-vendor" , approvalneedUser) ;
router.put("/approval-mail/:id" , statusApproval ) ;
router.put("/reject-vendor/:id" , rejectApproval ) ;
router.get("/all-orders" , getAllOrder ) ;

router.get("/single-order/:id" , getSingleOrder ) ;

router.put("/confirm-order/:id" , confirmOrder ) ;
router.put("/shipped-order/:id" , shippedOrder) ;
router.put("/outof-delivery/:id" , outofDelivery ) ;
router.put("/delivered-prder/:id" , deliveredOrder ) ;

router.get("/all-vendors" , getallVendors ) ;
router.get("/active-vendors" , getAllActiveVendor ) ;
router.get("/total-revenue" , totalSell ) ;


export default router ;