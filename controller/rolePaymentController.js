// =============================================================================
// Payments collected by staff roles — Outlet counter payments and Delivery
// doorstep payments. Both reuse the app's existing Razorpay account/util.
//
// Outlet (order.outlet must be the caller's outlet id):
//   POST /vsArogya/outlet/orders/:id/razorpay  → on-device checkout order
//   POST /vsArogya/outlet/orders/:id/verify    → signature check → PAID
//   POST /vsArogya/outlet/orders/:id/payment   → Razorpay Payment Link (QR/link)
//   GET  /vsArogya/outlet/orders/:id/status    → outlet-vocabulary status poll
//
// Delivery (caller must hold a role:"delivery" token):
//   POST /vsArogya/delivery/payment-link/:id   → Payment Link for the doorstep
//   GET  /vsArogya/delivery/payment-status/:id → server-verified paid? poll
//
// LOCKED RULE: a client NEVER marks an order paid. paymentInfo.status flips to
// "Completed" here only after (a) a verified Razorpay signature, or (b) Razorpay
// itself reports the payment link as paid when we fetch it.
// =============================================================================

import order from "../model/orderModel.js";
import razorpay from "../utils/razorpay.js";
import crypto from "crypto";

// Payment links expire after 30 minutes; a fresh one is minted on request after
// that. (Razorpay enforces a minimum expire_by ~15 minutes in the future.)
const LINK_TTL_MS = 30 * 60 * 1000;

const isPaid = (orderDoc) =>
    orderDoc.paymentInfo && orderDoc.paymentInfo.status === "Completed";

// The outlet app's wire vocabulary (see AGENT_OUTLET_BACKEND_SPEC.md B4).
const outletWireStatus = (orderDoc) => {
    switch (orderDoc.orderStatus) {
        case "Cancelled": return "CANCELLED";
        case "Delivered": return "DELIVERED";
        case "Out for Delivery": return "OUT_FOR_DELIVERY";
        case "Shipped": return "READY_FOR_PICKUP";
        case "Confirm Order": return "PAID";
        default:
            return isPaid(orderDoc) ? "PAID" : "AWAITING_PAYMENT";
    }
};

// Loads the order and enforces that it belongs to the calling outlet. Returns
// { orderDoc } or { errStatus, errMessage }.
const loadOutletOrder = async (req) => {
    const orderDoc = await order.findById(req.params.id);
    if (!orderDoc) {
        return { errStatus: 404, errMessage: "Order not found" };
    }
    if (!orderDoc.outlet || orderDoc.outlet.toString() !== req.id) {
        return { errStatus: 403, errMessage: "Unauthorized" };
    }
    return { orderDoc };
};

// If the order has an outstanding payment link and isn't marked paid yet, ask
// Razorpay for the link's real state and settle the order when it reports
// "paid". This is what makes the QR / shared-link flow server-verified: the
// client only ever polls, the truth comes from Razorpay.
const reconcilePaymentLink = async (orderDoc) => {
    if (isPaid(orderDoc)) return;
    const linkId = orderDoc.paymentInfo && orderDoc.paymentInfo.link_id;
    if (!linkId) return;

    const link = await razorpay.paymentLink.fetch(linkId);
    if (link && link.status === "paid") {
        const payment =
            Array.isArray(link.payments) && link.payments.length > 0
                ? link.payments[0]
                : null;
        orderDoc.paymentInfo.status = "Completed";
        if (payment && payment.payment_id) {
            orderDoc.paymentInfo.razorpay_id = payment.payment_id;
        }
        orderDoc.paymentMethod = "ONLINE";
        orderDoc.paidAt = new Date();
        await orderDoc.save();
    }
};

