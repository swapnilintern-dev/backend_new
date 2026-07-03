import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";

export const invoiceGenerate = async( req , res ) =>{


    try{

        const user = await Vendor.findById(req.id ) ;

        const get_order = await order.findById(req.params.id ).populate("orderItems.product") ;

        console.log( "this is user:" ,  user );

        console.log(" this is user's order " , get_order );

        console.log("Products details is :" , get_order.orderItems );

        if( !user ) 
            return res.staus(401)
        .json({

            message :"unauthorized user ",
            success : false 
        }) ;

        if( !get_order ) {

            return res.status(404)
            .json({

                message:"Not valid order ",
                success : false 
            }) ;
        }




        return ;

        
    }

    catch(er) {

        console.log(" er is :" , er ) ;

        return res.status(500)
        .json({ 

            message :"Internal server error ",
            success : false 
        }) ;
    }
}
