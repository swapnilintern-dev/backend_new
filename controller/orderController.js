import order from "../model/orderModel.js";
import product from "../model/productModel.js";
// import product from "../model/productModel.js";
import Vendor from "../model/userModel.js";
import converter from "number-to-words"
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
import invoice from "../model/invoiceModel.js";
import { generatePDF } from "../utils/generatePdf.js";
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

        for (let i = 0; i < user.cart.length; i++) {
            user.cart[i].product.stock -= user.cart[i].quantity;
            await user.cart[i].product.save();
        }


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
            amountWord,
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

        // Response yahin bhejo — par 'return' MAT lagao, warna function yahin
        // ruk jaata hai aur niche ka invoice/PDF code kabhi chalta hi nahi.
        // res.json() ke baad bhi function aage chalta rehta hai — PDF
        // background me ban ke order se link ho jayega.
        // res.status(201)
        //     .json({
        //         message: "Order placed successfully",
        //         success: true,
        //         Order
        //     });

        try {


            const invoiceNumber = `INV-${Date.now()}`;

            // GST split PER SLAB (5/12/18/28) so the invoice's tax summary
            // fills each column, not just a single lump. Prices are
            // GST-INCLUSIVE, so the tax already sitting inside each line is
            // extracted:  gst = total - total / (1 + rate/100).
            const gstSlabs = { 5: 0, 12: 0, 18: 0, 28: 0 };

            for (let i = 0; i < cartSnapshot.length; i++) {

                const gst = Number(cartSnapshot[i].product.gstPercent) || 0;

                const item_price = cartSnapshot[i].product.price;
                const item_qty = cartSnapshot[i].quantity;

                const itemTotal = item_price * item_qty;

                if (gstSlabs[gst] !== undefined) {
                    gstSlabs[gst] += itemTotal - itemTotal / (1 + gst / 100);
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
                // Prices already include GST, so the gross total is simply the
                // order total — tax is NOT added on top a second time.
                gross_total: totalAmount,
                round_off: (Math.round(totalAmount) - totalAmount).toFixed(2),


                amount_words: amountWord,
                amount: totalAmount,

                // Keys MUST match the template placeholders read by
                // invoiceTemplate.js ({{gst_5}}, {{gst_total}}, {{total_cgst}},
                // {{total_sgst}}…). CGST and SGST are each half of total GST.
                gst_5: gstSlabs[5].toFixed(2),
                gst_12: gstSlabs[12].toFixed(2),
                gst_18: gstSlabs[18].toFixed(2),
                gst_28: gstSlabs[28].toFixed(2),
                gst_total: totalgst.toFixed(2),
                total_cgst: (totalgst / 2).toFixed(2),
                total_sgst: (totalgst / 2).toFixed(2)
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

        } catch (invErr) {
            // Invoice/PDF ka fail hona order ko kabhi fail nahi karega —
            // order pehle hi ban chuka hai, 201 hi jayega.
            console.log("invoice generation failed (non-fatal):", invErr.message);
        }
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
        Product.stock -= 1;
        await Product.save();

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
            // orderModel me amountWord required hai — iske bina yahan
            // ValidationError se order 500 ho jata tha.
            amountWord: converter.toWords(Product.price),

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

        const existingOrder = await order
            .findById(product_id)
            .populate("orderItems.product");

        if (!existingOrder) {
            return res.status(404)
                .json({
                    message: "Order not found ",
                    success: false
                });
        }

        if (existingOrder.orderStatus === "Cancelled")
            return res.status(404)
                .json({
                    message: "Order already cancled ",
                    success: false
                });

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

        for (let i = 0; i < existingOrder.orderItems.length; i++) {

            existingOrder.orderItems[i].product.stock +=
                existingOrder.orderItems[i].quantity;

            await existingOrder.orderItems[i].product.save();
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