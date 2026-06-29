import Vendor from "../model/userModel.js";
import cloudinary from "../utils/cloudinary.js";
import getDatauri from "../utils/datauri.js";
import sharp from "sharp";
import multer from "multer";
import jwt from "jsonwebtoken";
import nodmailer from "nodemailer"





export const registerVendor = async (req, res) => {
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


    if (!store_name || !mobile_no || !email) {
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

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: pendingVendor.email,
      subject: "Account Approved",
      html: `
        <h2>Registration Approved</h2>
        <p>Hi , ${pendingVendor.contact_person_name},</p>
<p> Thank you for submitting your application! 🎉

We've successfully received it, and it's currently under review by our team.

No action is required from your side at the moment. We'll notify you via email as soon as your application is approved or if we need any additional information.

Thanks for your patience, and take care! 😊

Best regards,
Team : VS Arogya </p> 
      `
    });

    return res.status(201).json({
      success: true,
      message: "Registration submitted. n",
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

    // if( user.approvalStatus === "Pending" ){
    //   return res.status(403)
    //   .json({

    //     message :"You can't  login ",
    //     success : false 
    //   }) ;
    // }

    // console.log(user);
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

    // token genrate
    const token = jwt.sign(

      { userId: user._id },
      process.env.SECRET_KEY,
      { expiresIn: "1d" }
    );


    // store cookie
    //     res.cookie("token", token, {
    //   httpOnly: true,
    //   maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    //   sameSite: "strict",
    //   secure: process.env.NODE_ENV === "production"
    // });


    res.cookie("token", token, {


      httpOnly: true,
      maxAge: 1 * 24 * 60 * 60 * 1000,
      sameSite: "strict"

    });

    return res.status(201)
      .json({
        message: "Login success ",
        success: true,
        role: user.role
      });

  }
  catch (er) {

    console.log(er, "error is :");
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

