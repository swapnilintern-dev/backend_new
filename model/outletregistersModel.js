import mongoose from "mongoose";

const outletSchema = new mongoose.Schema(
  {
    outletName: {
      type: String,
      required: true,
      trim: true,
    },

    ownerName: {
      type: String,
      required: true,
      trim: true,
    },

    mobileNo: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      lowercase: true,
    },
    password: {
      type: String,
    },

    address: {
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

    pincode: {
      type: String,
      required: true,
    },

    gstNumber: {
      type: String,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    role: {
      type: String,
      default: "outlet",
    },
  },
  {
    timestamps: true,
  }
);

const Outlet = mongoose.model("Outlet", outletSchema);

export default Outlet;
