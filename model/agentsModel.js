import mongoose from "mongoose";


const agentSchema = new mongoose.Schema({
    
    name :{
        type :String ,
        required : true ,
    },
    phoneNo :{
        type :Number ,
        required : true 
    },
    pinCode :{
        type : Number ,
        required : true 
    }
    
}) ;

const marketingAgent = mongoose.model('marketingAgent' , agentSchema ) ;

export default marketingAgent ;