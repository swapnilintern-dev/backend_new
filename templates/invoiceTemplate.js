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


    const itemsHtml = data.items
        .map(
            (item, index) => `
<tr class="item-row">
    <td>${index + 1}</td>
    <td class="left-align"><strong>${item.title}</strong></td>
    <td>${item.hsnCode}</td>
    <td>${item.manufacturer}</td>
    <td>${item.marketedBy}</td>
    <td>${item.quantity}</td>
    <td>${item.mrp}</td>
    <td>${item.price}</td>
    <td>${item.gstPercent}</td>
    <td>${item.price}</td>
    <td>${item.disPercent}</td>
    <td><strong>${item.amount}</strong></td>
</tr>
` )
        .join("");

    console.log("data is :", data);

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