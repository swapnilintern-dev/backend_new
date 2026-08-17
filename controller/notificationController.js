import mongoose from "mongoose";
import sharp from "sharp";

import cloudinary from "../utils/cloudinary.js";
import Vendor from "../model/userModel.js";
import DeviceToken from "../model/deviceTokenModel.js";
import Notification, {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
} from "../model/notificationModel.js";
import NotificationReceipt from "../model/notificationReceiptModel.js";
import {
  broadcastNotification,
  isPushConfigured,
  pushUnavailableReason,
  resolveEligibleVendorIds,
} from "../utils/notificationBroadcast.js";

// =============================================================================
// Helpers
// =============================================================================

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

/** Trims a value to a string, with a hard cap so nothing unbounded is stored. */
const str = (v, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const bool = (v, fallback = false) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
};

/** Parses a date field; returns null for empty/invalid input. */
const date = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Validates + normalises the composer payload shared by create and update.
 * Returns { error } or { data }.
 */
const readComposerFields = (body) => {
  const title = str(body.title, 120);
  const message = str(body.message, 2000);

  if (!title) return { error: "Notification title is required" };
  if (!message) return { error: "Notification message is required" };

  const category = str(body.category, 60) || "General Announcement";
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    return { error: `Unknown category "${category}"` };
  }

  const priority = str(body.priority, 20) || "Normal";
  if (!NOTIFICATION_PRIORITIES.includes(priority)) {
    return { error: `Unknown priority "${priority}"` };
  }

  const expiryDate = date(body.expiryDate);
  if (body.expiryDate && !expiryDate) {
    return { error: "Expiry date is not a valid date" };
  }

  const scheduledAt = date(body.scheduledAt);
  if (body.scheduledAt && !scheduledAt) {
    return { error: "Schedule time is not a valid date" };
  }

  return {
    data: {
      title,
      subtitle: str(body.subtitle, 160),
      message,
      category,
      priority,
      buttonText: str(body.buttonText, 40),
      redirectScreen: str(body.redirectScreen, 60),
      deepLink: str(body.deepLink, 500),
      imageUrl: str(body.imageUrl, 500),
      icon: str(body.icon, 60),
      expiryDate,
      scheduledAt,
      pinned: bool(body.pinned, false),
    },
  };
};

/** Uploads the optional in-app banner creative to Cloudinary. */
const uploadBanner = async (file) => {
  const optimized = await sharp(file.buffer)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const uri = `data:image/jpeg;base64,${optimized.toString("base64")}`;
  const uploaded = await cloudinary.uploader.upload(uri, {
    folder: "notifications",
  });

  return { url: uploaded.secure_url, publicId: uploaded.public_id };
};

const destroyBanner = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (er) {
    // Non-fatal: the record is already gone / being replaced.
    console.log("[notifications] cloudinary destroy failed:", er.message);
  }
};

/** Live per-campaign analytics, computed from the receipts (never drifts). */
const receiptStats = async (notificationId) => {
  const [row] = await NotificationReceipt.aggregate([
    { $match: { notification: new mongoose.Types.ObjectId(String(notificationId)) } },
    {
      $group: {
        _id: null,
        receipts: { $sum: 1 },
        pushSent: { $sum: { $cond: [{ $eq: ["$pushStatus", "sent"] }, 1, 0] } },
        pushFailed: { $sum: { $cond: [{ $eq: ["$pushStatus", "failed"] }, 1, 0] } },
        pushSkipped: { $sum: { $cond: [{ $eq: ["$pushStatus", "skipped"] }, 1, 0] } },
        pushPending: { $sum: { $cond: [{ $eq: ["$pushStatus", "pending"] }, 1, 0] } },
        delivered: { $sum: { $cond: ["$delivered", 1, 0] } },
        read: { $sum: { $cond: ["$read", 1, 0] } },
        opened: { $sum: { $cond: ["$opened", 1, 0] } },
        removed: { $sum: { $cond: ["$deleted", 1, 0] } },
        attempts: { $sum: "$attempts" },
      },
    },
  ]);

  return {
    receipts: row?.receipts || 0,
    pushSent: row?.pushSent || 0,
    pushFailed: row?.pushFailed || 0,
    pushSkipped: row?.pushSkipped || 0,
    pushPending: row?.pushPending || 0,
    delivered: row?.delivered || 0,
    read: row?.read || 0,
    opened: row?.opened || 0,
    removed: row?.removed || 0,
    attempts: row?.attempts || 0,
  };
};

