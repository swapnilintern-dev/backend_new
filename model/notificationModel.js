import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    // Notification kis user ko milega
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // User ka type
    recipientType: {
      type: String,
      enum: ["vendor", "outlet", "admin", "deliveryAgent"],
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    // Notification kis category ki hai
    type: {
      type: String,
      enum: [
        "ORDER_PLACED",
        "ORDER_PROCESSING",
        "ORDER_SHIPPED",
        "ORDER_DELIVERED",
        "ORDER_CANCELLED",
        "OUT_FOR_DELIVERY",
        "PAYMENT_SUCCESS",
        "PAYMENT_FAILED",
        "VENDOR_APPROVED",
        "VENDOR_REJECTED",
        "GENERAL",
      ],
      default: "GENERAL",
    },

    // Related order/product etc. ka ID
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Frontend ko extra information bhejne ke liye
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Notification read hui ya nahi
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Pinned to its own "usernotifications" collection.
//
// The marketing broadcast model (model/broadcastNotificationModel.js) already
// owns "notifications" — the collection Mongoose would otherwise derive from
// this model's name too. Sharing it would interleave two unrelated schemas in
// one collection: campaign documents (category/priority/status/stats) and
// per-user inbox rows (recipientId/type/isRead), so each system's queries would
// start turning up the other's documents.
const Notification = mongoose.model(
  "Notification",
  notificationSchema,
  "usernotifications"
);

export default Notification;