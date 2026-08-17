import mongoose from "mongoose";

import Vendor from "../model/userModel.js";
import DeviceToken from "../model/deviceTokenModel.js";
import Notification from "../model/notificationModel.js";
import NotificationReceipt from "../model/notificationReceiptModel.js";
import { sendToTokens, isPushConfigured, pushUnavailableReason } from "./fcm.js";

/**
 * The broadcast engine: turns one Notification document into a receipt per
 * eligible vendor plus a push to every one of their devices.
 *
 * Design notes
 *  • Idempotent — receipts carry a unique (notification, vendor) index, so a
 *    resend / retry / duplicate scheduler tick can never double-deliver.
 *  • Chunked — vendors, receipts and pushes are all processed in bounded
 *    batches so a campaign to thousands of vendors never loads everything at
 *    once or blocks the event loop for long.
 *  • Non-throwing — every failure path is recorded on the campaign
 *    (status + lastError + stats) instead of bubbling up and killing a request.
 */

// Staff accounts live in the same collection as vendors; they are never a
// broadcast target. Matched as a prefix so "marketing head" is caught too.
const STAFF_ROLE_PATTERN = /^(admin|marketing|delivery|agent|outlet)/i;

const VENDOR_CHUNK = 1000; // vendors resolved / receipts inserted per pass
const TOKEN_CHUNK = 2000; // device tokens loaded per pass

/**
 * Every vendor allowed to receive a broadcast:
 *   • not a staff account,
 *   • approved by an admin,
 *   • has not switched notifications off.
 *
 * @returns {Promise<mongoose.Types.ObjectId[]>}
 */
export const resolveEligibleVendorIds = async () => {
  const docs = await Vendor.find({
    role: { $not: STAFF_ROLE_PATTERN },
    approvalStatus: "Approved",
    // `$ne: false` also matches documents predating the field.
    notificationsEnabled: { $ne: false },
  })
    .select("_id")
    .lean();

  return docs.map((d) => d._id);
};

/** Inserts one receipt per vendor, ignoring the ones that already exist. */
const ensureReceipts = async (notificationId, vendorIds) => {
  let created = 0;

  for (let i = 0; i < vendorIds.length; i += VENDOR_CHUNK) {
    const chunk = vendorIds.slice(i, i + VENDOR_CHUNK);
    const rows = chunk.map((vendor) => ({
      notification: notificationId,
      vendor,
      pushStatus: "pending",
    }));

    try {
      // Unordered: duplicates are the expected steady state on a resend, so the
      // driver skips them and still inserts the rest.
      const res = await NotificationReceipt.insertMany(rows, { ordered: false });
      created += res.length;
    } catch (er) {
      // BulkWriteError: everything except duplicate-key (11000) is a real
      // problem worth logging; the successful inserts still landed.
      const inserted = er?.result?.insertedCount ?? er?.insertedDocs?.length ?? 0;
      created += inserted;

      const writeErrors = er?.writeErrors || [];
      const unexpected = writeErrors.filter((e) => (e.code ?? e.err?.code) !== 11000);
      if (unexpected.length) {
        console.error(
          `[broadcast] ${unexpected.length} receipt insert error(s) for ${notificationId}:`,
          unexpected[0]?.errmsg || unexpected[0]?.err?.errmsg
        );
      }
    }
  }

  return created;
};

/** Loads enabled device tokens for the given vendors, in bounded passes. */
const loadTokens = async (vendorIds) => {
  /** @type {Map<string, string[]>} vendorId -> tokens */
  const byVendor = new Map();
  /** @type {Map<string, string>} token -> vendorId */
  const owner = new Map();

  for (let i = 0; i < vendorIds.length; i += TOKEN_CHUNK) {
    const chunk = vendorIds.slice(i, i + TOKEN_CHUNK);
    const rows = await DeviceToken.find({
      user: { $in: chunk },
      enabled: true,
    })
      .select("user token")
      .lean();

    for (const row of rows) {
      const vid = String(row.user);
      if (!byVendor.has(vid)) byVendor.set(vid, []);
      byVendor.get(vid).push(row.token);
      owner.set(row.token, vid);
    }
  }

  return { byVendor, owner };
};