/** Shapes a campaign for the marketing history/detail screens. */
const publicNotification = (doc, live) => ({
  id: String(doc._id),
  title: doc.title,
  subtitle: doc.subtitle || "",
  message: doc.message,
  category: doc.category,
  priority: doc.priority,
  buttonText: doc.buttonText || "",
  redirectScreen: doc.redirectScreen || "",
  deepLink: doc.deepLink || "",
  imageUrl: doc.imageUrl || "",
  bannerImage: doc.bannerImage?.url || "",
  icon: doc.icon || "",
  expiryDate: doc.expiryDate || null,
  pinned: !!doc.pinned,
  status: doc.status,
  audience: doc.audience,
  scheduledAt: doc.scheduledAt || null,
  sentAt: doc.sentAt || null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  sender: {
    id: doc.sender?.id ? String(doc.sender.id) : "",
    name: doc.sender?.name || "",
    role: doc.sender?.role || "",
  },
  lastError: doc.lastError || "",
  stats: {
    targeted: doc.stats?.targeted || 0,
    tokens: doc.stats?.tokens || 0,
    sent: doc.stats?.sent || 0,
    failed: doc.stats?.failed || 0,
    retryCount: doc.stats?.retryCount || 0,
    // Live figures win over the counters when they were computed.
    delivered: live ? live.delivered : doc.stats?.delivered || 0,
    read: live ? live.read : doc.stats?.read || 0,
    opened: live ? live.opened : doc.stats?.opened || 0,
    ...(live
      ? {
          receipts: live.receipts,
          pushSent: live.pushSent,
          pushFailed: live.pushFailed,
          pushSkipped: live.pushSkipped,
          pushPending: live.pushPending,
        }
      : {}),
  },
});

/** Shapes a receipt + its campaign for the vendor's notification center. */
const publicInboxItem = (receipt, notification) => ({
  // The RECEIPT id is the vendor-facing handle for read/delete calls.
  id: String(receipt._id),
  notificationId: String(notification._id),
  title: notification.title,
  subtitle: notification.subtitle || "",
  message: notification.message,
  category: notification.category,
  priority: notification.priority,
  buttonText: notification.buttonText || "",
  redirectScreen: notification.redirectScreen || "",
  deepLink: notification.deepLink || "",
  imageUrl: notification.imageUrl || "",
  bannerImage: notification.bannerImage?.url || "",
  icon: notification.icon || "",
  pinned: !!notification.pinned,
  expiryDate: notification.expiryDate || null,
  sentAt: notification.sentAt || receipt.createdAt,
  receivedAt: receipt.createdAt,
  read: !!receipt.read,
  readAt: receipt.readAt || null,
  opened: !!receipt.opened,
  senderName: notification.sender?.name || "",
});

// =============================================================================
// Device tokens  (any signed-in account)
// =============================================================================

/**
 * POST /notifications/device-token
 * Registers (or refreshes) this device's FCM token for the signed-in account.
 * Safe to call on every app start — it upserts.
 */
export const registerDeviceToken = async (req, res) => {
  try {
    const token = str(req.body.token, 4096);
    if (!token) return fail(res, 400, "A device token is required");

    const platform = ["android", "ios", "web"].includes(
      String(req.body.platform || "").toLowerCase()
    )
      ? String(req.body.platform).toLowerCase()
      : "unknown";

    const deviceId = str(req.body.deviceId, 200);
    const appVersion = str(req.body.appVersion, 40);
    const enabled = bool(req.body.enabled, true);

    // A token is globally unique — if it moved to another account (shared
    // device), it must follow the account that just registered it.
    await DeviceToken.deleteMany({ token, user: { $ne: req.id } });

    // Same physical device, rotated token → replace the stale row.
    if (deviceId) {
      await DeviceToken.deleteMany({
        user: req.id,
        deviceId,
        token: { $ne: token },
      });
    }

    const saved = await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          user: req.id,
          role: req.role || "",
          token,
          platform,
          deviceId,
          appVersion,
          enabled,
          lastSeenAt: new Date(),
          failureCount: 0,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Device registered for notifications",
      // Never echo the token back.
      deviceTokenId: String(saved._id),
      pushConfigured: isPushConfigured(),
    });
  } catch (er) {
    console.error("registerDeviceToken error:", er);
    return fail(res, 500, "Could not register this device");
  }
};

