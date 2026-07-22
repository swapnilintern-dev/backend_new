import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {

    role: {
      type: String,
    },
    vendor_type: {
      type: String,
      // required: true,/
    },

    shop_type: {
      type: String,
      // required: true,
    },

    store_name: {
      type: String,
      // required: true,
      trim: true,
    },

    contact_person_name: {
      type: String,
      // required: true,
      trim: true,
    },

    mobile_no: {
      type: String,
      // required: true,
      unique: true,
    },

    email: {
      type: String,
      // required: true,
      unique: true,
      lowercase: true,
    },

    full_address: {
      type: String,
      // required: true,
    },

    city: {
      type: String,
      // required: true,
    },

    state: {
      type: String,
      // required: true,
    },

    pin_code: {
      type: String,
      // required: true,
    },

    gst_status: {
      type: String,
      enum: ["yes", "no"],
      // required: true,
    },

    drug_lic_no: {
      type: String,
    },

    // GST certificate NUMBER (not a file). Captured as plain text — e.g. by the
    // Outlet Billing registration, which no longer uploads a GST PDF.
    gst_no: {
      type: String,
      trim: true,
    },

    drug_lic_ex_date: {
      type: Date,
    },

    // Where this vendor was registered from:
    //   "admin"  → the normal admin/marketing vendor registration (default; also
    //              the implicit value for pre-existing documents that predate
    //              this field — they are treated as "admin").
    //   "outlet" → created through the Outlet Billing (POS) flow. Only these
    //              show the "Registered by Outlet" badge in the admin portal.
    registrationSource: {
      type: String,
      enum: ["admin", "outlet"],
      default: "admin",
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
    },

    savedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product"
      }
    ],

    // The buyer's saved delivery addresses (customer app address book).
    // CRUD lives in userController (getAddresses / addAddress / updateAddress /
    // deleteAddress) under /vsArogya/addresses.
    addresses: [
      {
        label: { type: String, default: "Home" },
        fullName: { type: String, default: "" },
        phone: { type: String, default: "" },
        line1: { type: String, required: true },
        city: { type: String, default: "" },
        state: { type: String, default: "" },
        pincode: { type: String, default: "" },
        isDefault: { type: Boolean, default: false }
      }
    ],
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