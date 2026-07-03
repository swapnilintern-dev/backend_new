import mongoose, { model } from "mongoose";

const invoiceSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        unique: true
    },

    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "order"
    },

    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor"
    },

    pdfUrl: String,

    subtotal: Number,

    cgst: Number,

    sgst: Number,

    igst: Number,

    grandTotal: Number,

    generatedAt: {
        type: Date,
        default: Date.now
    },

});

const invoice = mongoose.model('invoice' , invoiceSchema ) ;

export default invoice ;