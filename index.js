import dns from "node:dns";
// Render's network can't reach Gmail SMTP over IPv6 (ENETUNREACH on :465).
// Prefer IPv4 so nodemailer connects. Must run before any DNS lookups.
dns.setDefaultResultOrder("ipv4first");

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
import paymentRouter from "./routes/paymentRoute.js"
import bannerRouter from "./routes/bannerRoute.js" ;
import couponRouter from "./routes/couponRoute.js" ;
import invoiceRouter from "./routes/invoiceRoute.js" ;
import agentRouter from "./routes/deliveryRoute.js" ;
import manualRouter from "./routes/manualRoute.js"
import xlshRouter from "./routes/xlshRoute.js"


const app = express() ;


dotenv.config() ; 
const port = process.env.PORT || 3000 ;



// middlewares 
app.use(cors()) ;
app.use( express.json()) ;
app.use(cookieParser() ) ;
app.use(urlencoded({ extended: true })) ;

const corsOptions ={

    origin : 'http://localhost:50900/',
    credentials : true 
}


// all api 
app.use('/vsArogya', userRouter ) ;
app.use('/vsArogya' , addProductRouter ) ;
app.use('/vsArogya' , cardRouter  ) ;
app.use('/vsArogya' , orderRouter ) ;
app.use('/vsArogya' , adminRouter ) ;
app.use('/vsArogya' , paymentRouter ) ;
app.use('/vsArogya' , bannerRouter ) ;
app.use('/vsArogya' , couponRouter ) ;
app.use('/vsArogya' , invoiceRouter ) ;
app.use('/vsArogya' , agentRouter ) ;
app.use('/vsArogya' , manualRouter ) ;
app.use('/vsArogya', xlshRouter ) ;



app.get('/' , (req , res ) =>{
    res.send("<h1> This is from server side </h1>") ;
})

app.listen(port , () =>{ 
    connectDb() ;
    console.log("Server is working " , port ) ;
})