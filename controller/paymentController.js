import order from "../model/orderModel.js";
import razorpay from "../utils/razorpay.js";
import crypto from "crypto";
// import Order from "../models/order.model.js";

const createPayment = async (req, res) => {

    try {

        const userId = req.id;
        const order_id = req.params.id;

        const { paymentMethod } = req.body;

        const order_details = await order.findById(order_id);


        if (!order_details)

            return res.status(401)
                .json({
                    message: "order not found ",
                    success: false
                });


        if (order_details.user.toString() !== userId) {

            return res.status(403).json({
                message: "Unauthorized",
                success: false
            });
        }
        const totalAmount = order_details.totalAmount;


        if (paymentMethod === "COD") {
            order_details.paymentMethod = "COD";
            await order_details.save();

            console.log(" order is :", order_details);
            return res.status(200)
                .json({
                    message: "Order placed Successfully",
                    success: true
                });
        }
        else {

            const options = {
                // Razorpay needs an INTEGER paise amount — round to avoid
                // floating-point values like 12344.9999 that get rejected.
                amount: Math.round(totalAmount * 100),
                currency: "INR",
                receipt: `order_${order_details._id}`
            }

            const pay_create = await razorpay.orders.create(options);

            order_details.paymentInfo = {
                razorpay_orderId: pay_create.id,
                status: "Pending"
            };

            order_details.paymentMethod = "ONLINE";

            await order_details.save();


            return res.status(200)
                .json({
                    message: "payment created ",
                    success: true,
                    razorpayOrderId: pay_create.id,
                    amount: pay_create.amount,
                    currency: pay_create.currency,
                    orderId: order_details._id,
                    razorpayKeyId: process.env.RAZORPAY_KEY_ID
                });
        }
    }
    catch (er) {

        console.log("error from createPayment", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}
export default createPayment;


export const verifyPayment = async (req, res) => {
    try {

        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Missing payment fields",
            });
        }

        // Recreate the signature from order_id|payment_id and compare — this is
        // what proves the callback really came from Razorpay and wasn't forged.
        const generatedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Payment verification failed",
            });
        }

        // Match the app order by the Razorpay order id stored at create time.
        const orderDoc = await order.findOne({
            "paymentInfo.razorpay_orderId": razorpay_order_id,
        });

        if (!orderDoc) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        // The order must belong to the caller (defence-in-depth alongside the
        // signature check).
        if (orderDoc.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized",
            });
        }

        // Idempotent: if it's already marked paid, don't double-process.
        if (orderDoc.paymentInfo && orderDoc.paymentInfo.status === "Completed") {
            return res.status(200).json({
                success: true,
                message: "Payment already verified",
            });
        }

        orderDoc.paymentInfo.razorpay_id = razorpay_payment_id;
        orderDoc.paymentInfo.razorpay_signature = razorpay_signature;
        orderDoc.paymentInfo.status = "Completed";
        orderDoc.paymentMethod = "ONLINE";
        orderDoc.paidAt = new Date();

        await orderDoc.save();

        return res.status(200).json({
            success: true,
            message: "Payment verified successfully",
        });

    } catch (error) {
        console.log("verifyPayment error:", error);
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};










// import crypto from "crypto";

// export const verifyPayment = async (req, res) => {
//   try {
//     const {
//       razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_signature,
//     } = req.body;

//     const body =
//       razorpay_order_id + "|" + razorpay_payment_id;

//     const expectedSignature = crypto
//       .createHmac(
//         "sha256",
//         process.env.RAZORPAY_KEY_SECRET
//       )
//       .update(body.toString())
//       .digest("hex");

//     const isAuthentic =
//       expectedSignature === razorpay_signature;

//     if (!isAuthentic) {
//       return res.status(400).json({
//         success: false,
//         message: "Payment verification failed",
//       });
//     }

//     // Payment verified
//     // Yahan order status update kar sakte ho

//     res.status(200).json({
//       success: true,
//       message: "Payment verified successfully",
//       paymentId: razorpay_payment_id,
//     });

//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };


// export const verifyPayment = async (req, res) => {

//     try {

//         const {

//             razorpay_id,
//             razorpay_orderId,
//             razorpay_signature
//         } = req.body;


//         const body = razorpay_orderId + "|" + razorpay_id;

//         const expectedSignature = crypto
//             .createHmac(
//                 "sha256",
//                 process.env.RAZORPAY_KEY_SECRET
//             )
//             .update(body.toString())
//             .digest("hex");



//     }
//     catch (er) {
//         console.log("er is :", er);
//     }
// } 
