import jwt from "jsonwebtoken";
import product from "../model/productModel.js";
import registerVendor from "../model/userModel.js";

// ---------------------------------------------------------------------------
// Cart stock ceiling.
//
// The cart used to increment with no reference to stock at all, so a vendor
// could sit 13 units of a 10-unit medicine in their cart. Placing that order
// was always refused (placeOrder allocates FEFO and throws
// InsufficientStockError), but only at the very end — after the vendor had
// filled the cart, and with the bad quantity still saved on their account to
// greet them at the next login.
//
// product.stock is the mirror the inventory engine keeps in sync with the sum
// of the product's batches, so it is the right figure to test against here.
// ---------------------------------------------------------------------------

/// True when `quantity` would take the line past what is in stock.
/// A product with no stock figure recorded is treated as UNLIMITED, matching
/// how the app reads a missing stock field — this endpoint must not start
/// refusing medicines that were previously sellable.
const exceedsStock = (get_product, quantity) => {
    const stock = Number(get_product?.stock);
    if (!Number.isFinite(stock)) return false;
    return quantity > stock;
};

/// The 400 the cart endpoints answer with when the ceiling is hit. Wording
/// matches the "Insufficient stock" family already used across the controllers.
const stockRejection = (res, get_product) =>
    res.status(400).json({
        message:
            Number(get_product?.stock) > 0
                ? `Only ${get_product.stock} left in stock`
                : `${get_product?.title || "This product"} is out of stock`,
        success: false,
        stock: Number(get_product?.stock) || 0,
    });

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

      // Refuse rather than silently clamp: the app tracks its own quantity and
      // would drift out of step with a number it never asked for.
      if (exceedsStock(get_product, user.cart[itemIndex].quantity + 1)) {
        return stockRejection(res, get_product);
      }
      user.cart[itemIndex].quantity += 1;
    }
    else {

      if (exceedsStock(get_product, 1)) {
        return stockRejection(res, get_product);
      }

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


    // Same ceiling as add-cart — this is the other way a line grows.
    const get_product = await product.findById(product_id);
    if (exceedsStock(get_product, user.cart[itemidx].quantity + 1)) {
      return stockRejection(res, get_product);
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