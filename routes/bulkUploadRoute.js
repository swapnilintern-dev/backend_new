import express from "express";
import { uploadSheet } from "../middlewares/multer.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";
import requireRole from "../middlewares/requireRole.js";
import { bulkUploadProducts } from "../controller/bulkUploadController.js";

const router = express.Router() ;


// Bulk product import from a spreadsheet.
//
// uploadSheet (not the default `upload`) because that one only accepts images
// and PDFs — an .xlsx posted to it is rejected before the controller runs.
//
// Guarded: this writes straight into the product catalogue, so it is limited to
// the roles that own the catalogue. The role comes from the signed JWT, so it
// cannot be spoofed from the body.
router.post(
    '/bulk-upload',
    isAuthenticated,
    requireRole("marketing", "admin"),
    uploadSheet.single("file"),
    bulkUploadProducts
) ;


export default router ;
