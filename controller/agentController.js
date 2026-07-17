import Vendor from "../model/userModel.js";
import Order from "../model/orderModel.js";
import product from "../model/productModel.js";

export const pincode_vendors = async (req, res) => {
    try {

        const agentId = req.params.id;

        const agentDetails = await Vendor.findById(agentId);

        if (!agentDetails) {
            return res.status(404).json({
                message: "Agent not found",
                success: false,
            });
        }

        const pincode = agentDetails.pin_code;

        const allVendorByPin = await Vendor.find({
            pin_code: pincode,
            _id: { $ne: agentId } // current agent ko exclude karega
        });


        console.log("all vendor of pin code is :", allVendorByPin);

        return res.status(200).json({
            message: "Vendors fetched successfully",
            success: true,
            totalVendor: allVendorByPin.length,
            vendors: allVendorByPin,
        });

    } catch (er) {

        console.log("Error is:", er);

        return res.status(500).json({
            message: "Internal server error",
            success: false,
        });
    }
};


export const getPincodeOrders = async (req, res) => {
    try {

        const agentId = req.params.id;

        const agent = await Vendor.findById(agentId);

        console.log("agent pin is :", agent.pin_code)

        if (!agent) {
            return res.status(404).json({
                success: false,
                message: "Agent not found"
            });
        }

        const orders = await Order.find({
            "shippingAddress.pincode": agent.pin_code,
            orderStatus: {
                $in: [
                    "Pending",
                    "Confirm Order",
                    "Shipped",
                    "Out for Delivery"
                ]
            }
        })
            .populate("user", "store_name mobile_no")
            .populate({
                path: "orderItems.product",
                select: "title"
            })
            .sort({ createdAt: -1 });


        console.log("all order of pincode is :", orders)
        return res.status(200).json({
            success: true,
            totalOrders: orders.length,
            orders
        });

    } catch (error) {

        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// export const stockUpdate = async( req , res ) =>{


//     try{
        
//         const product_id = req.params.id ;

//         const outletStock = req.body ;

//         const get_product = await product.find( product_id ) ;

//         if( !get_product ){
//             return res.status(403)
//             .json({
//                 message :"Product not found ",
//                 success : false 
//             });
//         }

        








//     }
//     catch(er){
//         console.log(" er  is :" , er ) ;

//         return res.status(500)
//         .json({
//             message :"Internal server error ",
//             success : false 
//         });
//     }
// }