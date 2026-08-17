import express from "express"
import isAuthenticated from "../middlewares/isAuthenticated.js";
import { previewInv } from "../controller/invoiceController.js";

const router = express.Router() ;


// router.post('/preview-invoice/:id' ,isAuthenticated , invoiceGenerate );

router.get("/prev-invoice/:id" , isAuthenticated , previewInv)

export default router ;