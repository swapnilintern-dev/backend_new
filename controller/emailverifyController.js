import Eotp from "../model/emailLoginModel.js";
import nodmailer from "nodemailer"
import jwt from "jsonwebtoken";
import Vendor from "../model/userModel.js";
import Outlet from "../model/outletregistersModel.js";

// How long a mailed code stays usable. Mongo's TTL index on the Eotp document
// is the primary enforcement; this is the exact check so a code can't slip
// through in the window before the TTL sweeper runs.
const OTP_TTL_MS = 10 * 60 * 1000;

// A 6-digit code is only 1,000,000 possibilities — without a cap an attacker
// could simply submit them all. Three strikes and the code is burned.
const MAX_OTP_ATTEMPTS = 5;

// Staff accounts skip the admin-approval gate, exactly as POST /login does.
// Keep this list in sync with userController.login.
const STAFF_ROLES = ["admin", "marketing", "delivery", "agent", "outlet"];

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/**
 * POST /vsArogya/eotp   { email }
 *
 * Mails a one-time code. Replies the SAME way whether or not an account exists,
 * so this endpoint can't be used to find out which emails are registered.
 */
export const sendOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email required ' });
        }

        // Does this address actually belong to an account? Vendors (which also
        // hold the admin/marketing/delivery/agent staff roles) and outlets live
        // in separate collections, so both are checked.
        const [vendor, outlet] = await Promise.all([
            Vendor.findOne({ email }).select("_id"),
            Outlet.findOne({ email }).select("_id"),
        ]);

        // Unknown address: do NOT send a code and do NOT create an account, but
        // answer exactly like the success path. Telling the caller "no such
        // user" here would turn this into an account-enumeration oracle.
        if (!vendor && !outlet) {
            return res.status(200).json({
                success: true,
                message: 'OTP sent in given email. ',
            });
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

/**
 * POST /vsArogya/eotp-verify   { email, otp }
 *
 * Verifies the code and signs the account in.
 *
 * The reply deliberately mirrors POST /vsArogya/login and POST
 * /vsArogya/outlet-login field for field — `token`, `role`, `id`, `name`,
 * `pincode` (plus `outlet` for an outlet account). The app feeds the body of
 * whichever login it used into the same session/role routing, so any drift here
 * would silently break OTP sign-in for some roles.
 */
export const verifyOtpAndLogin = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const otp = String(req.body?.otp || "").trim();

        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'Missing field' });
        }

        // Look the code up by email only. Fetching by (email, otp) would make a
        // wrong code indistinguishable from no code at all, leaving nowhere to
        // record the failed attempt — and the brute-force cap would never fire.
        const otpRecord = await Eotp.findOne({ email }).sort({ createdAt: -1 });

        if (!otpRecord) {
            return res.status(400).json({ success: false, message: 'Invaild otp' });
        }

        // Expired codes are rejected here as well as by the TTL index, which
        // only sweeps about once a minute.
        if (Date.now() - new Date(otpRecord.createdAt).getTime() > OTP_TTL_MS) {
            await Eotp.deleteOne({ _id: otpRecord._id });
            return res.status(400).json({
                success: false,
                message: 'This OTP has expired. Please request a new one.',
            });
        }

        if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
            await Eotp.deleteOne({ _id: otpRecord._id });
            return res.status(429).json({
                success: false,
                message: 'Too many incorrect attempts. Please request a new OTP.',
            });
        }

        if (otpRecord.otp !== otp) {
            await Eotp.updateOne({ _id: otpRecord._id }, { $inc: { attempts: 1 } });
            return res.status(400).json({ success: false, message: 'Invaild otp' });
        }

        // Correct code — burn it immediately so it can never be replayed, even
        // if the account lookups below fail.
        await Eotp.deleteOne({ _id: otpRecord._id });

        // ---- Outlet account (its own collection, its own session shape) ----
        const outlet = await Outlet.findOne({ email });

        if (outlet) {
            const token = jwt.sign(
                { id: outlet._id, role: "outlet" },
                process.env.SECRET_KEY,
                { expiresIn: "7d" }
            );

            res.cookie("token", token, {
                httpOnly: true,
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: "strict",
            });

            const { password: _pw, ...safeOutlet } = outlet.toObject();

            return res.status(200).json({
                message: 'Login success ',
                success: true,
                role: "outlet",
                token,
                id: outlet._id,
                name: outlet.outletName,
                pincode: outlet.pincode,
                outlet: safeOutlet,
            });
        }

        // ---- Vendor collection (buyers AND the staff roles) ----
        const user = await Vendor.findOne({ email });

        // No account for this address. An account is NEVER created here: a
        // vendor made on the fly would have no role and no approvalStatus,
        // which would walk straight past the admin-approval gate below.
        // Registration is its own flow (POST /register-vendor).
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'No account found for this email. Please register first.',
            });
        }

        // Same approval gate as the password login: buyers must be approved by
        // an admin before they can sign in. Staff roles skip it.
        const role = String(user.role || "").toLowerCase();
        if (!STAFF_ROLES.includes(role) && user.approvalStatus !== "Approved") {
            const msg = user.approvalStatus === "Rejected"
                ? "Your registration was rejected. Please contact support."
                : "Your account is pending admin approval. You'll get your login details by email once approved.";
            return res.status(403).json({ success: false, message: msg });
        }

        // updateOne, not save(): a full-document save would re-run validation on
        // a record this request never touched, so an older vendor row that is
        // missing a field could fail a login that has otherwise succeeded.
        await Vendor.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });

        const token = jwt.sign(
            {
                id: user._id,
                role: user.role || "vendor",
            },
            process.env.SECRET_KEY,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            maxAge: 1 * 24 * 60 * 60 * 1000,
            sameSite: "strict",
        });

        return res.status(200).json({
            message: 'Login success ',
            success: true,
            role: user.role,
            token,
            id: user._id,
            pincode: user.pin_code,
            name: user.contact_person_name || user.store_name,
            email: user.email,
            approvalStatus: user.approvalStatus,
            // Same buyer-type fields the password login returns, so both
            // sessions price the catalogue identically.
            vendor_type: user.vendor_type,
            shop_type: user.shop_type,
        });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        return res.status(500).json({ success: false, message: 'Server error, login failed' });
    }
};
