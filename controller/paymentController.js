import order from "../model/orderModel.js";
import razorpay from "../utils/razorpay.js";

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

                raz_orderId: pay_create.id
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
