// =============================================================================
// Manual order — created by the Marketing role on an APPROVED vendor's behalf.
//
// Vendors sometimes phone their order in; marketing composes it in the app and
// submits it here. The order is created exactly like a vendor-placed order
// (orderController.placeOrder), except:
//   • user            = the target vendor (so it shows in THEIR panel too),
//   • shippingAddress = the vendor's registered profile,
//   • orderPrice      = snapshotted from each product's current price,
//   • audit fields    = source / createdBy / clientOrderId.
//
// It starts "Pending" and flows through the SAME lifecycle — NO stock change
// and NO invoice here; both happen when marketing ACCEPTS it (confirm-order).
// Contract: ORDER_INVOICE_STOCK_INTEGRATION.md §3.
// =============================================================================

import order from "../model/orderModel.js";
import product from "../model/productModel.js";
import Vendor from "../model/userModel.js";
import converter from "number-to-words";

export const createManualOrder = async (req, res) => {
    try {
        // The authenticated staff user (set by isAuthenticated from the JWT).
        const createdBy = req.id;

        const { vendorId, items, source, clientOrderId } = req.body;

        // 1) IDEMPOTENCY — if this submit already landed (network drop, retry),
        //    return the existing order instead of creating a duplicate.
        if (clientOrderId) {
            const existing = await order.findOne({ clientOrderId });
            if (existing) {
                return res.status(200).json({
                    success: true,
                    message: "Order already created for vendor",
                    Order: existing
                });
            }
        }

        // 2) Validate the vendor — must exist and be Approved.
        if (!vendorId) {
            return res.status(400).json({
                success: false,
                message: "vendorId is required"
            });
        }

        const vendor = await Vendor.findById(vendorId);
        if (!vendor) {
            return res.status(404).json({
                success: false,
                message: "Vendor not found"
            });
        }
        if (vendor.approvalStatus !== "Approved") {
            return res.status(403).json({
                success: false,
                message: "Vendor is not approved"
            });
        }

        // 3) Validate the items.
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Add at least one product"
            });
        }

        // 4) Load each product and snapshot its price (same as placeOrder).
        const orderItems = [];
        let totalAmount = 0;

        for (const line of items) {
            const productId = line && line.productId;
            const quantity = Number(line && line.quantity);

            if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid item in order"
                });
            }

            const Product = await product.findById(productId);
            if (!Product) {
                return res.status(404).json({
                    success: false,
                    message: `Product not found: ${productId}`
                });
            }

            orderItems.push({
                product: Product._id,
                quantity,
                orderPrice: Product.price
            });
            totalAmount += Product.price * quantity;
        }

        const orderNo =
            "ORD-" +
            new Date().getFullYear() +
            Math.floor(100000 + Math.random() * 900000);

        const amountWord = converter.toWords(totalAmount);

        // 5) Create the order — Pending, no stock deduction, no invoice yet.
        //    shippingAddress comes from the vendor's registered profile;
        //    "N/A" fallbacks keep a partially-filled profile from failing the
        //    schema's required address fields.
        const Order = await order.create({
            user: vendorId,
            orderItems,
            shippingAddress: {
                address: vendor.full_address || "N/A",
                city: vendor.city || "N/A",
                state: vendor.state || "N/A",
                pincode: vendor.pin_code || "N/A",
                country: "India",
                phoneNo: vendor.mobile_no || "N/A"
            },
            totalAmount,
            orderNo,
            amountWord,
            orderStatus: "Pending",
            orderType: "Manual",
            source: source || "MANUAL_BY_MARKETING",
            createdBy,
            // Only store a real key so the unique/sparse index skips blanks.
            ...(clientOrderId ? { clientOrderId } : {})
        });

        return res.status(201).json({
            success: true,
            message: "Order created for vendor",
            Order
        });
    } catch (er) {
        // A concurrent retry can race past the findOne check and trip the
        // unique clientOrderId index — resolve it to the winning order so the
        // caller still gets a clean success instead of a 500.
        if (er && er.code === 11000 && req.body && req.body.clientOrderId) {
            const existing = await order.findOne({
                clientOrderId: req.body.clientOrderId
            });
            if (existing) {
                return res.status(200).json({
                    success: true,
                    message: "Order already created for vendor",
                    Order: existing
                });
            }
        }

        console.log("createManualOrder error:", er);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

export default createManualOrder;
