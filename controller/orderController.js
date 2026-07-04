import order from "../model/orderModel.js";
import product from "../model/productModel.js";
// import product from "../model/productModel.js";
import Vendor from "../model/userModel.js";
import converter from "number-to-words"
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
import invoice from "../model/invoiceModel.js";
import { generatePDF } from "../utils/generatePdf.js";
import path from "path";
import fs from "fs"
import cloudinary from "../utils/cloudinary.js";


export const placeOrder = async (req, res) => {

    try {
        const userId = req.id;

        const {
            address,
            city,
            state,
            pincode,
            country,
            phoneNo
        } = req.body;


        const user = await Vendor.findById(userId).populate("cart.product");

        console.log("populated cart is :", user.cart);

        if (!user) {

            return res.status(401)
                .json({

                    message: "invalid User ",
                    success: false
                });
        }

        if (user.cart.length === 0) {
            return res.status(401)
                .json({
                    message: "Cart is empty !! Plz add product ",
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
            orderPrice: item.product.price

        }));

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
                address,
                city,
                state,
                pincode,
                country,
                phoneNo
            },
            totalAmount,
            orderNo,
            amountWord
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
                amount: item.product.price * item.quantity
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

        // console.log("invoice data is :", result);

        // fs.unlinkSync(pdfPath);

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
                message: "Order places successfully ",
                success: true,
                Order,
                createdInvoice
            });

    }
    catch (er) {
        console.log("error is :", er);

        return res.status(500)
            .json({

                message: "Internal server error ",
                success: false
            });
    }
}

export default placeOrder;






export const getOrders = async (req, res) => {

    try {

        const userId = req.id;

        const orders = await order.find({
            user: userId
        }).populate("orderItems.product");

        return res.status(201)
            .json({
                message: "all orderes are here ",
                success: true,
                orders: orders

            });
    }
    catch (er) {

        console.log("error is :", er);

        return res.status(500)
            .json({

                message: "Internal server error ",
                success: false
            });
    }
}

export const placeSingleOrder = async (req, res) => {

    try {

        const userId = req.id;
        const product_id = req.params.id;


        const { address, city, state, pincode, country, phoneNo } = req.body;

        const Product = await product.findById(product_id);

        if (!Product)
            return res.status(404)
                .json({

                    message: "Product not found ",
                    success: false
                });


        if (!userId)
            return res.status(401)
                .json({
                    message: "Invalid user",
                    success: false
                });


        const orderItems = [{

            product: Product._id,
            quantity: 1,
            orderPrice: Product.price

        }];

        // console.log("orderitems array ", orderItems ) ;

        const singleOrder = await order.create({

            user: userId,
            orderItems,
            shippingAddress: {
                address,
                city,
                state,
                pincode,
                country,
                phoneNo
            },
            totalAmount: Product.price,

        });

        // await order.save() ;

        return res.status(200)
            .json({
                message: "Product ordered successfully ",
                success: true,
                singleOrder
            });


    }
    catch (er) {

        console.log("error from singleOrder ", er);

        return res.status(500)
            .json({

                message: "Internal server error from singleOrder ",
                success: false
            })
    }
};


export const cancelOrder = async (req, res) => {

    try {

        const userId = req.id;

        const product_id = req.params.id;

        const existingOrder = await order.findById(product_id);

        if (!existingOrder) {
            return res.status(404)
                .json({
                    message: "Order not found ",
                    success: false
                });
        }

        if (existingOrder.orderStatus === "Delivered") {

            return res.status(401)
                .json({
                    message: "Delivered Product can't be cancelled ",
                    success: false
                });
        }

        console.log("exiting order is :", typeof (existingOrder.user.toString()), "and ", typeof (userId));

        if (existingOrder.user.toString() !== userId) {
            return res.status(403)
                .json({
                    message: "unauthorized user ",
                    success: false
                });
        }

        existingOrder.orderStatus = "Cancelled";

        await existingOrder.save();

        return res.status(200)
            .json({
                message: "order cancel successfully ",
                success: true
            });

    }
    catch (er) {
        console.log("error is :", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            })
    }
}



// export const cancelOrder = async (req, res) => {
//   try {

//     const userId = req.id;
//     const orderId = req.params.id;

//     const existingOrder = await order.findById(orderId);

//     if (!existingOrder) {
//       return res.status(404).json({
//         message: "Order not found",
//         success: false
//       });
//     }

//     if (existingOrder.user.toString() !== userId) {
//       return res.status(403).json({
//         message: "Unauthorized",
//         success: false
//       });
//     }

//     existingOrder.orderStatus = "Cancelled";
//     await existingOrder.save();

//     return res.status(200).json({
//       message: "Order cancelled successfully",
//       success: true,
//       existingOrder
//     });

//   } catch (er) {
//     console.log(er);

//     return res.status(500).json({
//       message: "Internal server error",
//       success: false
//     });
//   }
// };