// Returns the order's current, unexpired payment link — or mints a new one.
const ensurePaymentLink = async (orderDoc, description) => {
    const info = orderDoc.paymentInfo || {};
    const stillValid =
        info.link_id &&
        info.link_url &&
        info.link_expiresAt &&
        new Date(info.link_expiresAt).getTime() > Date.now();
    if (stillValid) {
        return {
            url: info.link_url,
            expiresAt: new Date(info.link_expiresAt)
        };
    }

    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    const link = await razorpay.paymentLink.create({
        amount: Math.round(orderDoc.totalAmount * 100), // paise, integer
        currency: "INR",
        accept_partial: false,
        description,
        // reference_id must be unique across links, so suffix a timestamp —
        // the order id alone would collide when a link expires and is re-minted.
        reference_id: `${orderDoc._id}-${Date.now()}`,
        expire_by: Math.floor(expiresAt.getTime() / 1000),
        notes: { orderId: orderDoc._id.toString() }
    });

    orderDoc.set("paymentInfo.link_id", link.id);
    orderDoc.set("paymentInfo.link_url", link.short_url);
    orderDoc.set("paymentInfo.link_expiresAt", expiresAt);
    if (!orderDoc.paymentInfo.status) {
        orderDoc.set("paymentInfo.status", "Pending");
    }
    orderDoc.paymentMethod = "ONLINE";
    await orderDoc.save();

    return { url: link.short_url, expiresAt };
};

// -----------------------------------------------------------------------------
// OUTLET
// -----------------------------------------------------------------------------