/** Removes tokens FCM rejected as permanently invalid. */
const pruneInvalidTokens = async (tokens) => {
  if (!tokens.length) return 0;
  try {
    const res = await DeviceToken.deleteMany({ token: { $in: tokens } });
    if (res.deletedCount) {
      console.log(`[broadcast] pruned ${res.deletedCount} invalid device token(s)`);
    }
    return res.deletedCount || 0;
  } catch (er) {
    console.error("[broadcast] token prune failed:", er.message);
    return 0;
  }
};

/** Applies the per-vendor push outcome to the receipts, in bulk. */
const writeReceiptOutcomes = async (notificationId, outcomes) => {
  const entries = [...outcomes.entries()];
  const now = new Date();

  for (let i = 0; i < entries.length; i += VENDOR_CHUNK) {
    const chunk = entries.slice(i, i + VENDOR_CHUNK);
    const ops = chunk.map(([vendorId, outcome]) => ({
      updateOne: {
        filter: {
          notification: notificationId,
          vendor: new mongoose.Types.ObjectId(vendorId),
        },
        update: {
          $set: {
            pushStatus: outcome.status,
            pushError: outcome.error || "",
            lastAttemptAt: now,
          },
          $inc: { attempts: 1 },
        },
      },
    }));

    if (!ops.length) continue;
    try {
      await NotificationReceipt.bulkWrite(ops, { ordered: false });
    } catch (er) {
      console.error("[broadcast] receipt outcome write failed:", er.message);
    }
  }
};

/**
 * Sends a campaign.
 *
 * @param {string} notificationId
 * @param {object} [opts]
 * @param {boolean} [opts.retryOnly=false]
 *        Only (re)send to vendors whose previous push failed or never ran.
 *        Used by "Retry failed" and the background sweeper.
 * @returns {Promise<{ok: boolean, stats?: object, message?: string}>}
 */
