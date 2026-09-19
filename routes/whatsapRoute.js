import express from "express";

import {
  verifyWhatsAppWebhook,
  receiveWhatsAppWebhook,
} from "../controllers/whatsapp.controller.js";

const router = express.Router();

/**
 * Meta Webhook Verification
 */
router.get(
  "/webhook",
  verifyWhatsAppWebhook
);

/**
 * WhatsApp Incoming Events
 */
router.post(
  "/webhook",
  receiveWhatsAppWebhook
);

export default router;