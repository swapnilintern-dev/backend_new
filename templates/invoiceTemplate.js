import fs from "fs";
import path from "path";

export const generateInvoiceHTML = (data) => {

    let html = fs.readFileSync(
        path.join(process.cwd(), "templates/invoice.html"),
        "utf8"
    );
    const logoBase64 = fs.readFileSync(
        path.join(process.cwd(), "assets", "logo.jpg"),
        "base64"
    );
    
    const qr = fs.readFileSync(
        path.join(process.cwd(), "assets", "QR.png"),
        "base64"
    );
    const stampted_1 = fs.readFileSync(
        path.join(process.cwd(), "assets", "stampted_1.png"),
        "base64"
    );


    // Small helper: turns any value into money text like "99.00".
    // If the value is missing/not a number, it safely becomes "0.00"
    // so the invoice never shows a blank space.
    const money = (value) => (Number(value) || 0).toFixed(2);

    // Formats a batch expiry for the invoice ("Jul-2027"). Older orders whose
    // product has no expiry come through as "N/A"/empty and stay "N/A" — the
    // invoice still renders, never crashes. Built manually so it is locale-safe.
    const expMonths = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const expText = (value) => {
        if (!value || value === "N/A") return "N/A";
        const d = new Date(value);
        if (isNaN(d.getTime())) return "N/A";
        return `${expMonths[d.getMonth()]}-${d.getFullYear()}`;
    };

    // FREE GOODS quantity exactly as stored on the order line. Whole numbers
    // print bare ("2"), decimal quantities keep their decimals ("1.5"), and a
    // line with none prints "0" — the same "0 instead of a blank cell" rule the
    // money() and discount columns already follow.
    const freeQtyText = (value) => {
        const n = Number(value) || 0;
        return Number.isInteger(n) ? `${n}` : `${Number(n.toFixed(3))}`;
    };

    // "MFG/Mkt By" — manufacturer and marketed-by in ONE cell (they used to be
    // two separate columns). Both values come straight from the product record;
    // when they are the same firm it is printed once, and when they differ the
    // marketer goes on a second line in the muted style already used elsewhere
    // in the row. Missing/"N/A" on both sides falls back to "N/A".
    const blankish = (value) => {
        const text = (value ?? "").toString().trim();
        return !text || text === "N/A" ? "" : text;
    };
    const mfgMktText = (item) => {
        const mfr = blankish(item.manufacturer);
        const mkt = blankish(item.marketedBy);

        if (!mfr && !mkt) return "N/A";
        if (!mfr) return mkt;
        if (!mkt || mkt.toLowerCase() === mfr.toLowerCase()) return mfr;

        return `${mfr}<br><span style="font-size: 9px; color: var(--text-muted);">Mkt: ${mkt}</span>`;
    };

    const itemsHtml = data.items
        .map((item, index) => {
            // ---- Per-item GST maths (prices are GST-INCLUSIVE) ----
            // gstPercent : the product's GST rate (5 / 12 / 18 / 28)
            // netRate    : selling price WITH GST already inside (not printed —
            //              the column it used to fill now shows FREE GOODS)
            // baseRate   : price WITHOUT GST  =  netRate / (1 + gst/100)
            // lineGst    : GST money hidden inside this line's amount
            // Free goods are handed over at no charge, so they take no part in
            // any of this — the amount, GST and totals stay exactly as before.
            const gstPercent = Number(item.gstPercent) || 0;
            const netRate = Number(item.price) || 0;
            const baseRate = netRate / (1 + gstPercent / 100);
            const lineAmount = Number(item.amount) || netRate * (Number(item.quantity) || 0);
            const lineGst = lineAmount - lineAmount / (1 + gstPercent / 100);

            // Discount column: show "5%" if the product has one, else "0%".
            const discount = Number(item.disPercent)
                ? `${Number(item.disPercent)}%`
                : "0%";

            return `
<tr class="item-row">
    <td>${index + 1}</td>
    <td class="left-align"><strong>${item.title}</strong><br><span style="font-size: 9px; color: var(--text-muted);">Batch: ${item.batch_no || "N/A"} | Exp: ${expText(item.exp_date)}</span></td>
    <td>${mfgMktText(item)}</td>
    <td>${item.hsnCode || "N/A"}</td>
    <td>${money(item.mrp)}</td>
    <td>${item.quantity}</td>
    <td>${freeQtyText(item.freeQty)}</td>
    <td>${money(baseRate)}</td>
    <td>${discount}</td>
    <td>${gstPercent}%<br><span style="font-size: 9px; color: var(--text-muted);">(${money(lineGst)})</span></td>
    <td><strong>${money(lineAmount)}</strong></td>
</tr>
`;
        })
        .join("");

    const replacements = {
        shop_name: data.shop_name,
        shop_address: data.shop_address,
        // Buyer's GST / drug-licence numbers — "N/A" instead of an empty gap
        // when the vendor's account doesn't have them saved.
        gst_in: data.gst_in || "N/A",
        dl_no: data.dl_no || "N/A",

        order_no: data.order_no,
        order_date: data.order_date,
        invoice_no: data.invoice_no,
        invoice_date: data.invoice_date,

        total_item: data.total_item,
        total_qty: data.total_qty,
        gross_total: money(data.gross_total),
        round_off: data.round_off ?? "0.00",

        amount: money(data.amount),
        amount_words: data.amount_words,

        // ---- GST summary (per slab) ----
        // Every value goes through money(), so even when a slab has no
        // products in it the invoice prints "0.00" instead of a blank cell.
        gst_5: money(data.gst_5),
        gst_12: money(data.gst_12),
        gst_18: money(data.gst_18),
        gst_28: money(data.gst_28),
        gst_total: money(data.gst_total),

        // ---- CGST / SGST ----
        // For same-state sales the total GST is split into two equal halves:
        // CGST (central) + SGST (state). Callers send total_cgst/total_sgst;
        // older callers only send gst_t_half — both are accepted here.
        total_cgst: money(data.total_cgst ?? data.gst_t_half),
        total_sgst: money(data.total_sgst ?? data.gst_t_half),
        gst_t_half: money(data.gst_t_half ?? data.total_cgst),

        logo : logoBase64 ,
        stamped_1:stampted_1,
        QR :qr ,

        items: itemsHtml
    };
    Object.entries(replacements).forEach(([key, value]) => {

        html = html.replaceAll(
            `{{${key}}}`,
            value ?? ""
        );

    });

    return html;
};