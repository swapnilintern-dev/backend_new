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

            let totalgst = 0;

            for (let i = 0; i < cartSnapshot.length; i++) {

                const gst = user.cart[i].product.gstPercent || 0;

                const item_price = user.cart[i].product.price;
                const item_qty = user.cart[i].quantity;

                const itemTotal = item_price * item_qty;

                totalgst += itemTotal * (gst / 100);
            }

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
                gst_5: totalgst || "0",
                gst_28: "0",
                gst_12: "0",
                gst_18: "0",

                gst_t_half: totalgst / 2
            };

            // console.log("invoice data is:", invoiceData)


            const html = generateInvoiceHTML(invoiceData);

            const pdfBuffer = await generatePDF(html);


            const pdfPath = path.join(
                process.cwd(),
                "uploads",
                "invoices",
                `INV-${Date.now()}.pdf`
            );


            // Ensure uploads/invoices exists — it is not committed to the repo, so
            // fs.writeFileSync would otherwise throw ENOENT and crash the invoice.
            fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

            fs.writeFileSync(pdfPath, pdfBuffer);

            const result = await cloudinary.uploader.upload(
                pdfPath,

                {
                    resource_type: "auto",
                    folder: "invoices"
                }
            );

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
            return res.status(201)
                .json({
                    message: "Order placed (invoice pending) ",
                    success: true,
                    Order
                });
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