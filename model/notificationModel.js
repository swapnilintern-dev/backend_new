import mongoose from "mongoose";

/**
 * A broadcast notification authored by the Marketing role.
 *
 * One document = one campaign. Per-recipient delivery/read state lives in
 * NotificationReceipt (see notificationReceiptModel.js) so a single campaign
 * scales to thousands of vendors without an unbounded array on this document.
 */

export const NOTIFICATION_CATEGORIES = [
  "New Medicine",
  "Stock Update",
  "Offer",
  "Discount",
  "Emergency",
  "General Announcement",
  "Health Awareness",
  "Festival Greetings",
  "Important Update",
  "Company News",
  "Maintenance",
  "Policy Update",
];

export const NOTIFICATION_PRIORITIES = ["Low", "Normal", "High", "Critical"];

/**
 * draft     — saved by marketing, never broadcast.
 * scheduled — has a future sendAt; the scheduler picks it up.
 * sending   — broadcast in flight (guards against double-send).
 * sent      — broadcast finished (may still have per-receipt failures).
 * failed    — broadcast could not run at all (e.g. FCM unconfigured).
 */
export const NOTIFICATION_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
];

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    subtitle: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    category: {
      type: String,
      enum: NOTIFICATION_CATEGORIES,
      default: "General Announcement",
      index: true,
    },

    priority: {
      type: String,
      enum: NOTIFICATION_PRIORITIES,
      default: "Normal",
      index: true,
    },

    // Optional call-to-action rendered on the notification card / detail sheet.
    buttonText: { type: String, default: "", trim: true, maxlength: 40 },

    // In-app route the card opens when tapped (e.g. "orders", "products").
    // Free-form: the Flutter side maps known keys and falls back to the
    // notification detail screen for anything it doesn't recognise.
    redirectScreen: { type: String, default: "", trim: true },

    // External/internal deep link (https:// or app scheme).
    deepLink: { type: String, default: "", trim: true },

    // Rich-notification artwork. `imageUrl` is the big picture used by FCM's
    // rich push; `bannerImage` is the in-app card creative uploaded through
    // Cloudinary (publicId retained so deletes stay orphan-free).
    imageUrl: { type: String, default: "", trim: true },

    bannerImage: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    // Material icon key (e.g. "medication"). Rendered by the Flutter card.
    icon: { type: String, default: "", trim: true },

    // After this instant the notification stops appearing in vendor inboxes.
    expiryDate: { type: Date, default: null },

    // Pinned campaigns sort to the top of the vendor's notification center.
    pinned: { type: Boolean, default: false },

    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: "draft",
      index: true,
    },

    // Who receives it. Only "vendors" is broadcast today; the field exists so
    // adding another audience later doesn't need a migration.
    audience: {
      type: String,
      enum: ["vendors"],
      default: "vendors",
    },

    // When status === "scheduled", the instant the broadcast should run.
    scheduledAt: { type: Date, default: null, index: true },

    sentAt: { type: Date, default: null },

    // Denormalised author info so history stays readable even if the staff
    // account is later removed.
    sender: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
      name: { type: String, default: "" },
      role: { type: String, default: "" },
    },

    // Live delivery analytics. Incremented by the broadcast service and by the
    // vendor-side read/open endpoints.
    stats: {
      targeted: { type: Number, default: 0 }, // eligible vendors resolved
      tokens: { type: Number, default: 0 }, // device tokens attempted
      sent: { type: Number, default: 0 }, // accepted by FCM
      delivered: { type: Number, default: 0 }, // confirmed by a device
      failed: { type: Number, default: 0 }, // rejected by FCM after retries
      opened: { type: Number, default: 0 }, // tapped the push / opened detail
      read: { type: Number, default: 0 }, // marked read in the app
      retryCount: { type: Number, default: 0 }, // retry passes executed
    },

    // Last broadcast error (surfaced in the marketing history screen).
    lastError: { type: String, default: "" },

    // Set when a send has fully finished, so a resend/retry never
    // double-processes a campaign that is still in flight.
    broadcastStartedAt: { type: Date, default: null },

    // Soft delete keeps analytics intact while hiding the campaign from lists.
    deleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// History screen: newest first, filtered by status/category.
notificationSchema.index({ deleted: 1, createdAt: -1 });
notificationSchema.index({ status: 1, scheduledAt: 1 });

// Free-text search over the composer fields (marketing "search previous
// notifications"). Weighted so a title hit outranks a body hit.
notificationSchema.index(
  { title: "text", subtitle: "text", message: "text" },
  { weights: { title: 5, subtitle: 3, message: 1 }, name: "notification_text" }
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
