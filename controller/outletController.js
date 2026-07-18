import Outlet from "../model/outletregistersModel.js";
import outletStock from "../model/outletStockModel.js";
import product from "../model/productModel.js";
import jwt from "jsonwebtoken"
import converter from "number-to-words"
import Vendor from "../model/userModel.js";
import { generateInvoiceHTML } from "../templates/invoiceTemplate.js";
import { generatePDF } from "../utils/generatePdf.js";
import cloudinary from "../utils/cloudinary.js";
import order from "../model/orderModel.js";
import Invoice from "../model/invoiceModel.js";


const outletRegister = async (req, res) => {
    try {


        console.log("outlet register called ");

        const { outletName, ownerName, mobileNo,
            email, address, city, state, pincode,
            gstNumber, status, password
        } = req.body;

        console.log("req.body is :", req.body);

        if (!outletName || !ownerName || !mobileNo || !email || !address || !city || !state
            || !pincode || !gstNumber || !password
        ) {
            return res.status(400)
                .json({
                    message: "Missing fields ",
                    success: false
                });
        }

        const existing = await Outlet.findOne({ mobileNo });
        if (existing) {
            return res.status(409)
                .json({
                    message: "An outlet with this mobile number already exists",
                    success: false
                });
        }

        const outlet = await Outlet.create({
            outletName,
            ownerName,
            mobileNo,
            email,
            address,
            city,
            state,
            pincode,
            gstNumber,
            status: status || "Active",
            password
        });

        // Never echo the password back to the client.
        const { password: _pw, ...safeOutlet } = outlet.toObject();

        return res.status(201)
            .json({
                message: "Outlet registered successfully ",
                success: true,
                outlet: safeOutlet
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
};

export default outletRegister;


export const outlet_login = async (req, res) => {

    try {
        const { mobileNo, password } = req.body;

        if (!mobileNo || !password) {
            return res.status(400)
                .json({
                    message: "Field are missing ",
                    success: false
                });
        }

        const outlet_details = await Outlet.findOne({ mobileNo });

        if (!outlet_details) {
            return res.status(400)
                .json({
                    message: "Data mismatch",
                    success: false
                });
        }

        if (password !== outlet_details.password) {
            return res.status(400)
                .json({
                    message: "Somthing is wrong ",
                    success: false
                });
        }


        // token generate 
        const token = jwt.sign(

            {
                id: outlet_details._id,
                role: "outlet"
            },
            process.env.SECRET_KEY,
            { expiresIn: "7d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: "strict"
        });

        // The app captures `token` (Bearer auth, works on web + mobile) and the
        // `outlet` object (minus password) to populate its session — every
        // outlet-scoped call is keyed on the returned outlet _id.
        const { password: _pw, ...safeOutlet } = outlet_details.toObject();

        return res.status(200)
            .json({
                message: "Outlet Login success ",
                success: true,
                role: "outlet",
                token,
                outlet: safeOutlet
            });
    }
    catch (er) {
        console.log("error is ", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
};


export const addOutletStock = async (req, res) => {
    try {
        const { productId, outletId, quantity } = req.body;

        if (!productId || !outletId || !quantity) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const Product = await product.findById(productId);
        const outlet = await Outlet.findById(outletId);

        if (!Product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        if (!outlet) {
            return res.status(404).json({
                success: false,
                message: "Outlet not found"
            });
        }

        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({
                success: false,
                message: "Quantity must be a positive number"
            });
        }

        // The catalog is the source: assigning stock to an outlet moves it OUT
        // of the global product stock. Guard it in BOTH branches (new + existing
        // outlet row), otherwise a first-time assignment would create stock from
        // nothing and never deduct the catalog.
        if (Product.stock < qty) {
            return res.status(400).json({
                success: false,
                message: "Insufficient stock available"
            });
        }

        const existingStock = await outletStock.findOne({
            product: productId,
            outlet: outletId
        });

        Product.stock -= qty;
        await Product.save();

        if (existingStock) {
            existingStock.quantity += qty;
            await existingStock.save();

            return res.status(200).json({
                success: true,
                message: "Stock updated successfully",
                stock: existingStock
            });
        }

        const stock = await outletStock.create({
            product: productId,
            outlet: outletId,
            quantity: qty
        });

        return res.status(201).json({
            success: true,
            message: "Stock added successfully",
            stock
        });

    }
    catch (error) {

        console.log("er is :", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const getOutletProducts = async (req, res) => {
    try {

        const outletId = req.params.id;

        const stocks = await outletStock
            .find({ outlet: outletId })
            .populate("product");

        console.log("stock is :", outletId);

        return res.status(200).json({
            success: true,
            count: stocks.length,
            products: stocks
        });

    } catch (error) {
        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
}


export const addToCart = async (req, res) => {
    try {

        const outletId = req.id;

        console.log("outlet id :", outletId ) ;

        const { productId, quantity } = req.body;

        const outlet = await Outlet.findById(outletId);

        if (!outlet) {
            return res.status(404).json({
                success: false,
                message: "Outlet not found"
            });
        }

        const get_product = await product.findById(productId);

        if (!get_product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        const existingItem = outlet.cart.find(
            item => item.product.toString() === productId
        );

        if (existingItem) {

            existingItem.quantity += Number(quantity);

        } else {

            outlet.cart.push({
                product: productId,
                quantity
            });

        }

        await outlet.save();

        return res.status(200).json({
            success: true,
            message: "Product added to cart",
            cart: outlet.cart
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }

};


// cart summary
export const cartSummary = async (req, res) => {
    try {

        const outletId = req.id;

        console.log("outlet id ", outletId ) ;

        const outlet = await Outlet.findById(outletId)
            .populate("cart.product");

        if (!outlet) {
            return res.status(404).json({
                success: false,
                message: "Outlet not found"
            });
        }

        let totalAmount = 0;
        let totalItems = 0;

        outlet.cart.forEach(item => {

            totalItems += item.quantity;

            totalAmount +=
                item.product.price * item.quantity;
        });

        return res.status(200).json({
            message :"cart summary calculated" ,
            success: true,
            totalItems,
            totalAmount,
            cart: outlet.cart
        });

    } catch (error) {

        return res.status(500).json({

            success: false,
            message: error.message
        });
    }
};


export const outletManualOrder = async (req, res) => {
    try {

        const outletId = req.id;

        console.log( "outlet id is:", outletId, "user id is :", req.params.id ) ;
        const user = await Vendor.findById(req.params.id);
        const outlet = await Outlet.findById(outletId)
            .populate("cart.product");

        if (!user) {
            return res.status(404)
                .json({
                    message: "Vendor not found ",
                    success: false
                });
        }

        if (!outlet) {
            return res.status(404).json({
                success: false,
                message: "Outlet not found"
            });
        }

        if (outlet.cart.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Cart is empty"
            });
        }

        const total_qty = outlet.cart.reduce(
            (qty, item) => qty + item.quantity, 0
        );

        // 1. Stock Check
        for (const item of outlet.cart) {

            const stock = await outletStock.findOne({
                outlet: outletId,
                product: item.product._id
            });

            if (!stock) {
                return res.status(404).json({
                    success: false,
                    message: `${item.product.title} stock not found`
                });
            }
            

            if (stock.quantity < item.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `${item.product.title} has only ${stock.quantity} stock available`
                });
            }
        }

        // 2. Order Items Prepare
        let totalAmount = 0;

        const orderItems = outlet.cart.map((item) => {
            totalAmount += item.product.price * item.quantity;

            return {
                product: item.product._id,
                quantity: item.quantity,
                orderPrice: item.product.price
            };
        });

        const amountWord = converter.toWords(totalAmount);


        // 3. Reduce Outlet Stock
        for (const item of outlet.cart) {

            await outletStock.updateOne(
                {
                    outlet: outletId,
                    product: item.product._id
                },
                {
                    $inc: {
                        quantity: -item.quantity
                    }
                }
            );
        }

        // Order Number
        const orderNo =
            "ORD-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 1000);

        // 4. Create Order
        const createOrder = await order.create({

            outlet: outletId,

            orderItems,

            shippingAddress: {
                address: outlet.address,
                city: outlet.city,
                state: outlet.state,
                pincode: outlet.pincode,
                country: "India",
                phoneNo: outlet.mobileNo
            },

            totalAmount,

            amountWord: `${amountWord} Rupees Only`,
            // amountWord: toWords(totalAmount) + " rupees only",

            paymentMethod: "COD",

            orderStatus: "Pending",

            orderType: "Outlet",

            orderNo
        });

        // 5. Clear Cart
        const cartSnapshot = [...outlet.cart];
        outlet.cart = [];
        await outlet.save();

        res.status(201).json({
            success: true,
            message: "Order created successfully",
            createOrder
        });

        let createInvoice = null;

        try {

            const invoiceNumber = `INV-${Date.now()}`;

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


            const invoiceData = {
                shop_name: user.store_name,
                shop_address: user.full_address,
                gst_in: user.gst_no,
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
                }),
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

            const html = generateInvoiceHTML(invoiceData);
            const pdfBuffer = await generatePDF(html);

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
                order: createOrder._id,
                vendor: user._id,
                pdfUrl
            });

            createOrder.invoice = createdInvoice._id;
            await createOrder.save();

            // user.cart = [];
            // await user.save();
            console.log(
                "Invoice generated successfully:",
                createdInvoice._id
            );

        }
        catch (er) {
            console.log(" er from invoice gen outlet order ", er);
        }

    } catch (error) {

        console.log("Outlet Manual Order Error :", error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


export const outletOrderHistory = async (req, res) => {
    try {

        const outletId = req.id;

        const orders = await order.find({
            outlet: outletId
        })
            .populate("orderItems.product", "title price image")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            message :"Fetched all product ",
            success: true,
            totalOrders: orders.length,
            orders
        });

    } catch (error) {

        console.log("Outlet Order History Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


// -----------------------------------------------------------------------------
// The marketing "Select Outlet" screen: list every outlet, or only those in a
// given pincode (?pincode=). Passwords are never included.
//   GET /vsArogya/outlets            → all outlets
//   GET /vsArogya/outlets?pincode=X  → outlets in that pincode
// -----------------------------------------------------------------------------
export const getOutlets = async (req, res) => {
    try {
        const { pincode } = req.query;
        const filter = pincode ? { pincode: String(pincode) } : {};

        const outlets = await Outlet.find(filter)
            .select("-password -cart")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: outlets.length,
            outlets
        });

    } catch (error) {
        console.log("getOutlets error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


// -----------------------------------------------------------------------------
// A single outlet's own profile, read by the signed-in outlet for its Profile
// tab. The outlet id travels in the route (the app scopes on the session's _id).
// Password and cart are never returned.
//   GET /vsArogya/outlet-profile/:id
// -----------------------------------------------------------------------------
export const getOutletProfile = async (req, res) => {
    try {
        const outletId = req.params.id;

        const outlet = await Outlet.findById(outletId).select("-password -cart");

        if (!outlet) {
            return res.status(404).json({
                success: false,
                message: "Outlet not found"
            });
        }

        return res.status(200).json({
            success: true,
            outlet
        });

    } catch (error) {
        console.log("getOutletProfile error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};


// -----------------------------------------------------------------------------
// Orders placed by a specific outlet, newest first. The outlet id travels in the
// route (the app scopes on the signed-in outlet's _id). order.user is the VENDOR
// the order was placed for, so both product and user are populated for display.
//   GET /vsArogya/outlet-orders/:id
// -----------------------------------------------------------------------------
export const getOutletOrders = async (req, res) => {
    try {
        const outletId = req.params.id;

        const orders = await order.find({ outlet: outletId })
            .populate("orderItems.product", "title packInfo price image")
            .populate("user", "store_name contact_person_name mobile_no")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: orders.length,
            orders
        });

    } catch (error) {
        console.log("getOutletOrders error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};