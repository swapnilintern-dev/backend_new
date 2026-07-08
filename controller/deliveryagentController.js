import Agent from "../model/deliveryagentModel.js";
import Vendor from "../model/userModel.js";

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
            role :"delivery"
        });

        return res.status(201)
            .json({

                message: "Agent created successfully ",
                success: true,
                agentDetails
            });

    }
    catch (er) {
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

        const { mobile_no, password } = req.body;

        if (!mobile_no || !password)
            return res.status(403)
                .json({
                    message: "All field are required ",
                    success: false
                });

        const get_agent = await Vendor.findOne({ mobile_no });

        console.log(" agent is :" , get_agent ) 

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

        return res.status(200)
            .json({
                message: "Login success ",
                success: true
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