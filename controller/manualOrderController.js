import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import outletStock from "../model/outletStockModel.js";
import converter from "number-to-words";
import generateInvoiceForOrder from "../utils/invoiceGenerator.js";
import {
    withInventoryTxn,
    allocateFEFO,
    InsufficientStockError,
} from "../utils/inventory.js";

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

        // Optional: set by the Outlet role so the order can be traced back to
        // the outlet that placed it (order.user is the VENDOR, so without this
        // there is no link). Marketing doesn't send it — the order is then
        // stored without an outlet exactly as before.
        const { outletId } = req.body || {};

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

        const totalAmount = user.cart.reduce(
            (total, item) => total + item.product.price * item.quantity,
            0
        );

        const amountWord = converter.toWords(totalAmount);

        const shippingAddress = {
            address: user.full_address,
            city: user.city,
            state: user.state,
            pincode: user.pin_code,
            country: "IN",
            phoneNo: user.mobile_no
        };

        // Take the stock out of the right bucket.
        //
        // An OUTLET order sells stock the outlet already holds, and that stock
        // LEFT the catalog when marketing assigned it (addOutletStock consumes
        // catalog batches). Deducting the catalog again here would charge it
        // twice and leave outletStock.quantity untouched, so the outlet would
        // keep showing stock it had already sold — so the outlet branch draws
        // the outlet's own (non-batched) pool, unchanged.
        //
        // A marketing order has no outlet and sells straight from the catalog —
        // same as placeOrder (orderController) does for a vendor: FEFO across
        // the product's batches, atomically.
        let Order;
        if (outletId) {
            // Check EVERY line before changing anything, so a short line can't
            // leave the order half-deducted.
            const rows = [];
            for (const line of user.cart) {
                const row = await outletStock.findOne({
                    outlet: outletId,
                    product: line.product._id
                });

                if (!row || row.quantity < line.quantity) {
                    return res.status(400)
                        .json({
                            message: `Insufficient outlet stock for ${line.product.title}: available ${row?.quantity ?? 0}, ordered ${line.quantity}`,
                            success: false
                        });
                }
                rows.push({ row, qty: line.quantity });
            }

            for (const { row, qty } of rows) {
                row.quantity -= qty;
                await row.save();
            }

            const orderItems = user.cart.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                orderPrice: item.product.price,
                // Snapshot the sold batch so the invoice never re-reads a later one.
                batch_no: item.product.batch_no,
                exp_date: item.product.exp_date
            }));

            Order = await order.create({
                user: userId,
                outlet: outletId,
                orderItems,
                shippingAddress,
                totalAmount,
                orderNo,
                amountWord
            });
        }
        else {
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
                            batch_no: allocations[0]?.batch_number ?? item.product.batch_no,
                            exp_date: allocations[0]?.expiry_date ?? item.product.exp_date,
                            allocations,
                        });
                    }

                    const created = await order.create([{
                        user: userId,
                        orderItems,
                        shippingAddress,
                        totalAmount,
                        orderNo,
                        amountWord
                    }], { session });

                    return created[0];
                });
            } catch (err) {
                if (err instanceof InsufficientStockError) {
                    return res.status(400).json({ message: err.message, success: false });
                }
                throw err;
            }
        }


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