/**
 * PUT /notifications/device-token
 * Rotates a token (Firebase reissued it). Body: { oldToken, token, ... }.
 */
export const updateDeviceToken = async (req, res) => {
  try {
    const token = str(req.body.token, 4096);
    const oldToken = str(req.body.oldToken, 4096);
    if (!token) return fail(res, 400, "A device token is required");

    if (oldToken && oldToken !== token) {
      await DeviceToken.deleteMany({ token: oldToken, user: req.id });
    }

    // The registration path already upserts + cleans up; reuse it.
    return registerDeviceToken(req, res);
  } catch (er) {
    console.error("updateDeviceToken error:", er);
    return fail(res, 500, "Could not update this device token");
  }
};

/**
 * DELETE /notifications/device-token
 * Removes this device's token (called on logout). Body: { token } — omit it to
 * drop every device registered to the account.
 */
export const deleteDeviceToken = async (req, res) => {
  try {
    const token = str(req.body?.token, 4096);
    const filter = token ? { user: req.id, token } : { user: req.id };
    const result = await DeviceToken.deleteMany(filter);

    return res.status(200).json({
      success: true,
      message: "Device unregistered",
      removed: result.deletedCount || 0,
    });
  } catch (er) {
    console.error("deleteDeviceToken error:", er);
    return fail(res, 500, "Could not unregister this device");
  }
};

/**
 * PUT /notifications/preferences  { enabled: bool }
 * Account-level push opt-in/out.
 */
export const updateNotificationPreference = async (req, res) => {
  try {
    const enabled = bool(req.body.enabled, true);

    const updated = await Vendor.findByIdAndUpdate(
      req.id,
      { $set: { notificationsEnabled: enabled } },
      { new: true }
    ).select("notificationsEnabled");

    if (!updated) return fail(res, 404, "Account not found");

    // Mirror onto this account's devices so the broadcast skips them too.
    await DeviceToken.updateMany({ user: req.id }, { $set: { enabled } });

    return res.status(200).json({
      success: true,
      notificationsEnabled: updated.notificationsEnabled !== false,
    });
  } catch (er) {
    console.error("updateNotificationPreference error:", er);
    return fail(res, 500, "Could not update your notification preference");
  }
};

// =============================================================================
// Marketing panel
// =============================================================================

/**
 * POST /notifications        (marketing)
 * Creates a campaign. `sendNow: true` broadcasts immediately; a `scheduledAt`
 * in the future queues it for the scheduler; otherwise it is saved as a draft.
 * Accepts JSON or multipart (optional `bannerImage` file part).
 */
export const createNotification = async (req, res) => {
  let banner = null;

  try {
    const parsed = readComposerFields(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);

    const { scheduledAt, ...fields } = parsed.data;
    const sendNow = bool(req.body.sendNow, false);

    if (req.file) banner = await uploadBanner(req.file);

    // A send-now campaign is created as a draft on purpose: broadcastNotification
    // then CLAIMS it atomically (draft → sending), which is what makes a double
    // tap on Send impossible to double-broadcast.
    const scheduled = scheduledAt && scheduledAt.getTime() > Date.now();
    const status = scheduled && !sendNow ? "scheduled" : "draft";

    const sender = await Vendor.findById(req.id)
      .select("store_name contact_person_name role")
      .lean();

    const notification = await Notification.create({
      ...fields,
      scheduledAt: status === "scheduled" ? scheduledAt : null,
      status,
      ...(banner ? { bannerImage: banner } : {}),
      sender: {
        id: req.id,
        name:
          sender?.store_name || sender?.contact_person_name || "Marketing Team",
        role: sender?.role || req.role || "marketing",
      },
    });

    if (sendNow) {
      // Respond as soon as the campaign is durable; the fan-out continues in
      // the background so the marketing UI never waits on thousands of pushes.
      const result = await startBroadcast(notification._id);
      const fresh = await Notification.findById(notification._id).lean();
      return res.status(201).json({
        success: true,
        message: result.queued
          ? "Notification is being sent to all vendors"
          : result.message,
        notification: publicNotification(fresh || notification),
        pushConfigured: isPushConfigured(),
        ...(isPushConfigured() ? {} : { warning: pushUnavailableReason() }),
      });
    }

    return res.status(201).json({
      success: true,
      message:
        notification.status === "scheduled"
          ? "Notification scheduled"
          : "Draft saved",
      notification: publicNotification(notification),
    });
  } catch (er) {
    console.error("createNotification error:", er);
    // Don't leave an orphaned upload behind if the write failed.
    if (banner) await destroyBanner(banner.publicId);
    return fail(res, 500, "Could not create the notification");
  }
};

