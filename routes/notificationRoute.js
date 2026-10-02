import express from "express";

import isAuthenticated from "../middlewares/isAuthenticated.js";
import requireRole from "../middlewares/requireRole.js";
import upload from "../middlewares/multer.js";

// --- Per-user inbox (transactional: order placed, payment, vendor approved) --
import {
  createNotification as createUserNotification,
  getMyNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../controller/createNotificationController.js";

// --- Marketing broadcast campaigns + FCM device tokens ----------------------
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

// =============================================================================
// PER-USER INBOX
//
// Distinct paths from the broadcast panel below, so the two systems coexist.
// Every handler scopes on req.id, which only isAuthenticated sets — without it
// req.id is undefined and each one quietly returns nothing.
// =============================================================================
router.post("/createNotification", isAuthenticated, createUserNotification);
router.get("/get-notification", isAuthenticated, getMyNotifications);
router.get("/unread-notification", isAuthenticated, getUnreadNotificationCount);

// The handler reads req.params.notificationId, so the id has to be IN the path —
// without the segment the route matched but the lookup was always undefined,
// giving a 404 every time.
router.patch(
  "/mark-read-notification/:notificationId",
  isAuthenticated,
  markNotificationAsRead
);

// Declared with a leading slash (Express 5 does not add one) and as POST, since
// it mutates. The GET form was unreachable anyway.
router.post("/mark-all-read", isAuthenticated, markAllNotificationsAsRead);

// =============================================================================
// SHARED — device tokens + preferences (any signed-in account)
// =============================================================================
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

// =============================================================================
// VENDOR NOTIFICATION CENTER (broadcast receipts)
//
// Declared BEFORE the marketing "/notifications/:id" routes so "inbox" is never
// swallowed as an id.
// =============================================================================
router.get("/notifications/inbox", isAuthenticated, getInbox);
router.get("/notifications/inbox/unread-count", isAuthenticated, getUnreadCount);
router.post("/notifications/inbox/read-all", isAuthenticated, markAllRead);
router.post("/notifications/inbox/:id/read", isAuthenticated, markRead);
router.post("/notifications/inbox/:id/delivered", isAuthenticated, markDelivered);
router.post("/notifications/inbox/:id/opened", isAuthenticated, markOpened);
router.delete("/notifications/inbox/:id", isAuthenticated, deleteInboxItem);

// =============================================================================
// MARKETING BROADCAST PANEL
// =============================================================================
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
