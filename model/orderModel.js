import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
        required: true
    },

    orderItems: [
        {
            product: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "product",
                required: true
            },

            quantity: {
                type: Number,
                required: true
            },

            orderPrice: {
                type: Number,
                required: true
            }
        }
    ],

    shippingAddress: {
        address: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        state: {
            type: String,
            required: true
        },
        pincode: {
            type: String,
            required: true
        },
        country: {
            type: String,
            required: true
        },
        phoneNo: {
            type: String,
            required: true
        }
    },

    paymentMethod: {
        type: String,
        enum: ["COD", "ONLINE"]
    },
    paymentInfo: {
        razorpay_id: { type: String },        // Razorpay payment id
        razorpay_orderId: { type: String },   // Razorpay order id
        razorpay_signature: { type: String }, // Razorpay signature
        status: {
            type: String,
            enum: ["Pending", "Completed", "Failed", "Refunded"],
            default: "Pending"
        }
    },
    paidAt: {
        type: Date
    },


    totalAmount: {
        type: Number,
        required: true
    },

    orderStatus: {
        type: String,
        enum: ["Pending", "Confirm Order", "Shipped", "Out for Delivery", "Delivered", "Cancelled"],
        default: "Pending"
    },

    deliveredAt: {
        type: Date
    },
    invoice: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Invoice"
    },
    orderNo: {
        type: String,

    },
    amountWord: {
        type: String,
        required: true
    },

    paymentMethod: {
        type: String,
        enum: ["COD", "ONLINE"]
    },
        orderType :{
        type :String ,
        default:"byApp"
    },

    // --- Audit + idempotency (manual orders placed by marketing on a vendor's
    // behalf; see ORDER_INVOICE_STOCK_INTEGRATION.md §3) ---

    // "MANUAL_BY_MARKETING" for phone orders created by staff; absent on
    // vendor-placed orders. The app renders a "Manual" badge from it.
    source: {
        type: String
    },

    // The authenticated staff user (marketing/admin) who created a manual
    // order — audit trail only. Absent on vendor-placed orders.
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor"
    },

    // Idempotency key: the app reuses the SAME value when it retries after a
    // mid-submit network drop, so a duplicate submit maps to the same order.
    // Unique + sparse so vendor-placed orders (no key) are exempt.
    clientOrderId: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    }

}, { timestamps: true });

const order = mongoose.model('order', orderSchema);
export default order;