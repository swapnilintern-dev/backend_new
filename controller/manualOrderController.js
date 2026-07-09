import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import converter from "number-to-words";
import generateInvoiceForOrder from "../utils/invoiceGenerator.js";

// =============================================================================
// Manual order — Marketing places an order on a specific (approved) vendor's
// behalf. Two steps, vendorId in the route (filled in from the vendor the
// marketing user selected):
//   POST /manual-cart/:vendorId/:itemId  → add one unit to that vendor's cart
//   POST /manual-order/:vendorId          → place the order from that cart
//
// The invoice is produced by the SHARED generator (utils/invoiceGenerator.js),
// which renders templates/invoice.html with the backend developer's GST
// slab-extraction logic — so the vendor, marketing and admin flows all emit the
// identical document.
// =============================================================================

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

        // Increment if the product is already in the cart, else add it.
        const itemIndex = user.cart.findIndex(
            (ci) => ci.product.toString() === item
        );
        if (itemIndex > -1) {
            user.cart[itemIndex].quantity += 1;
        } else {
            user.cart.push({ product: item, quantity: 1 });
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
};
export default manualCart;


export const manualOrder = async (req, res) => {
    try {
        const userId = req.params.vendorId;
        const user = await Vendor.findById(userId).populate("cart.product");

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
            orderPrice: item.product.price
        }));

        const totalAmount = user.cart.reduce(
            (total, item) => total + item.product.price * item.quantity,
            0
        );

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

        // The order captured the cart — clear it now.
        user.cart = [];
        await user.save();

        // Reply first so the request never waits on Puppeteer.
        res.status(201)
            .json({
                message: "Order placed successfully",
                success: true,
                Order
            });

        // Generate the invoice from templates/invoice.html via the shared
        // generator (backend developer's GST slab-extraction logic). It runs
        // after the response, is idempotent, and never throws — so a PDF hiccup
        // can't fail the already-placed order. The invoice links to the order
        // and is served by GET /prev-invoice/:id.
        generateInvoiceForOrder(Order._id).catch((e) =>
            console.log("manual-order invoice generation failed:", e?.message));
    }
    catch (er) {
        console.log(" er is :", er);
        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
};
