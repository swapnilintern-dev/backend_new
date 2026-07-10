// =============================================================================
// Invoice generator — the SINGLE place that turns an order into the official
// invoice PDF using templates/invoice.html (via generateInvoiceHTML).
//
// Renders the template → PDF (Puppeteer) → uploads to Cloudinary → creates the
// Invoice document → links it on the order. Every order surface in the app
// (vendor / marketing / admin) reads that PDF through GET /prev-invoice/:id, so
// generating here is what makes YOUR template appear everywhere.
//
// • Idempotent: if the order already has an invoice it is returned as-is, so
//   this is safe to call from more than one lifecycle point.
// • Non-fatal: a PDF-engine/Cloudinary failure returns null instead of throwing,
//   so the order lifecycle (accept) is never blocked by invoice generation.
//
// The invoice.html template itself is NOT modified — this only feeds it data.
// =============================================================================

import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import invoice from "../model/invoiceModel.js";
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
import { generatePDF } from "./generatePdf.js";
import cloudinary from "./cloudinary.js";

const inr = { day: "2-digit", month: "long", year: "numeric" };

/**
 * Generates (or returns the existing) invoice for [orderId].
 * @returns the Invoice document, or null if it could not be generated.
 */
export const generateInvoiceForOrder = async (orderId) => {
    try {
        const Order = await order
            .findById(orderId)
            .populate("orderItems.product");

        if (!Order) return null;

        // Already generated — reuse it (idempotent; e.g. a vendor-placed order
        // that got its invoice at placement should not be regenerated on accept).
        if (Order.invoice) {
            return await invoice.findById(Order.invoice);
        }

        const items = Order.orderItems || [];
        if (items.length === 0) return null;

        // The vendor the order belongs to — supplies the shop header fields.
        const user = await Vendor.findById(Order.user);
        if (!user) return null;

        const lineAmount = (it) =>
            (it.orderPrice ?? it.product?.price ?? 0) * it.quantity;

        // GST slab summary — prices are GST-inclusive, so the embedded tax is
        // extracted per slab (mirrors the original placeOrder logic exactly).
        const slabs = { 5: 0, 12: 0, 18: 0, 28: 0 };
        for (const it of items) {
            const pct = Number(it.product?.gstPercent) || 0;
            const amt = lineAmount(it);
            if (slabs[pct] !== undefined) slabs[pct] += amt - amt / (1 + pct / 100);
        }
        const gstTotal = slabs[5] + slabs[12] + slabs[18] + slabs[28];

        const totalQty = items.reduce((q, it) => q + it.quantity, 0);
        const grossTotal = items.reduce((t, it) => t + lineAmount(it), 0);

        // CGST and SGST are simply the total GST split into two equal halves
        // (same-state sale: half goes to the centre, half to the state).
        const cgst = gstTotal / 2;
        const sgst = gstTotal / 2;

        // Round-off = difference between the gross total and its nearest
        // whole rupee, e.g. gross 98.60 → payable 99 → round-off +0.40.
        const roundOff = Math.round(grossTotal) - grossTotal;

        const invoiceNumber = `INV-${Date.now()}`;

        const invoiceData = {
            shop_name: user.store_name,
            shop_address: user.full_address,
            gst_in: user.gst_no,
            dl_no: user.drug_lic_no,

            order_no: Order.orderNo,
            order_date: new Date(Order.createdAt || Date.now())
                .toLocaleDateString("en-IN", inr),
            invoice_no: invoiceNumber,
            invoice_date: new Date().toLocaleDateString("en-IN", inr),

            items: items.map((it) => ({
                title: it.product?.title,
                hsnCode: it.product?.hsnCode || "N/A",
                mrp: it.product?.mrp,
                gstPercent: it.product?.gstPercent,
                disPercent: it.product?.discountPercent || "N/A",
                manufacturer: it.product?.manufacturer || "N/A",
                marketedBy: it.product?.marketedBy || "N/A",
                batch_no: it.product?.batch_no || "N/A",
                exp_date: it.product?.exp_date || "N/A",
                quantity: it.quantity,
                price: it.orderPrice ?? it.product?.price,
                amount: lineAmount(it),
            })),

            total_item: items.length,
            total_qty: totalQty,
            gross_total: grossTotal,

            amount_words: Order.amountWord,
            amount: Order.totalAmount,

            // Keys match the template placeholders read by invoiceTemplate.js
            // ({{gst_5}}, {{gst_total}}, {{total_cgst}}, {{total_sgst}} …).
            gst_5: slabs[5].toFixed(2),
            gst_12: slabs[12].toFixed(2),
            gst_18: slabs[18].toFixed(2),
            gst_28: slabs[28].toFixed(2),
            gst_total: gstTotal.toFixed(2),
            total_cgst: cgst.toFixed(2),
            total_sgst: sgst.toFixed(2),
            round_off: roundOff.toFixed(2),
        };

        const html = generateInvoiceHTML(invoiceData);
        const pdfBuffer = await generatePDF(html);

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { resource_type: "auto", folder: "invoices" },
                (err, uploaded) => (err ? reject(err) : resolve(uploaded))
            );
            stream.end(pdfBuffer);
        });

        const createdInvoice = await invoice.create({
            invoiceNumber,
            order: Order._id,
            vendor: user._id,
            pdfUrl: result.secure_url,

            // Tax breakdown saved on the invoice record itself, so it can be
            // read later without re-parsing the PDF.
            subtotal: grossTotal - gstTotal,
            cgst,
            sgst,
            igst: 0,
            grandTotal: grossTotal,
        });

        Order.invoice = createdInvoice._id;
        await Order.save();

        return createdInvoice;
    } catch (err) {
        console.log("invoice generation failed (non-fatal):", err.message);
        return null;
    }
};

export default generateInvoiceForOrder;
