import mongoose from "mongoose";

/**
 * A vendor's FCM registration token — one row per (user, device).
 *
 * Tokens rotate: Firebase reissues them on reinstall, restore, app-data clear
 * and periodically. The app pushes every rotation to /notifications/device-token
 * and this collection is the single source of truth for who can be reached.
 *
 * The token is treated as a credential: never returned to any client (the
 * controllers project it away), and rows are hard-deleted the moment FCM
 * reports the token as unregistered/invalid.
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },

    // The account's role at registration time ("", "vendor", "buyer", …).
    // Kept so the broadcast can segment by audience without a Vendor lookup.
    role: { type: String, default: "" },

    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    platform: {
      type: String,
      enum: ["android", "ios", "web", "unknown"],
      default: "unknown",
    },

    // Stable per-install id from the app, so re-registering the same device
    // after a token rotation replaces the old row instead of piling up.
    deviceId: { type: String, default: "", index: true },

    appVersion: { type: String, default: "" },

    // The device's OS-level notification permission, mirrored by the app.
    // A device that revoked permission is skipped by the broadcast.
    enabled: { type: Boolean, default: true },

    // Refreshed on every app start / token sync. Used to prune dead installs.
    lastSeenAt: { type: Date, default: Date.now },

    // Consecutive transient FCM failures. Reset on success; a token is dropped
    // once FCM reports it as permanently invalid (see fcm.js).
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Broadcast query: all enabled tokens for a set of users.
deviceTokenSchema.index({ user: 1, enabled: 1 });

// One row per physical device per user (when the app supplies a deviceId).
deviceTokenSchema.index(
  { user: 1, deviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { deviceId: { $type: "string", $ne: "" } },
  }
);

const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema);
export default DeviceToken;
