import Vendor from "../model/userModel.js";
import Order from "../model/orderModel.js";
import product from "../model/productModel.js";
import jwt from "jsonwebtoken";

// -----------------------------------------------------------------------------
// Area Agent login. An agent is a Vendor with role "agent" and an assigned
// pin_code. They sign in with their mobile number + password; the app then
// scopes every call to the returned agent id (pincode-wise orders + vendors).
//   POST /vsArogya/agent-login   { mobileNo, password }
// -----------------------------------------------------------------------------
export const agentLogin = async (req, res) => {
    try {
        const { mobileNo, password } = req.body;

        if (!mobileNo || !password) {
            return res.status(400).json({
                success: false,
                message: "Mobile number and password are required"
            });
        }

        const agent = await Vendor.findOne({
            mobile_no: mobileNo,
            role: "agent"
        });

        if (!agent || password !== agent.password) {
            return res.status(401).json({
                success: false,
                message: "Incorrect mobile number or password"
            });
        }

        const token = jwt.sign(
            { id: agent._id, role: "agent" },
            process.env.SECRET_KEY,
            { expiresIn: "7d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: "strict"
        });

        return res.status(200).json({
            success: true,
            message: "Agent login success",
            role: "agent",
            token,
            agent: {
                id: agent._id,
                name: agent.contact_person_name || agent.store_name || "Area Agent",
                pincode: agent.pin_code || ""
            }
        });

    } catch (er) {
        console.log("agentLogin error:", er);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// -----------------------------------------------------------------------------
// Register an Area Agent (created by the marketing head). An agent is a Vendor
// with role "agent" and an assigned pin_code — approvalStatus is set to
// "Approved" so they can sign in immediately with mobile + password.
//   POST /vsArogya/agent-register  { name, mobileNo, email, pincode, password }
// -----------------------------------------------------------------------------
export const agentRegister = async (req, res) => {
    try {
        const { name, mobileNo, email, pincode, password } = req.body;

        if (!name || !mobileNo || !pincode || !password) {
            return res.status(400).json({
                success: false,
                message: "Missing fields"
            });
        }

        const existing = await Vendor.findOne({ mobile_no: mobileNo });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "A user with this mobile number already exists"
            });
        }

        const agent = await Vendor.create({
            role: "agent",
            contact_person_name: name,
            store_name: name,
            mobile_no: mobileNo,
            email: email || undefined,
            pin_code: pincode,
            password,
            approvalStatus: "Approved"
        });

        const { password: _pw, ...safeAgent } = agent.toObject();

        return res.status(201).json({
            success: true,
            message: "Agent registered successfully",
            agent: safeAgent
        });

    } catch (er) {
        // Unique-index clash (mobile_no / email already used).
        if (er && er.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "An account with this mobile number or email already exists"
            });
        }
        console.log("agentRegister error:", er);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

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


// -----------------------------------------------------------------------------
// A single Area Agent's own profile, read by the signed-in agent for its Profile
// screen. An agent is a Vendor with role "agent"; the id travels in the route
// (the app scopes on the session's _id). Password/cart/savedProducts are never
// returned.
//   GET /vsArogya/agent-profile/:id
// -----------------------------------------------------------------------------
export const getAgentProfile = async (req, res) => {
    try {
        const agentId = req.params.id;

        const agent = await Vendor
            .findById(agentId)
            .select("-password -cart -savedProducts");

        if (!agent || agent.role !== "agent") {
            return res.status(404).json({
                success: false,
                message: "Agent not found"
            });
        }

        return res.status(200).json({
            success: true,
            agent
        });

    } catch (error) {
        console.log("getAgentProfile error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
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