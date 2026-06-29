import mongoose from "mongoose";

const productSchema = new mongoose.Schema({

    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ""
    },

    price: {
        type: Number,
        required: true
    },
    // MRP / list price (selling price is `price` above)
    mrp: {
        type: Number
    },
    category: {
        type: String,
        required: true,
    },

    // --- Inventory fields (managed by the marketing team) ---
    brand: { type: String, default: "" },
    code: { type: String, default: "" },           // SKU / product code
    manufacturer: { type: String, default: "" },
    marketedBy: { type: String, default: "" },
    stock: { type: Number, default: 0 },
    active: { type: Boolean, default: true },        // visible to customers
    packOf: { type: Number, default: 1 },
    hsnCode: { type: String, default: "" },
    gstPercent: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    lowThreshold: { type: Number, default: 10 },
    prescriptionRequired: { type: Boolean, default: false },

    // --- Customer-facing display fields ---
    rating: { type: Number, default: 4.5 },
    reviewCount: { type: Number, default: 0 },
    badge: { type: String },
    packInfo: { type: String, default: "" },

    image: [
        {
            url: String,
            publicId: String
        }
    ],
    quantity: {
        type: String,
        default: "1"
    }

}, { timestamps: true });

const product = mongoose.model('product', productSchema);

export default product;