export const broadcastNotification = async (notificationId, opts = {}) => {
  const retryOnly = opts.retryOnly === true;

  // Claim the campaign atomically so two requests (or a request and the
  // scheduler) can never broadcast the same document concurrently.
  const allowedFrom = retryOnly
    ? ["sent", "failed"]
    : ["draft", "scheduled", "sent", "failed"];

  const claimed = await Notification.findOneAndUpdate(
    { _id: notificationId, deleted: false, status: { $in: allowedFrom } },
    { $set: { status: "sending", broadcastStartedAt: new Date(), lastError: "" } },
    { new: true }
  );

  if (!claimed) {
    const existing = await Notification.findById(notificationId).lean();
    if (!existing || existing.deleted) {
      return { ok: false, message: "Notification not found" };
    }
    if (existing.status === "sending") {
      return { ok: false, message: "This notification is already being sent" };
    }
    return {
      ok: false,
      message: `Cannot send a notification in state "${existing.status}"`,
    };
  }

  try {
    // ---- 1. Who gets it -----------------------------------------------------
    const vendorIds = await resolveEligibleVendorIds();

    if (!vendorIds.length) {
      await Notification.updateOne(
        { _id: notificationId },
        {
          $set: {
            status: "sent",
            sentAt: claimed.sentAt || new Date(),
            broadcastStartedAt: null,
            lastError: "No approved vendors with notifications enabled",
            "stats.targeted": 0,
          },
        }
      );
      return {
        ok: true,
        stats: { targeted: 0, tokens: 0, sent: 0, failed: 0 },
        message: "No eligible vendors to notify",
      };
    }

    // ---- 2. In-app notification center (always, push or not) ----------------
    if (!retryOnly) await ensureReceipts(notificationId, vendorIds);

    // On a retry, narrow to the vendors that still need a push.
    let targetVendorIds = vendorIds;
    if (retryOnly) {
      const pending = await NotificationReceipt.find({
        notification: notificationId,
        pushStatus: { $in: ["failed", "pending"] },
        deleted: false,
      })
        .select("vendor")
        .lean();
      const wanted = new Set(pending.map((r) => String(r.vendor)));
      targetVendorIds = vendorIds.filter((id) => wanted.has(String(id)));

      if (!targetVendorIds.length) {
        await Notification.updateOne(
          { _id: notificationId },
          { $set: { status: "sent", broadcastStartedAt: null }, $inc: { "stats.retryCount": 1 } }
        );
        return { ok: true, message: "Nothing left to retry", stats: claimed.stats };
      }
    }

    // ---- 3. Push -------------------------------------------------------------
    const { byVendor, owner } = await loadTokens(targetVendorIds);
    const allTokens = [...owner.keys()];

    const payload = {
      notificationId: String(claimed._id),
      title: claimed.title,
      subtitle: claimed.subtitle,
      message: claimed.message,
      category: claimed.category,
      priority: claimed.priority,
      imageUrl: claimed.imageUrl || claimed.bannerImage?.url || "",
      icon: claimed.icon,
      buttonText: claimed.buttonText,
      redirectScreen: claimed.redirectScreen,
      deepLink: claimed.deepLink,
      expiryDate: claimed.expiryDate,
      pinned: claimed.pinned,
      sentAt: claimed.sentAt || new Date(),
    };

    const result = await sendToTokens(allTokens, payload);

    // ---- 4. Fold the FCM result back into per-vendor outcomes ---------------
    const succeeded = new Set(result.successTokens);
    const failureByToken = new Map(
      result.failures.map((f) => [f.token, f])
    );

    /** @type {Map<string, {status: string, error: string}>} */
    const outcomes = new Map();
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const vendorId of targetVendorIds) {
      const vid = String(vendorId);
      const tokens = byVendor.get(vid) || [];

      if (!tokens.length) {
        outcomes.set(vid, {
          status: "skipped",
          error: result.configured
            ? "No registered device"
            : result.reason || pushUnavailableReason(),
        });
        skippedCount++;
        continue;
      }

      if (tokens.some((t) => succeeded.has(t))) {
        outcomes.set(vid, { status: "sent", error: "" });
        sentCount++;
        continue;
      }

      const firstFailure = tokens
        .map((t) => failureByToken.get(t))
        .find(Boolean);

      outcomes.set(vid, {
        status: result.configured ? "failed" : "skipped",
        error: result.configured
          ? firstFailure?.message || "Push rejected"
          : result.reason || pushUnavailableReason(),
      });

      if (result.configured) failedCount++;
      else skippedCount++;
    }

    await writeReceiptOutcomes(notificationId, outcomes);
    await pruneInvalidTokens(result.invalidTokens);

    // ---- 5. Campaign stats ---------------------------------------------------
    const update = {
      $set: {
        status: "sent",
        sentAt: claimed.sentAt || new Date(),
        broadcastStartedAt: null,
        "stats.targeted": vendorIds.length,
        lastError: result.configured
          ? failedCount
            ? `${failedCount} vendor(s) could not be reached`
            : ""
          : result.reason || pushUnavailableReason(),
      },
      $inc: {
        "stats.tokens": allTokens.length,
        "stats.sent": sentCount,
        "stats.failed": failedCount,
        ...(retryOnly ? { "stats.retryCount": 1 } : {}),
      },
    };

    await Notification.updateOne({ _id: notificationId }, update);

    console.log(
      `[broadcast] ${notificationId} → targeted=${vendorIds.length} ` +
        `tokens=${allTokens.length} sent=${sentCount} failed=${failedCount} ` +
        `skipped=${skippedCount}${retryOnly ? " (retry)" : ""}`
    );

    return {
      ok: true,
      stats: {
        targeted: vendorIds.length,
        tokens: allTokens.length,
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
        pushConfigured: result.configured,
      },
      message: result.configured
        ? undefined
        : result.reason || pushUnavailableReason(),
    };
  } catch (er) {
    console.error("[broadcast] failed:", er);
    await Notification.updateOne(
      { _id: notificationId },
      {
        $set: {
          status: "failed",
          broadcastStartedAt: null,
          lastError: er.message?.slice(0, 500) || "Broadcast failed",
        },
      }
    ).catch(() => {});
    return { ok: false, message: er.message || "Broadcast failed" };
  }
};

export { isPushConfigured, pushUnavailableReason };
