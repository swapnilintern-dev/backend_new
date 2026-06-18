import mongoose from "mongoose";

const productSchema = new mongoose.Schema({

    title:{
        type: String ,
        required : true ,
        trim : true 
    } ,
    description : {
        type : String ,
        required : true 
    },

    price :{
        type : Number ,
        required : true 
    },
    // stock:{
    //     type : Number ,
    //     required : true ,
    //     default : 0 
    // } ,
    category :{
        type : String ,
        required : true,
        // enum:[ "", "" , ""]
    },
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