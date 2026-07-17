import Vendor from "../model/userModel.js";
import cloudinary from "../utils/cloudinary.js";
import getDatauri from "../utils/datauri.js";
import sharp from "sharp";
import multer from "multer";
import jwt from "jsonwebtoken";
import nodmailer from "nodemailer";
import { Resend } from "resend"


export const registerVendor = async (req, res) => {


  console.log("register controller hited ");
  try {
    const {
      vendor_type,
      shop_type,
      store_name,
      contact_person_name,
      mobile_no,
      email,
      full_address,
      city,
      state,
      pin_code,
      gst_status,
      drug_lic_no,
      drug_lic_ex_date,
      password,
    } = req.body;

    const gst_pdf = req.files?.gst_pdf?.[0];
    const store_pic = req.files?.store_pic?.[0];
    const drug_lic_copy = req.files?.drug_lic_copy?.[0];


    if (!store_name || !mobile_no || !email || !vendor_type || !shop_type || !store_name ||

      !contact_person_name || !mobile_no ||
      !email || !full_address || !city || !state || !pin_code
      || !gst_status || !drug_lic_ex_date || !drug_lic_no

    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    if (!store_pic) {
      return res.status(400).json({
        success: false,
        message: "Store image is required",
      });
    }

    let gstUpload = null;
    let drugUpload = null;

    // Store Image Upload
    const optimizedImage = await sharp(store_pic.buffer)
      .resize({
        width: 800,
        height: 800,
        fit: "inside",
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    const imageUri = `data:image/jpeg;base64,${optimizedImage.toString(
      "base64"
    )}`;

    const storeUpload = await cloudinary.uploader.upload(imageUri, {
      folder: "vendors/store-images",
    });

    // GST PDF Upload
    if (gst_pdf) {
      const gstUri = getDatauri(gst_pdf);


      gstUpload = await cloudinary.uploader.upload(gstUri, {
        folder: "vendors/gst",
        resource_type: "auto",   // ✅ Use "raw" for PDFs, not "auto"
        // use_filename: true,
        // unique_filename: true,  // ✅ Avoid filename conflicts
      });
    }

    console.log("auto is :", gstUpload)

    // Drug License PDF Upload
    if (drug_lic_copy) {
      const drugUri = getDatauri(drug_lic_copy);

      drugUpload = await cloudinary.uploader.upload(drugUri, {
        folder: "vendors/drug-license",
        resource_type: "auto",   // ✅ Same here
        // use_filename: true,
        // unique_filename: true,
      });
    }

    console.log("raw is:", drugUpload);

    let autoPassword = Math.floor(1000 + Math.random() * 9000);

    console.log("auto generated password is :", autoPassword);

    const vendor = await Vendor.create({
      vendor_type,
      shop_type,
      store_name,
      contact_person_name,
      mobile_no,
      email,
      full_address,
      city,
      state,
      pin_code,
      gst_status,
      drug_lic_no,
      drug_lic_ex_date,
      password: autoPassword,

      store_pic: {
        url: storeUpload.secure_url,
        publicId: storeUpload.public_id,
      },

      gst_pdf: {
        url: gstUpload.secure_url,
        publicId: gstUpload.public_id,
        fileName: gst_pdf.originalname,
      },

      drug_lic_copy: {
        url: drugUpload.secure_url,
        publicId: drugUpload.public_id,
        fileName: drug_lic_copy.originalname
      }
    });



    const transporter = nodmailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.E_PASS
      }
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL,
      to: email,
      subject: "Vendor Registration",
      html: `

        <h1>Hi ${contact_person_name} </h1>
      <p>🎉 Your vendor registration has been successfully received.</p>
      <p>Your application is currently under review.</p>
      <p>We'll notify you via email once the verification process is complete.</p>
      <p>Thank you for being part of our growing network🚀. 🎉 </p>
       <p>Warm Regards,<br>
       Team:VS Arogya </p>

      `
    });

    //   console.log(" resend api is " , process.env.RESEND_API_KEY ) ;

    //   const resend = new Resend(process.env.RESEND_API_KEY);


    //   const { data, error } = await resend.emails.send({
    //   from: process.env.RESEND_FROM_EMAIL ,
    //     to: [email],
    //     subject: "Vendor Registration",
    //     html: `
    //   <h1>Hi ${contact_person_name}</h1>

    //   <p>🎉 Your vendor registration has been successfully received.</p>

    //   <p>Your application is currently under review.</p>

    //   <p>
    //     We'll notify you via email once the verification process
    //     is complete.
    //   </p>

    //   <p>
    //     Thank you for being part of our growing network 🚀🎉
    //   </p>

    //   <p>
    //     Warm Regards,<br>
    //     Team: VS Arogya
    //   </p>
    // `
    //   });

    //   if (error) {
    //     console.error("Resend email error:", error);
    //   } else {
    //     console.log("Email sent successfully:", data);
    //   }


    console.log("email info is :", info);


    if (info.accepted.length < 0) {
      return res.status(404)
        .json({
          message: "Email not sent ", success: false
        });
    }

    return res.status(201).json({
      success: true,
      message: "Registration submitted. Approval status will be sent to your email.",
      pdf_url: gstUpload.secure_url
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const login = async (req, res) => {

  try {

    const { mobile_no, password } = req.body;

    if (!mobile_no || !password) {

      return res.status(401)
        .json({
          message: "All field are required ",
          success: false
        });
    }

    const user = await Vendor.findOne({ mobile_no });

    if (!user) {
      return res.status(401)
        .json({
          message: "User not found ",
          success: false
        });
    }

    console.log("enter password ", password, "data base password is :", user.password);


    if (password !== user.password) {

      return res.status(401)
        .json({
          message: "Credentials are wrong ",

          success: false
        });
    }

    // Buyers/vendors can only log in once an admin approves them. Staff
    // accounts (admin / marketing / delivery) skip this approval gate.
    const staffRoles = ["admin", "marketing", "delivery", "agent", "outlet"];
    if (!staffRoles.includes((user.role || "").toLowerCase()) &&
      user.approvalStatus !== "Approved") {
      const msg = user.approvalStatus === "Rejected"
        ? "Your registration was rejected. Please contact support."
        : "Your account is pending admin approval. You'll get your login details by email once approved.";
      return res.status(403).json({ success: false, message: msg });
    }

    // token genrate — carry the user's REAL role (admin/marketing/delivery/
    // agent/buyer), not a hardcoded "vendor", so role-guarded routes can trust
    // the token.
    const token = jwt.sign(

      {
        id: user._id,
        role: user.role || "vendor"
      },
      process.env.SECRET_KEY,
      { expiresIn: "1d" }
    );


    res.cookie("token", token, {


      httpOnly: true,
      maxAge: 1 * 24 * 60 * 60 * 1000,
      sameSite: "strict"

    });

    return res.status(201)
      .json({
        message: "Login success ",
        success: true,
        role: user.role,
        token,
        // Additive fields (ignored by roles that don't need them). The Area
        // Agent role scopes its pincode-wise order/vendor calls on these.
        id: user._id,
        pincode: user.pin_code,
        name: user.contact_person_name || user.store_name
      });

  }
  catch (er) {

    console.log(er, "error is :");
    return res.status(500)
      .json({
        message: "Internal server error ",
        success: false
      });
  }
};

export const logout = async (req, res) => {

  try {

    res.cookie("token", "", { maxAge: 0 });

    return res.status(200)
      .json({
        message: "Logout successfuly",
        success: true
      });

  }
  catch (er) {
    console.log(er, "error is :");
  }
}



export const deleteAccount = async (req, res) => {
  try {

    const vendor = await Vendor.findById(req.id);

    const confirm = req.body;

    if (!confirm)
      return res.status(401)
        .json({
          message: "First approved account deletion",
          succes: false
        });
    console.log("vendor is :", vendor);

    if (!vendor)
      return res.status(200)
        .json({

          message: "Vendor not found ",
          success: false
        });

    await Vendor.findByIdAndDelete(req.id);


    return res.status(200)
      .json({
        message: "Account deleted success ",
        succes: true
      });
  }
  catch (er) {

    console.log("error is:", er);

    return res.status(500)
      .json({
        message: "Internal server eroor ",
        success: false
      });
  }
}
