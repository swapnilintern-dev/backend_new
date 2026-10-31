// =============================================================================
// Razorpay webhook — POST /vsArogya/razorpay/webhook
//
// Razorpay calls this directly, server-to-server, whenever a payment completes.
// It is the safety net for the client-side verify calls (verify-payment, outlet
// verify, payment-link polling): if the customer closes the tab, loses network
// or the app is killed after paying, the order would otherwise stay "Pending"
// even though the money was taken. This marks it paid anyway.
//
// Events handled (enable these in Razorpay Dashboard → Webhooks):
//   payment.captured   → order created via razorpay.orders.create
//   order.paid         → same, sent once the Razorpay order is fully paid
//   payment_link.paid  → outlet QR / delivery doorstep payment links
//
// Security: the request is trusted ONLY after its X-Razorpay-Signature matches
// an HMAC-SHA256 of the RAW body with RAZORPAY_WEBHOOK_SECRET (the secret typed
// into the dashboard when the webhook is created — NOT the API key secret).
// That is why this route is mounted before express.json() in index.js: the
// signature is over the exact bytes Razorpay sent.
//
// Razorpay retries any non-2xx reply, so everything that is "not for us" or
// already done answers 200; only a missing secret / DB failure answers 5xx so
// the event is redelivered once the problem is fixed.
// =============================================================================

import crypto from "crypto";
import order from "../model/orderModel.js";

const signatureMatches = (rawBody, signature, secret) => {
    if (!signature || !rawBody) return false;
    const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(signature), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const isPaid = (orderDoc) =>
    orderDoc.paymentInfo && orderDoc.paymentInfo.status === "Completed";

const expectedPaise = (orderDoc) => Math.round(Number(orderDoc.totalAmount) * 100);

export const razorpayWebhook = async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
        console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not set — event NOT processed");
        return res.status(500).json({ success: false, message: "Webhook not configured" });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!signatureMatches(rawBody, req.headers["x-razorpay-signature"], secret)) {
        console.warn("[razorpay-webhook] signature mismatch — ignored");
        return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    let event;
    try {
        event = JSON.parse(rawBody.toString("utf8"));
    } catch {
        return res.status(400).json({ success: false, message: "Invalid JSON" });
    }

    try {
        const type = event?.event;
        const payment = event?.payload?.payment?.entity;
        let orderDoc = null;

        if (type === "payment.captured" || type === "order.paid") {
            const rzpOrderId =
                payment?.order_id || event?.payload?.order?.entity?.id;
            if (rzpOrderId) {
                orderDoc = await order.findOne({
                    "paymentInfo.razorpay_orderId": rzpOrderId,
                });
            }
        } else if (type === "payment_link.paid") {
            const linkId = event?.payload?.payment_link?.entity?.id;
            if (linkId) {
                orderDoc = await order.findOne({ "paymentInfo.link_id": linkId });
            }
        } else {
            // Some other event enabled on the dashboard — nothing to do.
            return res.status(200).json({ success: true, ignored: type });
        }

        if (!orderDoc) {
            // Not one of ours (e.g. a payment link's internal Razorpay order,
            // which is handled by payment_link.paid instead).
            console.log(`[razorpay-webhook] ${type}: no matching order`, payment?.id);
            return res.status(200).json({ success: true, matched: false });
        }

        if (isPaid(orderDoc)) {
            return res.status(200).json({ success: true, alreadyPaid: true });
        }

        if (payment && payment.status && payment.status !== "captured") {
            return res.status(200).json({ success: true, ignored: payment.status });
        }

        // Never mark an order paid for a different amount than it costs —
        // leave it Pending and loud in the logs for a person to look at.
        if (payment && Number(payment.amount) !== expectedPaise(orderDoc)) {
            console.error(
                `[razorpay-webhook] AMOUNT MISMATCH order=${orderDoc._id} ` +
                `paid=${payment.amount} expected=${expectedPaise(orderDoc)} payment=${payment.id}`
            );
            return res.status(200).json({ success: true, amountMismatch: true });
        }

        if (payment?.id) orderDoc.paymentInfo.razorpay_id = payment.id;
        orderDoc.paymentInfo.status = "Completed";
        orderDoc.paymentMethod = "ONLINE";
        orderDoc.paidAt = payment?.created_at
            ? new Date(payment.created_at * 1000)
            : new Date();
        await orderDoc.save();

        console.log(`[razorpay-webhook] ${type}: order ${orderDoc._id} marked paid (${payment?.id})`);
        return res.status(200).json({ success: true, updated: true });
    } catch (er) {
        console.error("[razorpay-webhook] error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export default razorpayWebhook;
