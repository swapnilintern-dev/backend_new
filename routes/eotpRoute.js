import express from "express"
import { sendOtp, verifyOtpAndLogin } from "../controller/emailverifyController.js";

const router = express.Router() ;

// Paths need the leading slash — Express 5 does not normalise "eotp" into
// "/eotp", so without it neither route is ever reachable.
router.post('/eotp', sendOtp);
router.post('/eotp-verify', verifyOtpAndLogin);

export default router ;