/**
 * PUT /notifications/:id     (marketing)
 * Edits a campaign that has not been sent yet (draft or scheduled).
 */
export const updateNotification = async (req, res) => {
  let banner = null;

  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const existing = await Notification.findOne({ _id: id, deleted: false });
    if (!existing) return fail(res, 404, "Notification not found");

    if (!["draft", "scheduled"].includes(existing.status)) {
      return fail(
        res,
        409,
        "Only drafts and scheduled notifications can be edited. Duplicate it instead."
      );
    }

    const parsed = readComposerFields(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);

    const { scheduledAt, ...fields } = parsed.data;

    if (req.file) banner = await uploadBanner(req.file);
    const removeBanner = bool(req.body.removeBanner, false);

    const previousPublicId = existing.bannerImage?.publicId || "";

    Object.assign(existing, fields);
    existing.scheduledAt =
      scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : null;
    existing.status = existing.scheduledAt ? "scheduled" : "draft";

    if (banner) existing.bannerImage = banner;
    else if (removeBanner) existing.bannerImage = { url: "", publicId: "" };

    await existing.save();

    // Only drop the old creative once the new record is safely persisted.
    if ((banner || removeBanner) && previousPublicId) {
      await destroyBanner(previousPublicId);
    }

    return res.status(200).json({
      success: true,
      message: "Notification updated",
      notification: publicNotification(existing),
    });
  } catch (er) {
    console.error("updateNotification error:", er);
    if (banner) await destroyBanner(banner.publicId);
    return fail(res, 500, "Could not update the notification");
  }
};

/**
 * DELETE /notifications/:id  (marketing)
 * Drafts are removed outright. A campaign that was already sent is soft-deleted
 * so its delivery analytics and the vendors' inbox rows survive.
 */
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const existing = await Notification.findOne({ _id: id, deleted: false });
    if (!existing) return fail(res, 404, "Notification not found");

    if (existing.status === "sending") {
      return fail(res, 409, "This notification is currently being sent");
    }

    if (["draft", "scheduled"].includes(existing.status)) {
      await destroyBanner(existing.bannerImage?.publicId);
      await Notification.deleteOne({ _id: id });
      // A draft has no receipts, but stay defensive.
      await NotificationReceipt.deleteMany({ notification: id });
      return res
        .status(200)
        .json({ success: true, message: "Draft deleted" });
    }

    existing.deleted = true;
    await existing.save();

    return res
      .status(200)
      .json({ success: true, message: "Notification removed from history" });
  } catch (er) {
    console.error("deleteNotification error:", er);
    return fail(res, 500, "Could not delete the notification");
  }
};

/**
 * Kicks off a broadcast without making the HTTP caller wait for the fan-out.
 * Errors are captured on the campaign document (status + lastError), which the
 * marketing screen polls — nothing is ever silently lost.
 */
