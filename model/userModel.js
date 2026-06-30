import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {

    role: {
      type: String,
    },
    vendor_type: {
      type: String,
      required: true,
    },

    shop_type: {
      type: String,
      required: true,
    },

    store_name: {
      type: String,
      required: true,
      trim: true,
    },

    contact_person_name: {
      type: String,
      required: true,
      trim: true,
    },

    mobile_no: {
      type: String,
      required: true,
      unique: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    full_address: {
      type: String,
      required: true,
    },

    city: {
      type: String,
      required: true,
    },

    state: {
      type: String,
      required: true,
    },

    pin_code: {
      type: String,
      required: true,
    },

    gst_status: {
      type: String,
      enum: ["yes", "no"],
      required: true,
    },

    drug_lic_no: {
      type: String,
    },

    drug_lic_ex_date: {
      type: Date,
    },

    password: {
      type: String
      //   required: true,
    },

    gst_pdf: {
      url: String,
      publicId: String,
      fileName: String,
    },

    store_pic: {
      url: String,
      publicId: String,
    },

    drug_lic_copy: {
      url: String,
      publicId: String,
      fileName: String,
    },

    cart: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "product"
        },

        quantity: {
          type: Number,
          default: 1
        }
      }
    ],

    approvalStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending"
    }
  },
  {
    timestamps: true,
  }
);

const Vendor = mongoose.model("Vendor", vendorSchema);
export default Vendor;



// cart: [
//     {
//       product: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Product"
//       },

//       quantity: {
//         type: Number,
//         default: 1
//       }
//     }
//   ]