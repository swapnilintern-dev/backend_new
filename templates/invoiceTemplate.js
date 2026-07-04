import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve paths relative to THIS module, not process.cwd() — so the template
// and brand assets load correctly no matter which directory the server is
// started from (local `node index.js`, Render start command, etc.).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "invoice.html");
const assetsDir = path.join(__dirname, "..", "assets");

// The template + brand images never change at runtime, so read them once at
// module load. A missing brand image is non-fatal (the <img> just renders
// blank) — only the HTML template is required.
const templateHtml = fs.readFileSync(templatePath, "utf8");

function readAssetBase64(file) {
  try {
    return fs.readFileSync(path.join(assetsDir, file), "base64");
  } catch (err) {
    console.log(`invoice asset missing (${file}):`, err.message);
    return "";
  }
}

const logoBase64 = readAssetBase64("logo.jpg");
const qrBase64 = readAssetBase64("QR.png");
const stampBase64 = readAssetBase64("stampted_1.png");

// Two-decimal money formatting; blank/NaN → "0.00".
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
};

/**
 * Fills the invoice HTML template with a data object built by the invoice
 * controller. Returns a complete, self-contained HTML string (images inlined).
 */
export const generateInvoiceHTML = (data = {}) => {
  const items = Array.isArray(data.items) ? data.items : [];

  const itemsHtml = items
    .map(
      (item, index) => `
<tr class="item-row">
    <td>${index + 1}</td>
    <td class="left-align"><strong>${item.title ?? ""}</strong></td>
    <td>${item.hsnCode ?? "N/A"}</td>
    <td>${item.manufacturer ?? "N/A"}</td>
    <td>${item.marketedBy ?? "N/A"}</td>
    <td>${item.quantity ?? 0}</td>
    <td>${money(item.mrp)}</td>
    <td>${money(item.price)}</td>
    <td>${item.gstPercent ?? 0}</td>
    <td>${money(item.price)}</td>
    <td>${item.disPercent ?? "N/A"}</td>
    <td><strong>${money(item.amount)}</strong></td>
</tr>`
    )
    .join("");

  const replacements = {
    shop_name: data.shop_name,
    shop_address: data.shop_address,
    gst_in: data.gst_in,
    dl_no: data.dl_no,

    order_no: data.order_no,
    order_date: data.order_date,
    invoice_no: data.invoice_no,
    invoice_date: data.invoice_date,

    total_item: data.total_item,
    total_qty: data.total_qty,
    gross_total: data.gross_total,

    amount: data.amount,
    amount_words: data.amount_words,

    // Computed GST summary (see invoiceController.buildInvoiceData).
    gst5: data.gst5 ?? "0.00",
    gst12: data.gst12 ?? "0.00",
    gst18: data.gst18 ?? "0.00",
    gst28: data.gst28 ?? "0.00",
    gst_total: data.gst_total ?? "0.00",
    total_sgst: data.total_sgst ?? "0.00",
    total_cgst: data.total_cgst ?? "0.00",

    logo: logoBase64,
    stamped_1: stampBase64,
    QR: qrBase64,

    items: itemsHtml,
  };

  let html = templateHtml;
  Object.entries(replacements).forEach(([key, value]) => {
    html = html.replaceAll(`{{${key}}}`, value ?? "");
  });

  return html;
};
