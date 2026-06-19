import Vendor from "../model/userModel.js";
import nodemailer from "nodemailer";

const approvalneedUser = async (req, res) => {

    try {

        const pendingUser = await Vendor.find({

            approvalStatus: "Pending"
        });

        if (pendingUser.length === 0) {
            return res.status(401)
                .json({
                    message: "User not found ",
                    success: false
                });
        }

        console.log(" pending user ", pendingUser);

        return res.status(200)
            .json({
                message: "vendor fetched ",
                success: true,
                pendingUser
            });

    }
    catch (er) {
        console.log("error is :", er);
    }
}

export default approvalneedUser;


export const statusApproval = async (req, res) => {

    try {

        const vendorId = req.params.id;

        const pendingVendor = await Vendor.findById(vendorId);

        if (!pendingVendor) {
            return res.status(401)
                .json({
                    message: "unauthorized ",
                    success: false
                });
        }

        pendingVendor.approvalStatus = "Approved";

        await pendingVendor.save();

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL,
                pass: process.env.E_PASS
            }
        });

        await transporter.sendMail({
            from: process.env.EMAIL,
            to: pendingVendor.email,
            subject: "Account Approved",
            html: `
    <h2>Registration Approved</h2>
    <p>Hello ${pendingVendor.contact_person_name},</p>
    <p>Your account has been approved by the admin. your user id is: ${pendingVendor.mobile_no} & passowrd is: ${pendingVendor.password} ,</p>
    <p>You can now log in to the application.</p>
  `
   });

   return res.status(200)
   .json({
    message :"approval sent success",
    success : true 
   });
    }
    catch (er) {
        console.log(er);
    }
}