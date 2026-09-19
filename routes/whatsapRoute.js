import express from "express"
import { receiveMessage, verifyWebhook } from "../controller/whtspwebhookController.js";


const router = express.Router() ;


router.get('/whatsapp/webhook' , verifyWebhook ) ;
router.post('/whatsapp/webhook' , receiveMessage ) ;


export default router ;