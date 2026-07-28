import mongoose from "mongoose";

/**
 * One row per (campaign, vendor). This is the vendor's in-app notification
 * center row AND the delivery-tracking record for analytics.
 *
 * The compound unique index below is what makes the broadcast idempotent: a
 * resend / retry / duplicate scheduler tick re-inserts the same pairs and Mongo
 * rejects the duplicates, so a vendor can never see the same campaign twice.
 */
const notificationReceiptSchema = new mongoose.Schema(
  {
    notification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Notification",
      required: true,
      index: true,
    },

    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },

    // FCM outcome for this vendor's devices.
    //   pending — receipt created, push not attempted yet
    //   sent    — at least one device token accepted by FCM
    //   failed  — every token was rejected (after retries)
    //   skipped — vendor has no token / disabled notifications (in-app only)
    pushStatus: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
      index: true,
    },

    pushError: { type: String, default: "" },

    // How many send passes have touched this receipt (initial + retries).
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },

    // Confirmed by the device itself (the app acknowledges receipt when the
    // message arrives in any app state). Distinct from `pushStatus: sent`,
    // which only means FCM accepted it.
    delivered: { type: Boolean, default: false },
    deliveredAt: { type: Date, default: null },

    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },

    // The vendor tapped the push / opened the detail screen.
    opened: { type: Boolean, default: false },
    openedAt: { type: Date, default: null },

    // Vendor removed it from their notification center. Soft so analytics and
    // the dedup guarantee survive.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Dedup guarantee + the primary lookup for "did this vendor already get it?".
notificationReceiptSchema.index(
  { notification: 1, vendor: 1 },
  { unique: true }
);

// Vendor inbox: their rows, newest first, unread-count scan.
notificationReceiptSchema.index({ vendor: 1, deleted: 1, createdAt: -1 });
notificationReceiptSchema.index({ vendor: 1, read: 1, deleted: 1 });

// Retry sweep: find the failed/pending rows of one campaign fast.
notificationReceiptSchema.index({ notification: 1, pushStatus: 1 });

const NotificationReceipt = mongoose.model(
  "NotificationReceipt",
  notificationReceiptSchema
);
export default NotificationReceipt;
