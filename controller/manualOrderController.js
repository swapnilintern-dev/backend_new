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
        const get_product = await product.findById(item);

        console.log("user  is :", user);
        console.log("item  is :", item);


        const itemIndex = user.cart.findIndex(
            item = item.product.toString() === item
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
            amountWord,
            orderType:"Manual",
        });

        const invoiceNumber = `INV-${Date.now()}`;

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

            items: user.cart.map(item => ({
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
                amount: item.product.price * item.quantity * 0.05
            })),

            total_item: user.cart.length,
            total_qty,
            gross_total: totalAmount,

            amount_words: amountWord,
            amount: totalAmount
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


        // if (!fs.existsSync(invoiceDir)) {
        //     fs.mkdirSync(invoiceDir, { recursive: true });
        // }

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

        user.cart = [];
        await user.save();

        return res.status(201)
        .json({
            message :"invoice generated ", 
            success : true ,
            createdInvoice
        });
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