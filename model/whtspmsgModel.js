import mongoose from "mongoose";

const whatsappWebhookSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      default: null,
    },

    messageId: {
      type: String,
      default: null,
      index: true,
    },

    from: {
      type: String,
      default: null,
      index: true,
    },

    phoneNumberId: {
      type: String,
      default: null,
    },

    messageType: {
      type: String,
      default: null,
    },

    messageText: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      default: null,
    },

    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    processed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const WhatsAppWebhook = mongoose.model(
  "WhatsAppWebhook",
  whatsappWebhookSchema
);

export default WhatsAppWebhook;