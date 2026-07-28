import Notification from "../model/notificationModel.js";
import NotificationReceipt from "../model/notificationReceiptModel.js";
import DeviceToken from "../model/deviceTokenModel.js";
import { broadcastNotification } from "./notificationBroadcast.js";

/**
 * Background maintenance for the notification system. Started once from
 * index.js after the database connects. Plain timers — no cron dependency, and
 * nothing here blocks the request path.
 *
 * Three jobs:
 *   1. SCHEDULED SEND — broadcast campaigns whose scheduledAt has arrived.
 *   2. STUCK RECOVERY — a campaign left in "sending" by a process restart is
 *      released so it can be retried instead of being stranded forever.
 *   3. RETRY SWEEP    — re-attempt vendors whose push failed transiently.
 *   4. TOKEN HYGIENE  — drop registrations no app has touched in months.
 */

const TICK_MS = 60 * 1000; // scheduled-send + stuck check
const RETRY_TICK_MS = 10 * 60 * 1000; // retry sweep
const HYGIENE_TICK_MS = 24 * 60 * 60 * 1000; // stale-token prune

/** A campaign stuck in "sending" for longer than this is considered crashed. */
const STUCK_AFTER_MS = 15 * 60 * 1000;

/** Give up retrying a campaign after this many automatic passes. */
const MAX_AUTO_RETRIES = 3;

/** Only retry campaigns sent within this window — older ones are stale news. */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A device token untouched for this long belongs to a dead install. */
const TOKEN_STALE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

let timers = [];
let running = { schedule: false, retry: false, hygiene: false };

const runScheduledSends = async () => {
  if (running.schedule) return;
  running.schedule = true;

  try {
    // 1. Release campaigns stranded by a restart mid-broadcast.
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS);
    const released = await Notification.updateMany(
      { status: "sending", broadcastStartedAt: { $lt: stuckBefore } },
      {
        $set: {
          status: "failed",
          broadcastStartedAt: null,
          lastError: "Send interrupted — will be retried",
        },
      }
    );
    if (released.modifiedCount) {
      console.log(
        `[notifications] released ${released.modifiedCount} stuck broadcast(s)`
      );
    }

    // 2. Fire anything whose schedule has come due.
    const due = await Notification.find({
      status: "scheduled",
      deleted: false,
      scheduledAt: { $ne: null, $lte: new Date() },
    })
      .select("_id title")
      .limit(20)
      .lean();

    for (const campaign of due) {
      console.log(
        `[notifications] scheduled send due: ${campaign._id} "${campaign.title}"`
      );
      // Sequential on purpose — each broadcast already fans out internally, and
      // this keeps a burst of due campaigns from saturating the dyno.
      const result = await broadcastNotification(campaign._id);
      if (!result.ok) {
        console.error(
          `[notifications] scheduled send failed for ${campaign._id}: ${result.message}`
        );
      }
    }
  } catch (er) {
    console.error("[notifications] scheduler tick failed:", er.message);
  } finally {
    running.schedule = false;
  }
};

const runRetrySweep = async () => {
  if (running.retry) return;
  running.retry = true;

  try {
    const since = new Date(Date.now() - RETRY_WINDOW_MS);

    const candidates = await Notification.find({
      status: { $in: ["sent", "failed"] },
      deleted: false,
      sentAt: { $gte: since },
      "stats.retryCount": { $lt: MAX_AUTO_RETRIES },
    })
      .select("_id title stats")
      .limit(20)
      .lean();

    for (const campaign of candidates) {
      const pending = await NotificationReceipt.countDocuments({
        notification: campaign._id,
        pushStatus: { $in: ["failed", "pending"] },
        deleted: false,
      });

      if (!pending) continue;

      console.log(
        `[notifications] retrying ${pending} undelivered receipt(s) for ${campaign._id}`
      );
      const result = await broadcastNotification(campaign._id, { retryOnly: true });
      if (!result.ok) {
        console.error(
          `[notifications] retry failed for ${campaign._id}: ${result.message}`
        );
      }
    }
  } catch (er) {
    console.error("[notifications] retry sweep failed:", er.message);
  } finally {
    running.retry = false;
  }
};

const runTokenHygiene = async () => {
  if (running.hygiene) return;
  running.hygiene = true;

  try {
    const cutoff = new Date(Date.now() - TOKEN_STALE_MS);
    const res = await DeviceToken.deleteMany({ lastSeenAt: { $lt: cutoff } });
    if (res.deletedCount) {
      console.log(
        `[notifications] pruned ${res.deletedCount} stale device token(s)`
      );
    }
  } catch (er) {
    console.error("[notifications] token hygiene failed:", er.message);
  } finally {
    running.hygiene = false;
  }
};

/** Starts the background jobs. Safe to call once; repeat calls are ignored. */
export const startNotificationScheduler = () => {
  if (timers.length) return;

  // `unref` so these timers never hold the process open on shutdown.
  const add = (fn, ms) => {
    const t = setInterval(() => {
      fn().catch((er) =>
        console.error("[notifications] job crashed:", er.message)
      );
    }, ms);
    if (typeof t.unref === "function") t.unref();
    timers.push(t);
  };

  add(runScheduledSends, TICK_MS);
  add(runRetrySweep, RETRY_TICK_MS);
  add(runTokenHygiene, HYGIENE_TICK_MS);

  // First pass shortly after boot, once the DB connection has settled.
  setTimeout(() => {
    runScheduledSends().catch(() => {});
  }, 10_000);

  console.log("[notifications] background scheduler started");
};

/** Stops the background jobs (used by tests / graceful shutdown). */
export const stopNotificationScheduler = () => {
  timers.forEach(clearInterval);
  timers = [];
};

export default { startNotificationScheduler, stopNotificationScheduler };
