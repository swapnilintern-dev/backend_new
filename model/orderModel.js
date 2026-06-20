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
        required: true,
        enum: ["COD", "ONLINE"]
    },
    paymentInfo: {
        id: { type: String },        // Razorpay payment id
        orderId: { type: String },   // Razorpay order id
        signature: { type: String }, // Razorpay signature
        status: {
            type: String,
            required: true,
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
    }

}, { timestamps: true });

const order = mongoose.model('order', orderSchema);
export default order;