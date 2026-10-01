import express from "express"
import { sendOtp, verifyOtpAndLogin } from "../controller/emailverifyController.js";

const router = express.Router() ;

router.post('eotp', sendOtp);
router.post('eotp-verify' , verifyOtpAndLogin
)

export default router ;