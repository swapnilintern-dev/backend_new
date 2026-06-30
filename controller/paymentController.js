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
                amount: totalAmount * 100,
                currency: "INR",
                receipt: `order_${order_details._id}`
            }

            const pay_create = await razorpay.orders.create(options);

            order_details.paymentInfo = {

                razorpay_orderId: pay_create.id
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
                    orderId: order_details._id
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

        const generatedSignature = crypto
            .createHmac(
                "sha256",
                process.env.RAZORPAY_KEY_SECRET
            )
            .update(
                razorpay_order_id + "|" + razorpay_payment_id
            )
            .digest("hex");

        const isValid =
            generatedSignature === razorpay_signature;

        if (!isValid) {
            return res.status(400)
                .json({

                    message: "Payment not secure ",
                    success: false
                });
        }

        const order = await Order.findOne({
            "paymentInfo.raz_orderId": razorpay_order_id,
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        order.paymentInfo.raz_id =
            razorpay_payment_id;

        order.paymentInfo.raz_signature =
            razorpay_signature;

        order.paymentInfo.status =
            "Completed";

        order.paidAt = new Date();

        await order.save();

        return res.status(200).json({
            success: true,
            message: "Payment verified successfully",
            order,
        });

    } catch (error) {

        console.log("error from verify signature :", error);

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
