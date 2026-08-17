import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import converter from "number-to-words";
import generateInvoiceForOrder from "../utils/invoiceGenerator.js";
import { normalizeFreeQty } from "../utils/freeGoods.js";
import {
    withInventoryTxn,
    allocateFEFO,
    allocateOutletFEFO,
    normalizeAllocations,
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

        // Optional free goods for this line ({ freeQty }) and the batches staff
        // pinned for it ({ allocations }). Both omitted → the line's current
        // values are left untouched, so existing callers are unaffected.
        const { freeQty, allocations } = req.body || {};

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
            if (freeQty !== undefined) {
                user.cart[itemIndex].freeQty = normalizeFreeQty(freeQty);
            }
            // The pinned batches describe the WHOLE line, so a later call
            // replaces them rather than appending.
            if (allocations !== undefined) {
                user.cart[itemIndex].allocations = normalizeAllocations(allocations);
            }
        } else {
            user.cart.push({
                product: item,
                quantity: 1,
                freeQty: normalizeFreeQty(freeQty),
                allocations: normalizeAllocations(allocations)
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
        // twice, so the outlet branch allocates FEFO across the OUTLET's own
        // batches (outletStockBatch) — which keeps outletStock.quantity correct
        // as the auto-synced mirror, exactly what the old direct decrement
        // maintained by hand.
        //
        // A marketing order has no outlet and sells straight from the catalog —
        // same as placeOrder (orderController) does for a vendor: FEFO across
        // the product's batches, atomically.
        //
        // Both branches honour the batches staff pinned on the cart line and
        // record the exact lots consumed on orderItems.allocations.
        let Order;
        try {
            Order = await withInventoryTxn(async (session) => {
                const orderItems = [];
                for (const item of user.cart) {
                    const overrides = normalizeAllocations(item.allocations);
                    const allocations = outletId
                        ? await allocateOutletFEFO(
                            outletId,
                            item.product._id,
                            item.quantity,
                            overrides,
                            session
                        )
                        : await allocateFEFO(
                            item.product._id,
                            item.quantity,
                            session,
                            overrides
                        );

                    orderItems.push({
                        product: item.product._id,
                        quantity: item.quantity,
                        orderPrice: item.product.price,
                        // Free goods carried from the cart line — invoice-only,
                        // never billed (totalAmount uses `quantity` alone).
                        freeQty: normalizeFreeQty(item.freeQty),
                        // Snapshot the sold batch so the invoice never re-reads
                        // a later one; allocations[0] is the FEFO-front lot.
                        batch_no: allocations[0]?.batch_number ?? item.product.batch_no,
                        exp_date: allocations[0]?.expiry_date ?? item.product.exp_date,
                        allocations,
                    });
                }

                const created = await order.create([{
                    user: userId,
                    ...(outletId ? { outlet: outletId } : {}),
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