const startBroadcast = (notificationId, opts = {}) => {
  const run = broadcastNotification(notificationId, opts)
    .then((result) => {
      if (!result.ok) {
        console.error(
          `[notifications] broadcast ${notificationId} rejected: ${result.message}`
        );
      }
      return result;
    })
    .catch((er) => {
      console.error(`[notifications] broadcast ${notificationId} threw:`, er);
      return { ok: false, message: er.message };
    });

  // Surface the immediate rejection reason (already sending, not found, …)
  // while letting a healthy run continue in the background.
  return Promise.race([
    run,
    new Promise((resolve) => setTimeout(() => resolve({ queued: true }), 400)),
  ]).then((r) => (r.queued ? r : { queued: r.ok, message: r.message }));
};

/**
 * POST /notifications/:id/send     (marketing)
 * Sends a draft / scheduled campaign now. Also serves "Resend" for a campaign
 * that was already sent — receipts are deduplicated, so existing recipients are
 * not doubled up; only vendors added since the first send get a new row.
 */
export const sendNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const existing = await Notification.findOne({ _id: id, deleted: false }).lean();
    if (!existing) return fail(res, 404, "Notification not found");
    if (existing.status === "sending") {
      return fail(res, 409, "This notification is already being sent");
    }

    const result = await startBroadcast(id);

    return res.status(200).json({
      success: result.queued !== false,
      message: result.queued
        ? "Notification is being sent to all vendors"
        : result.message || "Could not send the notification",
      pushConfigured: isPushConfigured(),
      ...(isPushConfigured() ? {} : { warning: pushUnavailableReason() }),
    });
  } catch (er) {
    console.error("sendNotification error:", er);
    return fail(res, 500, "Could not send the notification");
  }
};

/**
 * POST /notifications/:id/retry    (marketing)
 * Re-attempts delivery only for the vendors whose push failed or never ran.
 */
export const retryNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const existing = await Notification.findOne({ _id: id, deleted: false }).lean();
    if (!existing) return fail(res, 404, "Notification not found");
    if (existing.status === "sending") {
      return fail(res, 409, "This notification is already being sent");
    }
    if (existing.status === "draft" || existing.status === "scheduled") {
      return fail(res, 409, "This notification has not been sent yet");
    }

    const result = await startBroadcast(id, { retryOnly: true });

    return res.status(200).json({
      success: result.queued !== false,
      message: result.queued
        ? "Retrying delivery to the vendors that were not reached"
        : result.message || "Nothing to retry",
    });
  } catch (er) {
    console.error("retryNotification error:", er);
    return fail(res, 500, "Could not retry the notification");
  }
};

/**
 * POST /notifications/:id/duplicate  (marketing)
 * Clones a sent campaign back into a draft so it can be edited and re-sent.
 */
export const duplicateNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const source = await Notification.findOne({ _id: id, deleted: false }).lean();
    if (!source) return fail(res, 404, "Notification not found");

    const sender = await Vendor.findById(req.id)
      .select("store_name contact_person_name role")
      .lean();

    const copy = await Notification.create({
      title: source.title,
      subtitle: source.subtitle,
      message: source.message,
      category: source.category,
      priority: source.priority,
      buttonText: source.buttonText,
      redirectScreen: source.redirectScreen,
      deepLink: source.deepLink,
      imageUrl: source.imageUrl,
      // The Cloudinary asset is shared with the original; publicId is left
      // blank on the copy so deleting the copy never destroys the original's
      // creative.
      bannerImage: { url: source.bannerImage?.url || "", publicId: "" },
      icon: source.icon,
      expiryDate: source.expiryDate,
      pinned: source.pinned,
      status: "draft",
      sender: {
        id: req.id,
        name:
          sender?.store_name || sender?.contact_person_name || "Marketing Team",
        role: sender?.role || req.role || "marketing",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Draft created from this notification",
      notification: publicNotification(copy),
    });
  } catch (er) {
    console.error("duplicateNotification error:", er);
    return fail(res, 500, "Could not duplicate the notification");
  }
};

/**
 * GET /notifications         (marketing)
 * History with search + filters + pagination.
 *   ?q=&status=&category=&priority=&page=1&limit=20
 */
