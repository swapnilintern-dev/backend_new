import mongoose  from "mongoose";

const connectDb = async () =>{

    try{

       await mongoose.connect( process.env.MONGO_UR ) ;
       console.log("mongo db connected Succefully !! ") ;
    }

    catch(eroor) {

        console.log(
            "db erro " , eroor 
        ) ;
    }
}

export default connectDb ;