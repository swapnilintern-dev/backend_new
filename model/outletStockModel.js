import mongoose from "mongoose";

const outletStockSchema = new mongoose.Schema({

    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product"
    },
    outlet: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Outlet"
    },
    quantity: {
        type: Number,
        default: 0
    }

});

const outletStock = mongoose.model('outletStock' , outletStockSchema ) ;
export default outletStock ;