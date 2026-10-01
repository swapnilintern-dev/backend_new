import Eotp from "../model/emailLoginModel.js";
import nodmailer from "nodemailer"
import Vendor from "../model/userModel.js";


export const sendOtp = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email required ' });
        }

        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();


        await Eotp.deleteMany({ email });

        // DB me new OTP save karein (auto expire set hai)
        await Eotp.create({ email, otp: generatedOtp });

        const transporter = nodmailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL,
                pass: process.env.E_PASS // App Password (Google Account Security se generate karein)
            },
        });

        // Email bhejain
        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Login OTP - VS Arogya',
            html: `<h3> Your verification OTP is: <b>${generatedOtp}</b></h3>
             <p>Your OTP will expire in 10 minutes.</p>`,
        };



        await transporter.sendMail(mailOptions);

        return res.status(200).json({
            success: true,
            message: 'OTP sent in given email. ',
        });
    } 
    catch (error) {
        console.error('Send OTP Error:', error);
        return res.status(500).json({ success: false, message: 'Server error, OTP ' });
    }
};

export const verifyOtpAndLogin = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'Missing field' });
        }

        // Database me OTP check karein
        const otpRecord = await Eotp.findOne({ email, otp });

        if (!otpRecord) {
            return res.status(400).json({ success: false, message: 'Invaild otp' });
        }

        // Verification ke baad OTP ko immediately manually bhi delete kar dein
        await Eotp.deleteOne({ _id: otpRecord._id });

        // Check karein user DB me pehle se hai ya naya hai
        let user = await Vendor.findOne({ email });

        if (!user) {
           
            user = await Vendor.create({ email });
        } else {
           
            user.lastLogin = Date.now();
            await user.save();
        }

        // Optional: Yahan aap JWT Token generate karke bhej sakte hain
        return res.status(200).json({
            success: true,
            message: 'Login successful!',
            user: {
                id: user._id,
                email: user.email,
                lastLogin: user.lastLogin,
            },
        });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        return res.status(500).json({ success: false, message: 'Server error, login failed' });
    }
};