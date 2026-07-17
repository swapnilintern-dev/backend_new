import Agent from "../model/deliveryagentModel.js";
import Vendor from "../model/userModel.js";
import jwt from "jsonwebtoken";

const agentAccount = async (req, res) => {

    try {

        const { fullName, email, mobile } = req.body;

        if (!fullName || !email || !mobile) {
            return res.status(404)
                .json({
                    message: "All field are required ",
                    success: false
                });
        }

        const autoGenrated = Math.floor(100000 + (Math.random() * 900000));

        console.log("auto genrated password is :", autoGenrated);

        const agentDetails = await Vendor.create({
            contact_person_name:fullName ,
            email,
            mobile_no : mobile,
            password: autoGenrated,
            role :"delivery",
            approvalStatus: "Approved"
        });

        return res.status(201)
            .json({

                message: "Agent created successfully ",
                success: true,
                agentDetails
            });

    }
    catch (er) {
        // Unique-index clash — the mobile number or email is already taken.
        if (er && er.code === 11000) {
            return res.status(409)
                .json({
                    message: "An account with this mobile number or email already exists",
                    success: false
                });
        }
        console.log(" er is :", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}

export default agentAccount;

export const agentLogin = async (req, res) => {

    try {

        // The app sends `mobile`; older callers sent `mobile_no` — accept both.
        const { mobile, mobile_no, password } = req.body;
        const mobileNumber = mobile || mobile_no;

        if (!mobileNumber || !password)
            return res.status(403)
                .json({
                    message: "All field are required ",
                    success: false
                });

        // MUST be role-filtered: this login is a FALLBACK the sign-in screen
        // tries when the main /login fails. Without the role filter, any Vendor
        // whose main login was rejected (e.g. pending approval) would match
        // here and be routed into the Delivery portal.
        const get_agent = await Vendor.findOne({
            mobile_no: mobileNumber,
            role: "delivery"
        });

        if (!get_agent) {
            return res.status(401)
                .json({
                    message: "Agent not found ",
                    success: false
                });
        }
        if (get_agent.password !== password)
            return res.status(404)
                .json({
                    message: "Creadential wrong",
                    success: false
                });

        const token = jwt.sign(
            { id: get_agent._id, role: "delivery" },
            process.env.SECRET_KEY,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            maxAge: 1 * 24 * 60 * 60 * 1000,
            sameSite: "strict"
        });

        return res.status(200)
            .json({
                message: "Login success ",
                success: true,
                role: "delivery",
                token,
                name: get_agent.contact_person_name || ""
            });

    } catch (er) {

        console.log(" er is :", er);
        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}