// POST /outlet/orders/:id/razorpay — mirrors the customer create-payment shape
// so the app's OutletOnlinePayment.fromJson parses it unchanged.
export const outletCreateRazorpay = async (req, res) => {
    try {
        const { orderDoc, errStatus, errMessage } = await loadOutletOrder(req);
        if (!orderDoc) {
            return res.status(errStatus).json({ success: false, message: errMessage });
        }
        if (isPaid(orderDoc)) {
            return res.status(400).json({
                success: false,
                message: "This order is already paid"
            });
        }

        const payCreate = await razorpay.orders.create({
            amount: Math.round(orderDoc.totalAmount * 100),
            currency: "INR",
            receipt: `outlet_${orderDoc._id}`
        });

        orderDoc.set("paymentInfo.razorpay_orderId", payCreate.id);
        orderDoc.set("paymentInfo.status", "Pending");
        orderDoc.paymentMethod = "ONLINE";
        await orderDoc.save();

        return res.status(200).json({
            success: true,
            message: "payment created",
            razorpayOrderId: payCreate.id,
            amount: payCreate.amount,
            currency: payCreate.currency,
            orderId: orderDoc._id,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (er) {
        console.log("outletCreateRazorpay error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// POST /outlet/orders/:id/verify — same HMAC recomputation as the customer
// verify-payment; scoped to the calling outlet's own order.
export const outletVerifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Missing payment fields"
            });
        }

        const { orderDoc, errStatus, errMessage } = await loadOutletOrder(req);
        if (!orderDoc) {
            return res.status(errStatus).json({ success: false, message: errMessage });
        }

        if (
            !orderDoc.paymentInfo ||
            orderDoc.paymentInfo.razorpay_orderId !== razorpay_order_id
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment does not match this order"
            });
        }

        const generatedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Payment verification failed"
            });
        }

        if (isPaid(orderDoc)) {
            return res.status(200).json({
                success: true,
                verified: true,
                status: outletWireStatus(orderDoc),
                message: "Payment already verified"
            });
        }

        orderDoc.paymentInfo.razorpay_id = razorpay_payment_id;
        orderDoc.paymentInfo.razorpay_signature = razorpay_signature;
        orderDoc.paymentInfo.status = "Completed";
        orderDoc.paymentMethod = "ONLINE";
        orderDoc.paidAt = new Date();
        await orderDoc.save();

        return res.status(200).json({
            success: true,
            verified: true,
            status: outletWireStatus(orderDoc),
            message: "Payment verified successfully"
        });
    } catch (er) {
        console.log("outletVerifyPayment error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// POST /outlet/orders/:id/payment — QR / payment-link session. Both methods
// return the same short_url: the QR the screen renders IS the link, and
// scanning it opens Razorpay's hosted checkout (UPI included).
export const outletCreatePaymentLink = async (req, res) => {
    try {
        const { orderDoc, errStatus, errMessage } = await loadOutletOrder(req);
        if (!orderDoc) {
            return res.status(errStatus).json({ success: false, message: errMessage });
        }
        if (isPaid(orderDoc)) {
            return res.status(200).json({
                success: true,
                orderId: orderDoc._id,
                amount: orderDoc.totalAmount,
                status: outletWireStatus(orderDoc),
                qrImageData: null,
                paymentLink: null,
                expiresAt: null
            });
        }

        const { url, expiresAt } = await ensurePaymentLink(
            orderDoc,
            `VS Arogya outlet order ${orderDoc.orderNo || orderDoc._id}`
        );

        return res.status(200).json({
            success: true,
            orderId: orderDoc._id,
            amount: orderDoc.totalAmount,
            status: outletWireStatus(orderDoc),
            qrImageData: url,
            paymentLink: url,
            expiresAt: expiresAt.toISOString()
        });
    } catch (er) {
        console.log("outletCreatePaymentLink error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// GET /outlet/orders/:id/status — the 3-second poll. Also the moment a pending
// payment link gets reconciled against Razorpay.
export const outletOrderStatus = async (req, res) => {
    try {
        const { orderDoc, errStatus, errMessage } = await loadOutletOrder(req);
        if (!orderDoc) {
            return res.status(errStatus).json({ success: false, message: errMessage });
        }

        try {
            await reconcilePaymentLink(orderDoc);
        } catch (er) {
            // Razorpay hiccup — answer with the last known state; the next poll
            // will try again.
            console.log("outlet reconcile error:", er && er.message);
        }

        return res.status(200).json({
            success: true,
            status: outletWireStatus(orderDoc),
            paid: isPaid(orderDoc)
        });
    } catch (er) {
        console.log("outletOrderStatus error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// -----------------------------------------------------------------------------
// DELIVERY (doorstep collection)
// -----------------------------------------------------------------------------

const requireDelivery = (req, res) => {
    if (req.role !== "delivery") {
        res.status(403).json({ success: false, message: "Unauthorized" });
        return false;
    }
    return true;
};

// POST /delivery/payment-link/:id — the agent asks the SERVER for the payment
// QR/link shown at the door; nothing is composed on the phone.
export const deliveryCreatePaymentLink = async (req, res) => {
    try {
        if (!requireDelivery(req, res)) return;

        const orderDoc = await order.findById(req.params.id);
        if (!orderDoc) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        if (isPaid(orderDoc)) {
            return res.status(200).json({
                success: true,
                paid: true,
                paymentLink: null,
                amount: orderDoc.totalAmount,
                expiresAt: null
            });
        }

        const { url, expiresAt } = await ensurePaymentLink(
            orderDoc,
            `VS Arogya order ${orderDoc.orderNo || orderDoc._id}`
        );

        return res.status(200).json({
            success: true,
            paid: false,
            paymentLink: url,
            amount: orderDoc.totalAmount,
            expiresAt: expiresAt.toISOString()
        });
    } catch (er) {
        console.log("deliveryCreatePaymentLink error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// GET /delivery/payment-status/:id — the doorstep poll: paid only when Razorpay
// says so.
export const deliveryPaymentStatus = async (req, res) => {
    try {
        if (!requireDelivery(req, res)) return;

        const orderDoc = await order.findById(req.params.id);
        if (!orderDoc) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        try {
            await reconcilePaymentLink(orderDoc);
        } catch (er) {
            console.log("delivery reconcile error:", er && er.message);
        }

        return res.status(200).json({
            success: true,
            paid: isPaid(orderDoc)
        });
    } catch (er) {
        console.log("deliveryPaymentStatus error:", er);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
