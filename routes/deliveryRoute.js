import express from "express"
import agentAccount, { agentLogin } from "../controller/deliveryagentController.js";
const router = express.Router();

router.post("/agent-create" , agentAccount ) ;
router.post("/agent-login", agentLogin ) ;

export default router ;