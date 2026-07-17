import jwt from "jsonwebtoken";
import product from "../model/productModel.js";
import registerVendor from "../model/userModel.js";

// const cart = async (req, res) => {
//   try {
//     const token = req.cookies.token;

//     if (!token) {
//       return res.status(401).json({
//         success: false,
//         message: "Please login first",
//       });
//     }

//     const decoded = jwt.verify(
//       token,
//       process.env.SECRET_KEY
//     );

//     req.id = decoded.userId;

//     console.log(decoded, "This is decoded");
//     console.log(req.id, "User ID");

//     return res.status(200).json({
//       success: true,
//       userId: req.id,
//     });

//   } catch (error) {
//     return res.status(401).json({
//       success: false,
//       message: "Invalid token",
//     });
//   }
// };

// export default cart;


// add cart logic 
export const addCart = async (req, res) => {
  try {

    const product_id = req.params.id;
    const userId = req.id;

    console.log(product_id, "product id is:");
    console.log(userId, "user id is:");

    const get_product = await product.findById(product_id);
    const user = await registerVendor.findById(userId);

    if (!get_product) {
      return res.status(404)
        .json({ message: "Product not found", success: false });
    }
    if (!user) {
      return res.status(404)
        .json({ message: "User not found", success: false });
    }

    const itemIndex = user.cart.findIndex(

      item => item.product.toString() === product_id
    );

    console.log(itemIndex , "itemIndex is :" ) ;

    if (itemIndex > -1) {

      user.cart[itemIndex].quantity += 1;
    }
    else {

      user.cart.push({

        product: product_id,
        quantity: 1
      });

    }
    
    await user.save();
    
    return res.status(201)
      .json({
        message: "Product added successfully ",
        success: true

      });
  }
  catch (er) {
    console.log("error is :", er);
    return res.status(500)
      .json({ message: "Internal server error", success: false });
  }
}

export const getCart = async(req, res ) =>{

  try{

    const userId = req.id ;

    const user = await registerVendor.findById(userId).populate("cart.product") ;

    if( ! user ){
      return res.status(400)
      .json({ 
        message :"User not found ",
        success : false 
      });
    }

    console.log("cart len check ", user.cart.length ) ;
    let totalAmount = 0 ;
    for( let i = 0 ; i < user.cart.length ; i++ ){
          
         let amount = user.cart[i].product.price;
         let quality = user.cart[i].quantity ;

         totalAmount += amount*quality ;
    }

    // console.log("total amount is :" , totalAmount ) ;

    return res.status(200)
    .json({ 
      totalAmount,
      success : true ,
      cart : user.cart 
    }) ;
  }
  catch(er){
    console.log("error from " , er ) ;

    return res.status(500)
    .json({

      message :"Internal server error " ,
      success : false 
    })
  }
}

export const removeCartItem = async( req , res ) =>{

  try{

    console.log(" remove controller called ") ;

    const cart_product_id = req.params.id ;
    const userId = req.id ;

    const user = await registerVendor.findById(userId ) ;

   const itemIdx = user.cart.findIndex( 
    item => item.product.toString() === cart_product_id 
   );

   console.log("itemidx is :" , itemIdx ) ;

   if( itemIdx === -1 ){
    return res.status(404)
    .json({
      message :"inValid product",
      success : false 
    }) ;
  }
    
    console.log("item index is :" , itemIdx ) ;

    user.cart.splice(itemIdx  , 1 ) ;
    await user.save() ;

    return res.status(201)
    .json({
      message :"item deleted",
      success : true 
    });
   }
  catch(er){
    console.log("error from remove cart item ", er ) ;
    return res.status(500)
      .json({ message: "Internal server error", success: false });
  }
};

export const increaseItem = async(req , res ) =>{

  try{

    const product_id = req.params.id ;
    const userId = req.id ;


    console.log("increased item called ") ;

    const user = await registerVendor.findById(userId ) ;

    const itemidx = user.cart.findIndex(
      item => item.product.toString() === product_id 
    ) ;
    console.log("itemidx is :" , itemidx ) ;

    if( itemidx == -1 ){
      return res.status(404)
      .json({

        message : "invalid Product ",
        success : false 
      });
    }


    user.cart[itemidx].quantity += 1 ;
    await user.save() ;

    return res.status(201)
    .json({
      message :"Item increased ",
      success : true 
    });
  }
  catch(er) {
    console.log("error from increase Item " , er ) ;

    return res.status(404)
    .json({

      message :"internal server error ",
      success : false 
    }) ;
  }

};
  ``

export const decreaseItem = async(req, res ) =>{

  try{

     const product_id = req.params.id ;
     const userId = req.id ;

     console.log("product id is :" , product_id ) ;

     console.log("data type of product_id is :" , typeof(product_id)) ;

     const user = await registerVendor.findById(userId );

    
    const itemidx = user.cart.findIndex(
      item => item.product.toString() === product_id 

    );

    console.log(itemidx ) ;

    if( itemidx === -1) {
      return res.status(401)
      .json({
        message :"invalid product",
        success : false 
      });
    }
    
    if( user.cart[itemidx].quantity>1 )
    user.cart[itemidx].quantity -= 1;
    
    else{
      return res.status(401)
      .json({ 
        message :"Cart must contain at least one product",
        success : false 
      })
    }
    await user.save() ;

    return res.status(201)
    .json({
      message :"Item decrease",
      success : true  
    });
  }
  catch(er) {
    console.log("error from decrease item " , er ) ;

    return res.status(500)
    .json({

      message :"Internal server error ",
      success : false 

    });
  }
};

export const clearCart = async(req , res ) => {

  try{
    
    const userId = req.id ;

    const user = await registerVendor.findById(userId ) ;

    if( !user ) {
      return res.status(404)
      .json({
        message :"invalid user ",
        success : false 
      });
    }

    console.log("cart length is: befor" ,user.cart.length ) ;


    user.cart.length = 0 ;

    console.log("cart length is:after " ,user.cart.length ) ;
    await user.save() ;

    return res.status(200)
    .json({
      message :"Cart clear",
      success : true 
    });
  }
  catch(er){
    console.log("error from clear Cart ", er ) ;

    return res.status(500)
    .json({
      message :"internal server error ",
      success : false 
    })
  }
};