import mongoose from "mongoose";

const cartSchema = new mongoose.Schema({
      
    user: {
        type : mongoose.Schema.Types.ObjectId,
        ref:"User",
        required: true 
    },
    items :{
        type: mongoose.Schema.Types.ObjectId ,
        ref :"product",
        required : true 
    } ,

    quantity:{

        type : Number,
        default:1,
    }
     
});

const cart = mongoose.model('cart' , cartSchema ) ;

export default cart ;
