import express from "express"
import agentAccount, { agentLogin } from "../controller/deliveryagentController.js";
import {
    deliveryCreatePaymentLink,
    deliveryPaymentStatus,
} from "../controller/rolePaymentController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";
const router = express.Router();

router.post("/agent-create" , agentAccount ) ;
router.post("/agent-login", agentLogin ) ;

// Doorstep collection: the agent gets a SERVER-minted Razorpay payment link
// (shown as a QR / shared to the customer), then polls until Razorpay confirms
// the payment. Requires a role:"delivery" token.
router.post("/delivery/payment-link/:id", isAuthenticated, deliveryCreatePaymentLink);
router.get("/delivery/payment-status/:id", isAuthenticated, deliveryPaymentStatus);

export default router ;