import order from "../model/orderModel.js";
import product from "../model/productModel.js";
// import product from "../model/productModel.js";
import Vendor from "../model/userModel.js" ;

export const placeOrder = async( req , res ) => {

    try{
        const userId = req.id ;

        const {
            address ,
            city ,
            state ,
            pincode ,
            country,
            phoneNo
        } = req.body ;

         
        const user = await Vendor.findById(userId ).populate("cart.product");

        console.log("populated cart is :" , user.cart) ;

        if( !user ) {

            return res.status(401)
            .json({

                message :"invalid User " ,
                success : false 
            }) ;
        }

        if( !user.cart.length === 0 ) {
            return res.status(401)
            .json({ 
                message :"Cart is empty !! Plz add product " ,
                success : false 
            }) ;
        }
        
       const orderItems = user.cart.map( item => ({

        product : item.product._id ,
        quantity : item.quantity ,
        orderPrice : item.product.price 

       })) ;

       const totalAmount = user.cart.reduce( (total , item ) => 

        total + item.product.price * item.quantity , 0 
    )
       
      const Order = await order.create({

        user : userId ,
        orderItems,
        shippingAddress:{
            address,
            city ,
            state ,
            pincode ,
            country ,
            phoneNo 
        },
        totalAmount,
      }) ;

      user.cart =[] ;
      await user.save() ;

       return res.status(201)
        .json({
           message :"Order places successfully ",
           success : true ,
           Order 
        }) ;
        
    }
    catch(er) {
        console.log("error is :" , er ) ;

        return res.status(500)
        .json({

            message :"Internal server error ",
            success : false 
        }) ;
    }
}

export default placeOrder ;


export const getOrders = async( req, res ) =>{

  try{
        
        const userId  = req.id ;
         
        const orders = await order.find({
            user :userId
        }).populate("orderItems.product") ;

        return res.status(201)
        .json({ 
            message :"all orderes are here ",
            success : true ,
            orders : orders

        });
    }
    catch(er) {

        console.log("error is :" , er ) ;

        return res.status(500)
        .json({

            message :"Internal server error ",
            success : false 
        });
    }
}

export const placeSingleOrder = async(req , res ) =>{

    try{

        const userId = req.id ;
        const product_id = req.params.id ;


        const { address , city, state , pincode , country , phoneNo  } = req.body ;

        const Product = await product.findById(product_id ) ;

        if( !Product ) 
            return res.status( 404 )
            .json({

                message :"Product not found ",
                success : false 
            }) ;
        

       if( !userId )
        return res.status(401)
        .json({ 
            message :"Invalid user",
            success : false 
        });


        const orderItems = [{
               
            product : Product._id ,
            quantity : 1 ,
            orderPrice : Product.price 

        }];

        // console.log("orderitems array ", orderItems ) ;

        const singleOrder = await order.create({

            user : userId ,
            orderItems ,
            shippingAddress :{
                address,
                city,
                state,
                pincode,
                country,
                phoneNo
            },
            totalAmount : Product.price ,

        });

        // await order.save() ;

        return res.status(200)
        .json({
             message :"Product ordered successfully ",
            success : true ,
            singleOrder 
        });


    }
    catch(er) {

        console.log("error from singleOrder " , er ) ;

        return res.status(500)
        .json({

            message :"Internal server error from singleOrder ",
            success : false 
        })
    }
};