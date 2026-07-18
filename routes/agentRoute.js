import express from "express";
import { agentLogin, agentRegister, getAgentProfile, getPincodeOrders, pincode_vendors } from "../controller/agentController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

// Marketing head registers an Area Agent (Vendor with role "agent" + pincode).
router.post("/agent-register", isAuthenticated, agentRegister);

// Area Agent (pincode-scoped, read-only). The agent id travels in the route so
// the app can scope every call to the signed-in agent.
//
// NOTE: this must NOT be "/agent-login" — that path already belongs to the
// DELIVERY agent login (routes/deliveryRoute.js, mounted first), which would
// shadow this one. Area agents normally sign in through the main /login
// anyway; this is a dedicated fallback.
router.post("/area-agent-login", agentLogin);
router.post("/pin-vendors/:id", pincode_vendors);
router.post("/pin-orders/:id", getPincodeOrders);

// The signed-in agent's own profile (name, mobile, email, pincode, status).
router.get("/agent-profile/:id", getAgentProfile);

export default router;
