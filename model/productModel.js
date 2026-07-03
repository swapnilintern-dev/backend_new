import mongoose from "mongoose";

const productSchema = new mongoose.Schema({

    title:{
        type: String ,
        required : true ,
        trim : true 
    } ,
    description : {
        type : String ,
        default : ""
    },
    price :{
        type : Number ,
        required : true 
    },
    category :{
        type : String ,
        required : true,
        // enum:[ "", "" , ""]
    },
    cold_stored :{
        type :String
    },

    // --- Inventory / display fields (managed by the marketing team) ---
    
    batch_no:String ,
    exp_date :Date,
    mrp: { type: Number },
    brand: { type: String, default: "" },
    code: { type: String, default: "" },
    manufacturer: { type: String, default: "" },
    marketedBy: { type: String, default: "" },
    stock: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    packOf: { type: Number, default: 1 },
    hsnCode: { type: String, default: "" },
    gstPercent: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    lowThreshold: { type: Number, default: 10 },
    prescriptionRequired: { type: Boolean, default: false },
    rating: { type: Number, default: 4.5 },
    reviewCount: { type: Number, default: 0 },
    badge: { type: String },
    packInfo: { type: String, default: "" },
    image:[
        {
            url : String ,
            publicId : String 
        }
    ],
    quantity:{
        type : String ,
        default :"1"
    }

} ,{timestamps: true} ) ;

const product = mongoose.model('product' , productSchema ) ;

export default product ;