export const listNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { deleted: false };

    const status = str(req.query.status, 20);
    if (status && status !== "all") filter.status = status;

    const category = str(req.query.category, 60);
    if (category && category !== "all") filter.category = category;

    const priority = str(req.query.priority, 20);
    if (priority && priority !== "all") filter.priority = priority;

    const q = str(req.query.q, 120);
    if (q) {
      // Regex (not $text) so partial words match as the user types. Escaped so
      // a stray "(" from the search box can't break the query.
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      filter.$or = [{ title: rx }, { subtitle: rx }, { message: rx }];
    }

    const [docs, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      hasMore: page * limit < total,
      notifications: docs.map((d) => publicNotification(d)),
      pushConfigured: isPushConfigured(),
    });
  } catch (er) {
    console.error("listNotifications error:", er);
    return fail(res, 500, "Could not load the notification history");
  }
};

/**
 * GET /notifications/:id     (marketing)
 * One campaign with live delivery analytics.
 */
export const getNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const doc = await Notification.findOne({ _id: id, deleted: false }).lean();
    if (!doc) return fail(res, 404, "Notification not found");

    const live = await receiptStats(id);

    return res
      .status(200)
      .json({ success: true, notification: publicNotification(doc, live) });
  } catch (er) {
    console.error("getNotification error:", er);
    return fail(res, 500, "Could not load the notification");
  }
};

/**
 * GET /notifications/:id/stats   (marketing)
 * Delivery analytics only — cheap enough for the stats screen to poll.
 */
export const getNotificationStats = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const doc = await Notification.findOne({ _id: id, deleted: false })
      .select("stats status sentAt lastError")
      .lean();
    if (!doc) return fail(res, 404, "Notification not found");

    const live = await receiptStats(id);

    return res.status(200).json({
      success: true,
      status: doc.status,
      sentAt: doc.sentAt || null,
      lastError: doc.lastError || "",
      stats: {
        targeted: doc.stats?.targeted || 0,
        tokens: doc.stats?.tokens || 0,
        sent: doc.stats?.sent || 0,
        failed: doc.stats?.failed || 0,
        retryCount: doc.stats?.retryCount || 0,
        ...live,
      },
    });
  } catch (er) {
    console.error("getNotificationStats error:", er);
    return fail(res, 500, "Could not load the delivery statistics");
  }
};

/**
 * GET /notifications/audience   (marketing)
 * How many vendors a broadcast would reach right now — shown in the composer's
 * preview so the sender knows the real audience size before pressing Send.
 */
export const getAudienceSummary = async (req, res) => {
  try {
    const vendorIds = await resolveEligibleVendorIds();

    const reachable = vendorIds.length
      ? await DeviceToken.distinct("user", {
          user: { $in: vendorIds },
          enabled: true,
        })
      : [];

    return res.status(200).json({
      success: true,
      eligibleVendors: vendorIds.length,
      reachableVendors: reachable.length,
      pushConfigured: isPushConfigured(),
      ...(isPushConfigured() ? {} : { warning: pushUnavailableReason() }),
    });
  } catch (er) {
    console.error("getAudienceSummary error:", er);
    return fail(res, 500, "Could not load the audience summary");
  }
};

// =============================================================================
// Vendor notification center
// =============================================================================

/**
 * GET /notifications/inbox     (vendor)
 * The signed-in vendor's notification center. Pinned first, newest first.
 *   ?page=1&limit=30&unreadOnly=true&category=
 */
export const getInbox = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

    const match = {
      vendor: new mongoose.Types.ObjectId(String(req.id)),
      deleted: false,
    };
    if (bool(req.query.unreadOnly, false)) match.read = false;

    const now = new Date();

    // The campaign filter lives in the $lookup pipeline so an expired or
    // soft-deleted campaign never reaches the vendor.
    const pipeline = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "notifications",
          localField: "notification",
          foreignField: "_id",
          as: "campaign",
          pipeline: [
            {
              $match: {
                deleted: false,
                $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
              },
            },
          ],
        },
      },
      { $unwind: "$campaign" },
    ];

    const category = str(req.query.category, 60);
    if (category && category !== "all") {
      pipeline.push({ $match: { "campaign.category": category } });
    }

    pipeline.push(
      { $sort: { "campaign.pinned": -1, createdAt: -1 } },
      {
        $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          count: [{ $count: "total" }],
          unread: [{ $match: { read: false } }, { $count: "total" }],
        },
      }
    );

    const [result] = await NotificationReceipt.aggregate(pipeline);

    const rows = result?.rows || [];
    const total = result?.count?.[0]?.total || 0;
    const unread = result?.unread?.[0]?.total || 0;

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      unread,
      hasMore: page * limit < total,
      notifications: rows.map((r) => publicInboxItem(r, r.campaign)),
    });
  } catch (er) {
    console.error("getInbox error:", er);
    return fail(res, 500, "Could not load your notifications");
  }
};

