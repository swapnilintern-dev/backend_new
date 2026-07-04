import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import invoice from "../model/invoiceModel.js";
import cloudinary from "../utils/cloudinary.js";
// number-to-words is CommonJS — import the default export, then destructure
// (a named ESM import throws "Named export 'toWords' not found").
import numberToWords from "number-to-words";
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
import { generatePDF } from "../utils/generatePdf.js";

// --- small helpers ----------------------------------------------------------

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
};

const titleCase = (s) =>
  String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());

const fmtDate = (d) =>
  new Date(d || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

// A stable, human invoice number derived from the order id, so regenerating an
// invoice for the same order always yields the same number (idempotent upsert).
const invoiceNumberFor = (orderDoc) =>
  `INV-${String(orderDoc._id).slice(-8).toUpperCase()}`;

/**
 * Builds the full data object the invoice template expects from a populated
 * order document and its buyer. Item prices are treated as GST-inclusive (the
 * embedded tax is broken out per slab for the summary table).
 */
export function buildInvoiceData(orderDoc, user) {
  const items = (orderDoc.orderItems || []).map((it) => {
    const p = it.product || {};
    const qty = Number(it.quantity) || 0;
    const price = Number(it.orderPrice ?? p.price ?? 0);
    return {
      title: p.title || "Item",
      hsnCode: p.hsnCode || "N/A",
      manufacturer: p.manufacturer || "N/A",
      marketedBy: p.marketedBy || "N/A",
      quantity: qty,
      mrp: p.mrp ?? price,
      price,
      gstPercent: p.gstPercent ?? 0,
      disPercent: p.discountPercent ? `${p.discountPercent}%` : "N/A",
      amount: price * qty,
    };
  });

  const grossTotal = items.reduce((s, i) => s + i.amount, 0);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  // Break the tax embedded in each (inclusive) line amount out per GST slab.
  const slabs = { 5: 0, 12: 0, 18: 0, 28: 0 };
  for (const i of items) {
    const p = Number(i.gstPercent) || 0;
    if (!(p in slabs)) continue;
    slabs[p] += i.amount - i.amount / (1 + p / 100);
  }
  const gstTotal = slabs[5] + slabs[12] + slabs[18] + slabs[28];

  // The order's stored total is authoritative for the amount payable.
  const grandTotal = Number(orderDoc.totalAmount ?? grossTotal);
  const amountWords = `${titleCase(numberToWords.toWords(Math.round(grandTotal)))} Rupees Only`;

  return {
    shop_name: user?.store_name || user?.contact_person_name || "Customer",
    shop_address: user?.full_address || "-",
    // No GSTIN is stored on the account; show a dash rather than a wrong value.
    gst_in: "-",
    dl_no: user?.drug_lic_no || "-",

    order_no: orderDoc.orderNo || `ORD-${orderDoc._id}`,
    order_date: fmtDate(orderDoc.createdAt),
    invoice_no: invoiceNumberFor(orderDoc),
    invoice_date: fmtDate(Date.now()),

    items,
    total_item: items.length,
    total_qty: totalQty,
    gross_total: money(grossTotal),

    amount: money(grandTotal),
    amount_words: amountWords,

    gst5: money(slabs[5]),
    gst12: money(slabs[12]),
    gst18: money(slabs[18]),
    gst28: money(slabs[28]),
    gst_total: money(gstTotal),
    total_sgst: money(gstTotal / 2),
    total_cgst: money(gstTotal / 2),

    // carried through for the DB record
    _grossTotal: grossTotal,
    _grandTotal: grandTotal,
    _gstTotal: gstTotal,
  };
}

// Loads a populated order and verifies it belongs to the caller.
async function loadOrderForUser(orderId, userId) {
  const orderDoc = await order
    .findById(orderId)
    .populate("orderItems.product");

  if (!orderDoc) return { status: 404, message: "Order not found" };
  if (String(orderDoc.user) !== String(userId)) {
    return { status: 403, message: "You cannot access this invoice" };
  }
  const user = await Vendor.findById(orderDoc.user);
  return { orderDoc, user };
}

// Best-effort: upload the PDF to Cloudinary + upsert an invoice record. Never
// throws into the request path — a failure here must not break the download.
async function saveInvoiceRecord(orderDoc, user, data, pdfBuffer) {
  let pdfUrl = "";
  try {
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: "raw",
          folder: "invoices",
          public_id: data.invoice_no,
          format: "pdf",
          overwrite: true,
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(pdfBuffer);
    });
    pdfUrl = uploaded?.secure_url || "";
  } catch (e) {
    console.log("cloudinary invoice upload (non-fatal):", e.message);
  }

  try {
    await invoice.findOneAndUpdate(
      { invoiceNumber: data.invoice_no },
      {
        invoiceNumber: data.invoice_no,
        order: orderDoc._id,
        vendor: user?._id,
        pdfUrl,
        subtotal: data._grossTotal,
        cgst: data._gstTotal / 2,
        sgst: data._gstTotal / 2,
        igst: 0,
        grandTotal: data._grandTotal,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (e) {
    console.log("invoice record upsert (non-fatal):", e.message);
  }
  return pdfUrl;
}

// GET /invoice/:id/preview — the invoice rendered as HTML. Lightweight (no PDF
// engine), so the app can show a fast preview before downloading the PDF.
export const previewInvoice = async (req, res) => {
  try {
    const { orderDoc, user, status, message } = await loadOrderForUser(
      req.params.id,
      req.id
    );
    if (status) return res.status(status).json({ success: false, message });

    const html = generateInvoiceHTML(buildInvoiceData(orderDoc, user));
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (er) {
    console.log("previewInvoice error:", er);
    return res
      .status(500)
      .json({ success: false, message: "Could not build the invoice preview" });
  }
};

// GET /invoice/:id/pdf — the invoice as a downloadable PDF. Also caches a copy
// to Cloudinary and records the invoice (best-effort, non-blocking).
export const downloadInvoice = async (req, res) => {
  try {
    const { orderDoc, user, status, message } = await loadOrderForUser(
      req.params.id,
      req.id
    );
    if (status) return res.status(status).json({ success: false, message });

    const data = buildInvoiceData(orderDoc, user);
    const html = generateInvoiceHTML(data);
    const pdfBuffer = await generatePDF(html);

    // Fire-and-forget: persistence must never block or fail the download.
    saveInvoiceRecord(orderDoc, user, data, pdfBuffer).catch((e) =>
      console.log("saveInvoiceRecord (non-fatal):", e.message)
    );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.invoice_no}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    return res.status(200).send(pdfBuffer);
  } catch (er) {
    console.log("downloadInvoice error:", er);
    return res
      .status(500)
      .json({ success: false, message: "Could not generate the invoice PDF" });
  }
};
