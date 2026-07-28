import admin from "firebase-admin";

/**
 * Firebase Cloud Messaging transport.
 *
 * Credentials come from the environment (never from the repo). Supply EITHER:
 *
 *   FIREBASE_SERVICE_ACCOUNT   the whole service-account JSON, one line
 *                              (or base64 of it — both are accepted)
 * or the three fields separately:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY       (literal "\n" escapes are un-escaped for you)
 *
 * When none of these are set the transport reports itself as not configured.
 * The broadcast then still records every notification and fills each vendor's
 * in-app notification center — only the push leg is skipped. Nothing throws.
 */

let app = null;
let initTried = false;
let initError = "";

/** Parses the service account from the environment. Returns null when absent. */
const readServiceAccount = () => {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();

  if (raw) {
    try {
      // Accept raw JSON or a base64-encoded blob (easier to paste into Render).
      const json = raw.startsWith("{")
        ? raw
        : Buffer.from(raw, "base64").toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      return parsed;
    } catch (er) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${er.message}`);
    }
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").trim();

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return null;
};

/** Lazily boots the admin SDK once per process. Returns the app or null. */
const getApp = () => {
  if (app) return app;
  if (initTried) return null;
  initTried = true;

  try {
    const serviceAccount = readServiceAccount();
    if (!serviceAccount) {
      initError =
        "Firebase credentials are not set (FIREBASE_SERVICE_ACCOUNT or " +
        "FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY). Push delivery is disabled.";
      console.warn("[fcm]", initError);
      return null;
    }

    app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });

    console.log(
      "[fcm] Firebase Admin initialised for project",
      serviceAccount.project_id
    );
    return app;
  } catch (er) {
    initError = er.message;
    console.error("[fcm] init failed:", er.message);
    return null;
  }
};

/** True when pushes can actually be sent. */
export const isPushConfigured = () => getApp() !== null;

/** Human-readable reason push is unavailable (empty when it is available). */
export const pushUnavailableReason = () => (getApp() ? "" : initError);

// FCM's sendEach accepts at most 500 messages per call.
const FCM_BATCH_SIZE = 500;

// How many batches are in flight at once. Keeps thousands of vendors fast
// without opening an unbounded number of sockets from a small Render dyno.
const BATCH_CONCURRENCY = 4;

/**
 * Errors worth another attempt — transient FCM/network conditions. Anything
 * else (bad token, bad payload, auth problem) is permanent for this message.
 */
const RETRYABLE_CODES = new Set([
  "messaging/server-unavailable",
  "messaging/internal-error",
  "messaging/unavailable",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/timeout",
  "messaging/unknown-error",
]);

/**
 * Errors that mean the token is dead and must be removed from the database.
 */
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/mismatched-credential",
  "messaging/invalid-recipient",
]);

const errorCodeOf = (error) =>
  (error && (error.code || error.errorInfo?.code)) || "unknown";

const errorMessageOf = (error) =>
  (error && (error.message || error.errorInfo?.message)) || "Unknown FCM error";

export const isInvalidTokenError = (code) => INVALID_TOKEN_CODES.has(code);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds the wire payload for one device.
 *
 * Both a `notification` block and a `data` block are sent:
 *   • `notification` is what Android/iOS render from the system tray while the
 *     app is backgrounded or terminated — this is what makes delivery work
 *     with the app killed, and what FCM stores-and-forwards when the device is
 *     offline (until `ttl` elapses).
 *   • `data` carries the full campaign so the app can render its own rich
 *     in-app banner in the foreground and route the tap.
 *
 * Every data value must be a string — FCM rejects other types.
 */
const buildMessage = (token, payload) => {
  const {
    notificationId,
    title,
    subtitle,
    message,
    category,
    priority,
    imageUrl,
    icon,
    buttonText,
    redirectScreen,
    deepLink,
    expiryDate,
    pinned,
    sentAt,
  } = payload;

  const critical = priority === "Critical" || priority === "High";

  // Time-to-live: FCM holds an undelivered message for offline devices until
  // this elapses. Bounded by the campaign's own expiry when it has one.
  const defaultTtlMs = 14 * 24 * 60 * 60 * 1000; // 14 days
  let ttlMs = defaultTtlMs;
  if (expiryDate) {
    const remaining = new Date(expiryDate).getTime() - Date.now();
    if (Number.isFinite(remaining)) {
      ttlMs = Math.max(60 * 1000, Math.min(defaultTtlMs, remaining));
    }
  }

  const data = {
    notificationId: String(notificationId),
    title: title || "",
    subtitle: subtitle || "",
    message: message || "",
    category: category || "",
    priority: priority || "Normal",
    imageUrl: imageUrl || "",
    icon: icon || "",
    buttonText: buttonText || "",
    redirectScreen: redirectScreen || "",
    deepLink: deepLink || "",
    pinned: pinned ? "true" : "false",
    sentAt: sentAt ? new Date(sentAt).toISOString() : new Date().toISOString(),
    // Lets the Flutter tap handler route without a round-trip.
    click_action: "FLUTTER_NOTIFICATION_CLICK",
  };

  return {
    token,
    notification: {
      title: title || "",
      body: message || "",
      ...(imageUrl ? { imageUrl } : {}),
    },
    data,
    android: {
      // "high" wakes a dozing device immediately — required for the
      // near-zero-delay guarantee on Android.
      priority: "high",
      ttl: ttlMs,
      // Collapsing on the campaign id means a re-send of the SAME campaign
      // replaces the pending copy instead of stacking a duplicate.
      collapseKey: String(notificationId),
      notification: {
        channelId: critical ? "medicaplus_critical" : "medicaplus_general",
        priority: critical ? "max" : "default",
        defaultSound: true,
        ...(imageUrl ? { imageUrl } : {}),
        // Long text expands in the tray shade.
        ...(subtitle ? { ticker: subtitle } : {}),
        tag: String(notificationId),
      },
    },
    apns: {
      headers: {
        "apns-priority": critical ? "10" : "5",
        "apns-push-type": "alert",
        "apns-collapse-id": String(notificationId).slice(0, 64),
        "apns-expiration": String(Math.floor((Date.now() + ttlMs) / 1000)),
      },
      payload: {
        aps: {
          alert: {
            title: title || "",
            ...(subtitle ? { subtitle } : {}),
            body: message || "",
          },
          sound: "default",
          // Required for the iOS notification-service extension to download
          // and attach the rich image.
          "mutable-content": 1,
        },
      },
      ...(imageUrl ? { fcmOptions: { imageUrl } } : {}),
    },
  };
};

/**
 * Sends one campaign to a list of device tokens.
 *
 * Runs in batches of 500 with bounded concurrency, retries transient failures
 * with exponential backoff, and reports which tokens are permanently invalid so
 * the caller can delete them.
 *
 * @param {string[]} tokens  device tokens (deduplicated by the caller)
 * @param {object}   payload campaign fields (see buildMessage)
 * @param {object}   [opts]
 * @param {number}   [opts.maxAttempts=3] total attempts per token
 * @returns {Promise<{
 *   configured: boolean,
 *   successTokens: string[],
 *   failures: Array<{token: string, code: string, message: string}>,
 *   invalidTokens: string[],
 *   reason: string
 * }>}
 */
export const sendToTokens = async (tokens, payload, opts = {}) => {
  const maxAttempts = opts.maxAttempts ?? 3;

  const unique = [...new Set((tokens || []).filter(Boolean))];

  if (!unique.length) {
    return {
      configured: isPushConfigured(),
      successTokens: [],
      failures: [],
      invalidTokens: [],
      reason: "",
    };
  }

  if (!isPushConfigured()) {
    return {
      configured: false,
      successTokens: [],
      failures: [],
      invalidTokens: [],
      reason: pushUnavailableReason(),
    };
  }

  const messaging = admin.messaging();

  const successTokens = [];
  const failures = [];
  const invalidTokens = [];

  // Tokens still awaiting a verdict; shrinks with every retry pass.
  let pending = unique;

  for (let attempt = 1; attempt <= maxAttempts && pending.length; attempt++) {
    const retryable = [];

    // Slice the pending list into FCM-sized batches.
    const batches = [];
    for (let i = 0; i < pending.length; i += FCM_BATCH_SIZE) {
      batches.push(pending.slice(i, i + FCM_BATCH_SIZE));
    }

    // Run BATCH_CONCURRENCY batches at a time.
    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
      const window = batches.slice(i, i + BATCH_CONCURRENCY);

      const results = await Promise.all(
        window.map(async (batch) => {
          try {
            const response = await messaging.sendEach(
              batch.map((token) => buildMessage(token, payload))
            );
            return { batch, response };
          } catch (er) {
            // Whole-batch failure (network / auth). Treat as retryable so a
            // blip doesn't lose an entire campaign.
            return { batch, fatal: er };
          }
        })
      );

      for (const result of results) {
        if (result.fatal) {
          const code = errorCodeOf(result.fatal);
          const message = errorMessageOf(result.fatal);
          const canRetry = RETRYABLE_CODES.has(code) || code === "unknown";
          for (const token of result.batch) {
            if (canRetry && attempt < maxAttempts) retryable.push(token);
            else failures.push({ token, code, message });
          }
          continue;
        }

        result.response.responses.forEach((res, idx) => {
          const token = result.batch[idx];
          if (res.success) {
            successTokens.push(token);
            return;
          }

          const code = errorCodeOf(res.error);
          const message = errorMessageOf(res.error);

          if (INVALID_TOKEN_CODES.has(code)) {
            invalidTokens.push(token);
            failures.push({ token, code, message });
            return;
          }

          if (RETRYABLE_CODES.has(code) && attempt < maxAttempts) {
            retryable.push(token);
            return;
          }

          failures.push({ token, code, message });
        });
      }
    }

    pending = retryable;

    if (pending.length && attempt < maxAttempts) {
      // Exponential backoff with a little jitter: 500ms, 1s, 2s …
      const backoff = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  return {
    configured: true,
    successTokens,
    failures,
    invalidTokens,
    reason: "",
  };
};

export default { sendToTokens, isPushConfigured, pushUnavailableReason };
