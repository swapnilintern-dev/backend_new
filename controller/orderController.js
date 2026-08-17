import order from "../model/orderModel.js";
import product from "../model/productModel.js";
// import product from "../model/productModel.js";
import Vendor from "../model/userModel.js";
import converter from "number-to-words"
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
// MUST be `Invoice` — the invoice block below calls Invoice.create(); a
// lowercase import left it undefined, so customer-order invoices silently
// failed every time (the catch swallowed the ReferenceError).
import Invoice from "../model/invoiceModel.js";
import outletStock from "../model/outletStockModel.js";
import { generatePDF } from "../utils/generatePdf.js";
import cloudinary from "../utils/cloudinary.js";
import { normalizeFreeQty } from "../utils/freeGoods.js";
import { buildInvoiceItems, invoiceRow } from "../utils/invoiceItems.js";
import {
    withInventoryTxn,
    allocateFEFO,
    releaseStock,
    releaseOutletStock,
    InsufficientStockError,
} from "../utils/inventory.js";


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

        const total_qty = user.cart.reduce(
            (qty, item) => qty + item.quantity,
            0
        );

        const totalAmount = user.cart.reduce((total, item) =>

            total + item.product.price * item.quantity, 0
        )

        const amountWord = converter.toWords(totalAmount);

        // Allocate stock FEFO across each product's batches and create the order
        // atomically. If any line is short the whole transaction rolls back — no
        // oversell, no half-deducted order. allocations[] is snapshotted onto the
        // line; batch_no/exp_date mirror the FEFO-front batch for the invoice.
        let Order;
        try {
            Order = await withInventoryTxn(async (session) => {
                const orderItems = [];
                for (const item of user.cart) {
                    const allocations = await allocateFEFO(
                        item.product._id,
                        item.quantity,
                        session
                    );
                    orderItems.push({
                        product: item.product._id,
                        quantity: item.quantity,
                        orderPrice: item.product.price,
                        // Free goods recorded on the cart line (staff-set) —
                        // invoice-only, totalAmount above bills `quantity` only.
                        freeQty: normalizeFreeQty(item.freeQty),
                        batch_no: allocations[0]?.batch_number ?? item.product.batch_no,
                        exp_date: allocations[0]?.expiry_date ?? item.product.exp_date,
                        allocations,
                    });
                }

                const created = await order.create([{
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
                }], { session });

                return created[0];
            });
        } catch (err) {
            if (err instanceof InsufficientStockError) {
                return res.status(400).json({ message: err.message, success: false });
            }
            throw err;
        }




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

                // One row PER BATCH the line consumed. The FEFO snapshot lives
                // on the order line the transaction just created, which was
                // built by iterating user.cart in order — so orderItems[i]
                // is the same line as cartSnapshot[i]. total_item below stays
                // the LINE count, unchanged.
                items: buildInvoiceItems(
                    cartSnapshot,
                    (item, i) => invoiceRow(item.product, {
                        quantity: item.quantity,
                        // FREE GOODS — free units on this line, never priced.
                        freeQty: normalizeFreeQty(item.freeQty),
                        price: item.product.price,
                        amount: item.product.price * item.quantity,
                        // The lot actually sold, off the order line's snapshot —
                        // NOT product.batch_no, which is only the current
                        // FEFO-front lot and may already have moved on.
                        batch_no: Order.orderItems[i]?.batch_no,
                        exp_date: Order.orderItems[i]?.exp_date,
                    }),
                    (_item, i) => Order.orderItems[i]?.allocations
                ),

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


        // Allocate 1 unit FEFO and create the order atomically. A sold-out
        // product rolls the transaction back with a clean 400.
        let singleOrder;
        try {
            singleOrder = await withInventoryTxn(async (session) => {
                const allocations = await allocateFEFO(Product._id, 1, session);

                const orderItems = [{
                    product: Product._id,
                    quantity: 1,
                    orderPrice: Product.price,
                    batch_no: allocations[0]?.batch_number ?? Product.batch_no,
                    exp_date: allocations[0]?.expiry_date ?? Product.exp_date,
                    allocations,
                }];

                const created = await order.create([{
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
                }], { session });

                return created[0];
            });
        } catch (err) {
            if (err instanceof InsufficientStockError) {
                return res.status(400).json({ message: err.message, success: false });
            }
            throw err;
        }

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

        // The order's owner can cancel it — and so can STAFF (admin/marketing),
        // who cancel on the vendor's behalf from their portals. Anyone else is
        // rejected.
        if (existingOrder.user && existingOrder.user.toString() !== userId) {
            const caller = await Vendor.findById(userId);
            const staffRoles = ["admin", "marketing"];
            if (!caller || !staffRoles.includes((caller.role || "").toLowerCase())) {
                return res.status(403)
                    .json({
                        message: "unauthorized user ",
                        success: false
                    });
            }
        }

        // Put the stock back where it came FROM. An outlet order sold the
        // OUTLET's stock (outletStock), not the catalog — restoring
        // product.stock for it would inflate the catalog and leave the outlet
        // short.
        if (existingOrder.outlet) {
            // Outlet order: return the units to the outlet's OWN batches (via the
            // line's allocations snapshot), which also re-syncs outletStock.quantity.
            // Pre-batch outlet orders have no allocations → releaseOutletStock
            // falls back to the batch_no snapshot / a legacy row.
            await withInventoryTxn(async (session) => {
                for (const item of existingOrder.orderItems) {
                    const productId = item.product?._id || item.product;
                    const entries =
                        item.allocations && item.allocations.length
                            ? item.allocations
                            : {
                                  batch_no: item.batch_no,
                                  exp_date: item.exp_date,
                                  quantity: item.quantity,
                              };
                    await releaseOutletStock(
                        existingOrder.outlet,
                        productId,
                        entries,
                        session
                    );
                }
            });
        } else {
            // Catalog order: return the units to the exact batches they came
            // from (via the line's allocations snapshot), atomically. Orders
            // placed before multi-batch have no allocations — releaseStock then
            // falls back to matching the line's batch_no snapshot.
            await withInventoryTxn(async (session) => {
                for (const item of existingOrder.orderItems) {
                    const productId = item.product?._id || item.product;
                    const entries =
                        item.allocations && item.allocations.length
                            ? item.allocations
                            : {
                                  batch_no: item.batch_no,
                                  exp_date: item.exp_date,
                                  quantity: item.quantity,
                              };
                    await releaseStock(productId, entries, session);
                }
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