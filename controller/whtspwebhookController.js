// import WhatsAppWebhook from "../models/whatsappWebhook.model.js";

import WhatsAppWebhook from "../model/whtspmsgModel.js";

// import WhatsAppWebhook from "../model/whtspmsgModel.js";

/**
 * GET
 * /vsArogya/whatsapp/webhook
 *
 * Meta uses this endpoint to verify the webhook.
 */
export const verifyWhatsAppWebhook = async (req, res) => {
  try {
    console.log("🔍 WhatsApp webhook verification request");

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("Mode:", mode);
    console.log("Token received:", token);
    console.log("Challenge:", challenge);

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (!verifyToken) {
      console.error(
        "❌ WHATSAPP_VERIFY_TOKEN is missing in environment variables"
      );

      return res.sendStatus(500);
    }

    if (
      mode === "subscribe" &&
      token === verifyToken
    ) {
      console.log("✅ WhatsApp webhook verified successfully");

      return res.status(200).send(challenge);
    }

    console.log("❌ Invalid verify token");

    return res.sendStatus(403);

  } catch (error) {
    console.error(
      "❌ WhatsApp verification error:",
      error
    );

    return res.sendStatus(500);
  }
};


/**
 * POST
 * /vsArogya/whatsapp/webhook
 *
 * Meta sends WhatsApp messages/status updates here.
 */
export const receiveWhatsAppWebhook = async (req, res) => {
  try {
    const body = req.body;

    console.log(
      "📩 WhatsApp webhook received:"
    );

    console.log(
      JSON.stringify(body, null, 2)
    );

    // Check WhatsApp event
    if (
      body?.object !==
      "whatsapp_business_account"
    ) {
      console.log(
        "⚠️ Not a WhatsApp Business event"
      );

      return res.sendStatus(404);
    }

    // Loop through entries
    for (const entry of body.entry || []) {

      for (const change of entry.changes || []) {

        if (change.field !== "messages") {
          continue;
        }

        const value = change.value;

        const phoneNumberId =
          value?.metadata?.phone_number_id;

        /**
         * ==========================
         * INCOMING MESSAGES
         * ==========================
         */

        if (value?.messages) {

          for (const message of value.messages) {

            let messageText = null;

            if (message.type === "text") {
              messageText =
                message.text?.body || null;
            }

            await WhatsAppWebhook.create({
              eventType: "message",

              messageId:
                message.id || null,

              from:
                message.from || null,

              phoneNumberId,

              messageType:
                message.type || null,

              messageText,

              rawPayload: message,

              processed: false,
            });

            console.log(
              "💾 WhatsApp message saved"
            );

            console.log({
              from: message.from,
              type: message.type,
              text: messageText,
            });
          }
        }


        /**
         * ==========================
         * MESSAGE STATUS
         * ==========================
         */

        if (value?.statuses) {

          for (const status of value.statuses) {

            await WhatsAppWebhook.create({
              eventType: "status",

              messageId:
                status.id || null,

              status:
                status.status || null,

              phoneNumberId,

              rawPayload: status,

              processed: false,
            });

            console.log(
              "📊 WhatsApp status:",
              status.status
            );
          }
        }
      }
    }

    /**
     * IMPORTANT
     * Meta expects HTTP 200.
     */
    return res.sendStatus(200);

  } catch (error) {

    console.error(
      "❌ WhatsApp webhook error:",
      error
    );

    /**
     * We still return 200 so Meta
     * doesn't keep retrying the event.
     */
    return res.sendStatus(200);
  }
};