import express from "express"
import isAuthenticated from "../middlewares/isAuthenticated.js";
import { invoiceGenerate } from "../controller/invoiceController.js";

const router = express.Router() ;


router.post('/preview-invoice/:id' ,isAuthenticated , invoiceGenerate ) ;

export default router ;