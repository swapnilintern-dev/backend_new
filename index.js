import express, { urlencoded } from "express";
import dotenv  from "dotenv" ;
import cookieParser from "cookie-parser";
import cors from "cors" ;
import connectDb from "./utils/db.js";
import userRouter from "./routes/userRoute.js";
import addProductRouter from "./routes/postRouter.js" ;
import cardRouter from "./routes/cartRoute.js" ;
import orderRouter from "./routes/orderRoute.js" ;
import adminRouter from "./routes/adminRoute.js" ;

const app = express() ;


dotenv.config() ; 
const port = process.env.PORT || 3000 ;



// middlewares 
app.use( express.json()) ;
app.use(cookieParser() ) ;
app.use(urlencoded({ extended: true })) ;

const corsOptions ={

    origin : 'http://localhost:5173',
    credentials : true 
}

app.use(cors(corsOptions)) ;

// all api 
app.use('/vsArogya', userRouter ) ;
app.use('/vsArogya' , addProductRouter ) ;
app.use('/vsArogya' , cardRouter  ) ;
app.use('/vsArogya' , orderRouter ) ;
app.use('/vsArogya' , adminRouter ) ;



app.get('/' , (req , res ) =>{
    res.send("<h1> This is from Client side </h1>") ;
})


app.listen(port , () =>{

   
    connectDb() ;
    console.log("Server is working " , port ) ;
})