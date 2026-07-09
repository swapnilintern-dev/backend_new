import Invoice from "../model/invoiceModel.js";
import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
import { generatePDF } from "../utils/generatePdf.js";
import converter from "number-to-words"
import path from "path";
import fs from "fs"
import cloudinary from "../utils/cloudinary.js";


const manualCart = async (req, res) => {

    try {

        const userId = req.params.vendorId;
        const item = req.params.itemId;

        const user = await Vendor.findById(userId);

        if (!user) {
            return res.status(404)
                .json({
                    message: "Vendor not found ",
                    success: false
                });
        }

        console.log("user  is :", user);
        console.log("item  is :", item);

        const itemIndex = user.cart.findIndex(
            (ci) => ci.product.toString() === item
        );
        if (itemIndex > -1) {
            user.cart[itemIndex].quantity += 1
        }
        else {
            user.cart.push({
                product: item,
                quantity: 1

            });
        }

        await user.save();

        return res.status(201)
            .json({
                message: "Product added successfully ",
                success: true
            });
    }
    catch (er) {
        console.log("er is :", er);
        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}
export default manualCart;



export const manualOrder = async (req, res) => {

    try {

        const userId = req.params.vendorId;
        const user = await Vendor.findById(userId).populate("cart.product");
        console.log("user cart is :", user);


        if (!user) {
            return res.status(404)
                .json({
                    message: "User not found ",
                    success: false
                });
        }

        if (user.cart.length === 0) {
            return res.status(404)
                .json({
                    message: "Cart is empty ",
                    success: false
                });
        }


        const orderNo =
            "ORD-" +
            new Date().getFullYear() +
            Math.floor(100000 + Math.random() * 900000);

        const orderItems = user.cart.map(item => ({

            product: item.product._id,
            quantity: item.quantity,
            orderPrice: item.product.price,

        }));

        console.log("Shipping address is :", user)


        const total_qty = user.cart.reduce(
            (qty, item) => qty + item.quantity,
            0
        );

        const totalAmount = user.cart.reduce((total, item) =>

            total + item.product.price * item.quantity, 0
        )


        const amountWord = converter.toWords(totalAmount);
        const Order = await order.create({

            user: userId,
            orderItems,
            shippingAddress: {
                address: user.full_address,
                city: user.city,
                state: user.state,
                pincode: user.pin_code,
                country: "IN",
                phoneNo: user.mobile_no
            },
            totalAmount,
            orderNo,
            amountWord
        });


        const cartSnapshot = [...user.cart];
        user.cart = [];
        await user.save();

        res.status(201).json({
            message: "Order placed successfully",
            success: true,
            Order
        });

        let createdInvoice = null;

        try {


            const invoiceNumber = `INV-${Date.now()}`;

            // GST split PER SLAB (5/12/18/28) so the invoice's tax summary
            // fills each column, not just a single lump. Tax is added on top of
            // the item price and bucketed by that product's rate.
            const gstSlabs = { 5: 0, 12: 0, 18: 0, 28: 0 };

            for (let i = 0; i < cartSnapshot.length; i++) {

                const gst = Number(cartSnapshot[i].product.gstPercent) || 0;

                const item_price = cartSnapshot[i].product.price;
                const item_qty = cartSnapshot[i].quantity;

                const itemTotal = item_price * item_qty;

                if (gstSlabs[gst] !== undefined) {
                    gstSlabs[gst] += itemTotal * (gst / 100);
                }
            }

            const totalgst =
                gstSlabs[5] + gstSlabs[12] + gstSlabs[18] + gstSlabs[28];

            console.log("Total GST:", totalgst);

            console.log(" total gst is :", totalgst);


            const invoiceData = {
                shop_name: user.store_name,
                shop_address: user.full_address,
                gst_in: user.gst_no,
                dl_no: user.drug_lic_no,

                order_no: orderNo,
                order_date: new Date().toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric"
                }),

                invoice_no: invoiceNumber,
                invoice_date: new Date().toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric"
                })
                ,

                items: cartSnapshot.map(item => ({
                    title: item.product.title,
                    hsnCode: item.product.hsnCode || "N/A",
                    mrp: item.product.mrp,
                    gstPercent: item.product.gstPercent,
                    disPercent: item.product.discountPercent || "N/A",
                    manufacturer: item.product.manufacturer || "N/A",
                    marketedBy: item.product.marketedBy || "N/A",
                    batch_no: item.product.batch_no || "N/A",
                    exp_date: item.product.exp_date || "N/A",
                    quantity: item.quantity,
                    price: item.product.price,
                    amount: item.product.price * item.quantity
                })),

                total_item: cartSnapshot.length,
                total_qty,
                gross_total: totalAmount + totalgst,
                round_off: Math.floor(totalAmount + totalgst),


                amount_words: amountWord,
                amount: totalAmount,

                // Keys MUST match the template placeholders read by
                // invoiceTemplate.js ({{gst5}}, {{gst_total}}, {{total_sgst}}…) —
                // the old gst_5 / gst_t_half names never reached the template, so
                // the GST summary rendered blank.
                gst5: gstSlabs[5].toFixed(2),
                gst12: gstSlabs[12].toFixed(2),
                gst18: gstSlabs[18].toFixed(2),
                gst28: gstSlabs[28].toFixed(2),
                gst_total: totalgst.toFixed(2),
                total_sgst: (totalgst / 2).toFixed(2),
                total_cgst: (totalgst / 2).toFixed(2)
            };

            // console.log("invoice data is:", invoiceData)


            const html = generateInvoiceHTML(invoiceData);

            const pdfBuffer = await generatePDF(html);


            // Upload the PDF buffer straight to Cloudinary — no local file, so
            // it never depends on an uploads/ folder existing (it does not on
            // Render's ephemeral fs) and leaves no temp files behind.
            const result = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { resource_type: "auto", folder: "invoices" },
                    (err, uploaded) => (err ? reject(err) : resolve(uploaded))
                );
                stream.end(pdfBuffer);
            });

            const pdfUrl = result.secure_url;

            const createdInvoice = await Invoice.create({
                invoiceNumber: `INV-${Date.now()}`,
                order: Order._id,
                vendor: user._id,
                pdfUrl
            });

            Order.invoice = createdInvoice._id;
            await Order.save();

            // user.cart = [];
            // await user.save();
            console.log(
                "Invoice generated successfully:",
                createdInvoice._id
            );

        }
        catch (invErr) {
            // The order is already created — an invoice/PDF failure must never
            // hang the request or fail the order. Reply success (the invoice can
            // be (re)generated at accept-time) instead of leaving no response.
            console.log("invoice generation failed (non-fatal):", invErr.message);
            // return res.status(201)
            //     .json({
            //         message: "Order placed (invoice pending) ",
            //         success: true,
            //         Order
            //     });
        }
    }
    catch (er) {
        console.log(" er is :", er);
        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}