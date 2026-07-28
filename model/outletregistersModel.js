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

    cart: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "product"
        },
        quantity: {
          type: Number,
          default: 1
        },

        // Free units for this line (see orderModel.orderItems.freeQty). Copied
        // onto the order line when the outlet places the order, printed in the
        // invoice's FREE GOODS column, never charged for. Defaults to 0.
        freeQty: {
          type: Number,
          default: 0,
          min: 0
        },

        // The batches the user PINNED for this line (manual FEFO override).
        // Passed to the inventory engine at order time, which re-validates them
        // against live availability and auto-fills any remainder FEFO. Empty →
        // pure FEFO, which is how every line behaved before this field existed.
        allocations: [
          {
            batch: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "outletStockBatch"
            },
            batch_number: { type: String },
            quantity: { type: Number }
          }
        ]
      }
    ]
  },
  {
    timestamps: true,
  }
);

const Outlet = mongoose.model("Outlet", outletSchema);

export default Outlet;