import express from "express";
import razorpayWebhook from "../controller/razorpayWebhookController.js";

const router = express.Router();

// Raw body (a Buffer) — the signature check needs the exact bytes Razorpay
// sent, so this router is mounted BEFORE express.json() in index.js.
router.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), razorpayWebhook);

export default router;