/**
 * GET /notifications/inbox/unread-count   (vendor)
 * Drives the bell badge. Deliberately tiny — it is polled.
 */
export const getUnreadCount = async (req, res) => {
  try {
    const now = new Date();

    const [row] = await NotificationReceipt.aggregate([
      {
        $match: {
          vendor: new mongoose.Types.ObjectId(String(req.id)),
          deleted: false,
          read: false,
        },
      },
      {
        $lookup: {
          from: "notifications",
          localField: "notification",
          foreignField: "_id",
          as: "campaign",
          pipeline: [
            {
              $match: {
                deleted: false,
                $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
              },
            },
            { $project: { _id: 1 } },
          ],
        },
      },
      { $match: { "campaign.0": { $exists: true } } },
      { $count: "total" },
    ]);

    return res
      .status(200)
      .json({ success: true, unread: row?.total || 0 });
  } catch (er) {
    console.error("getUnreadCount error:", er);
    return fail(res, 500, "Could not load your unread count");
  }
};

/** Loads one of the caller's receipts by either receipt id or campaign id. */
const findOwnReceipt = async (userId, id) => {
  const vendor = new mongoose.Types.ObjectId(String(userId));
  const objectId = new mongoose.Types.ObjectId(String(id));

  return NotificationReceipt.findOne({
    vendor,
    $or: [{ _id: objectId }, { notification: objectId }],
  });
};

/**
 * POST /notifications/inbox/:id/read      (vendor)
 * Marks one notification read. Accepts a receipt id OR a campaign id, so the
 * push handler (which only knows the campaign id) can use it directly.
 */
export const markRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const receipt = await findOwnReceipt(req.id, id);
    if (!receipt) return fail(res, 404, "Notification not found");

    // Only count the first transition so the analytics never inflate.
    if (!receipt.read) {
      receipt.read = true;
      receipt.readAt = new Date();
      if (!receipt.delivered) {
        receipt.delivered = true;
        receipt.deliveredAt = receipt.readAt;
        await Notification.updateOne(
          { _id: receipt.notification },
          { $inc: { "stats.delivered": 1 } }
        );
      }
      await receipt.save();
      await Notification.updateOne(
        { _id: receipt.notification },
        { $inc: { "stats.read": 1 } }
      );
    }

    return res.status(200).json({ success: true, message: "Marked as read" });
  } catch (er) {
    console.error("markRead error:", er);
    return fail(res, 500, "Could not mark the notification as read");
  }
};

/**
 * POST /notifications/inbox/read-all      (vendor)
 */
export const markAllRead = async (req, res) => {
  try {
    const vendor = new mongoose.Types.ObjectId(String(req.id));

    const unread = await NotificationReceipt.find({
      vendor,
      read: false,
      deleted: false,
    })
      .select("_id notification delivered")
      .lean();

    if (!unread.length) {
      return res.status(200).json({ success: true, updated: 0 });
    }

    const now = new Date();
    await NotificationReceipt.updateMany(
      { _id: { $in: unread.map((r) => r._id) } },
      {
        $set: {
          read: true,
          readAt: now,
          delivered: true,
          deliveredAt: now,
        },
      }
    );

    // Roll the campaign counters forward in one bulk pass.
    const perCampaign = new Map();
    for (const r of unread) {
      const key = String(r.notification);
      const entry = perCampaign.get(key) || { read: 0, delivered: 0 };
      entry.read += 1;
      if (!r.delivered) entry.delivered += 1;
      perCampaign.set(key, entry);
    }

    await Notification.bulkWrite(
      [...perCampaign.entries()].map(([id, inc]) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(id) },
          update: {
            $inc: { "stats.read": inc.read, "stats.delivered": inc.delivered },
          },
        },
      })),
      { ordered: false }
    );

    return res
      .status(200)
      .json({ success: true, updated: unread.length, message: "All marked read" });
  } catch (er) {
    console.error("markAllRead error:", er);
    return fail(res, 500, "Could not mark your notifications as read");
  }
};

