import express from "express";

import isAuthenticated from "../middlewares/isAuthenticated.js";
import requireRole from "../middlewares/requireRole.js";
import upload from "../middlewares/multer.js";
import {
  // device tokens + preferences (any signed-in account)
  registerDeviceToken,
  updateDeviceToken,
  deleteDeviceToken,
  updateNotificationPreference,
  getNotificationSettings,
  getNotificationMeta,
  // vendor notification center
  getInbox,
  getUnreadCount,
  markRead,
  markAllRead,
  markDelivered,
  markOpened,
  deleteInboxItem,
  // marketing panel
  createNotification,
  updateNotification,
  deleteNotification,
  sendNotification,
  retryNotification,
  duplicateNotification,
  listNotifications,
  getNotification,
  getNotificationStats,
  getAudienceSummary,
} from "../controller/notificationController.js";

const router = express.Router();

// Every route here requires a session. Broadcast routes additionally require
// the marketing role — the role comes from the signed JWT, so it can't be
// spoofed by the client.
const marketingOnly = [isAuthenticated, requireRole("marketing")];

// -----------------------------------------------------------------------------
// Shared (any signed-in account)
// -----------------------------------------------------------------------------
router.get("/notifications/meta", isAuthenticated, getNotificationMeta);

router.post("/notifications/device-token", isAuthenticated, registerDeviceToken);
router.put("/notifications/device-token", isAuthenticated, updateDeviceToken);
router.delete("/notifications/device-token", isAuthenticated, deleteDeviceToken);

router.get("/notifications/settings", isAuthenticated, getNotificationSettings);
router.put(
  "/notifications/preferences",
  isAuthenticated,
  updateNotificationPreference
);

// -----------------------------------------------------------------------------
// Vendor notification center
//
// Declared BEFORE the marketing "/notifications/:id" routes so "inbox" is never
// swallowed as an id.
// -----------------------------------------------------------------------------
router.get("/notifications/inbox", isAuthenticated, getInbox);
router.get("/notifications/inbox/unread-count", isAuthenticated, getUnreadCount);
router.post("/notifications/inbox/read-all", isAuthenticated, markAllRead);
router.post("/notifications/inbox/:id/read", isAuthenticated, markRead);
router.post("/notifications/inbox/:id/delivered", isAuthenticated, markDelivered);
router.post("/notifications/inbox/:id/opened", isAuthenticated, markOpened);
router.delete("/notifications/inbox/:id", isAuthenticated, deleteInboxItem);

// -----------------------------------------------------------------------------
// Marketing broadcast panel
// -----------------------------------------------------------------------------
router.get("/notifications/audience", ...marketingOnly, getAudienceSummary);
router.get("/notifications", ...marketingOnly, listNotifications);

// `upload.single` is a no-op for JSON bodies, so the composer can post either
// plain JSON or multipart (when it attaches a banner creative).
router.post(
  "/notifications",
  ...marketingOnly,
  upload.single("bannerImage"),
  createNotification
);
router.put(
  "/notifications/:id",
  ...marketingOnly,
  upload.single("bannerImage"),
  updateNotification
);

router.post("/notifications/:id/send", ...marketingOnly, sendNotification);
router.post("/notifications/:id/retry", ...marketingOnly, retryNotification);
router.post("/notifications/:id/duplicate", ...marketingOnly, duplicateNotification);
router.get("/notifications/:id/stats", ...marketingOnly, getNotificationStats);
router.get("/notifications/:id", ...marketingOnly, getNotification);
router.delete("/notifications/:id", ...marketingOnly, deleteNotification);

export default router;
