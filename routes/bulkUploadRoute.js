import express from "express";
import upload from "../middlewares/multer.js";
import { bulkUploadProducts } from "../controller/bulkUploadController.js";

const router = express.Router() ;



router.post('/bulk-upload' , upload.single("file"), bulkUploadProducts ) ;


export default router ;