/**
 * POST /notifications/inbox/:id/delivered   (vendor)
 * The device acknowledging that the push actually arrived — this is what turns
 * "sent to FCM" into a confirmed delivery in the analytics. Idempotent.
 */
export const markDelivered = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const receipt = await findOwnReceipt(req.id, id);
    if (!receipt) return fail(res, 404, "Notification not found");

    if (!receipt.delivered) {
      receipt.delivered = true;
      receipt.deliveredAt = new Date();
      await receipt.save();
      await Notification.updateOne(
        { _id: receipt.notification },
        { $inc: { "stats.delivered": 1 } }
      );
    }

    return res.status(200).json({ success: true });
  } catch (er) {
    console.error("markDelivered error:", er);
    return fail(res, 500, "Could not acknowledge the notification");
  }
};

/**
 * POST /notifications/inbox/:id/opened    (vendor)
 * The vendor tapped the push / opened the detail screen. Implies delivered+read.
 */
export const markOpened = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const receipt = await findOwnReceipt(req.id, id);
    if (!receipt) return fail(res, 404, "Notification not found");

    const now = new Date();
    const inc = {};

    if (!receipt.opened) {
      receipt.opened = true;
      receipt.openedAt = now;
      inc["stats.opened"] = 1;
    }
    if (!receipt.delivered) {
      receipt.delivered = true;
      receipt.deliveredAt = now;
      inc["stats.delivered"] = 1;
    }
    if (!receipt.read) {
      receipt.read = true;
      receipt.readAt = now;
      inc["stats.read"] = 1;
    }

    if (Object.keys(inc).length) {
      await receipt.save();
      await Notification.updateOne({ _id: receipt.notification }, { $inc: inc });
    }

    return res.status(200).json({ success: true });
  } catch (er) {
    console.error("markOpened error:", er);
    return fail(res, 500, "Could not record the notification open");
  }
};

/**
 * DELETE /notifications/inbox/:id     (vendor)
 * Removes the notification from THIS vendor's center only (soft delete, so the
 * dedup guarantee and the campaign analytics stay intact).
 */
export const deleteInboxItem = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return fail(res, 400, "Invalid notification id");

    const receipt = await findOwnReceipt(req.id, id);
    if (!receipt) return fail(res, 404, "Notification not found");

    if (!receipt.deleted) {
      receipt.deleted = true;
      receipt.deletedAt = new Date();
      await receipt.save();
    }

    return res.status(200).json({ success: true, message: "Notification removed" });
  } catch (er) {
    console.error("deleteInboxItem error:", er);
    return fail(res, 500, "Could not remove the notification");
  }
};

/**
 * GET /notifications/inbox/settings   (vendor)
 * Current push opt-in state for the signed-in account.
 */
export const getNotificationSettings = async (req, res) => {
  try {
    const [user, devices] = await Promise.all([
      Vendor.findById(req.id).select("notificationsEnabled").lean(),
      DeviceToken.countDocuments({ user: req.id, enabled: true }),
    ]);

    if (!user) return fail(res, 404, "Account not found");

    return res.status(200).json({
      success: true,
      notificationsEnabled: user.notificationsEnabled !== false,
      registeredDevices: devices,
      pushConfigured: isPushConfigured(),
    });
  } catch (er) {
    console.error("getNotificationSettings error:", er);
    return fail(res, 500, "Could not load your notification settings");
  }
};

/**
 * GET /notifications/meta
 * The category / priority vocabularies, so the Flutter composer never
 * hardcodes a list that could drift from the schema's enum.
 */
export const getNotificationMeta = async (_req, res) => {
  return res.status(200).json({
    success: true,
    categories: NOTIFICATION_CATEGORIES,
    priorities: NOTIFICATION_PRIORITIES,
    pushConfigured: isPushConfigured(),
  });
};
