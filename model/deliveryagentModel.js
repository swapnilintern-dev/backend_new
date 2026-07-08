import mongoose from "mongoose";

const agentSchema = new mongoose.Schema({
      
      fullName :{
        type:String ,
        required : true 
      },
      email :{
        type:String ,
        required : true 
      },
      mobile:{
        type :Number , 
        required : true ,
      },
      password :{
        type :String ,
      }

});

const Agent = mongoose.model('Agent' , agentSchema ) ;

export default Agent ;