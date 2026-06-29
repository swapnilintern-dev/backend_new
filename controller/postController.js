import sharp from "sharp";
import cloudinary from "../utils/cloudinary.js";
import Product from "../model/productModel.js";

const addnewProduct = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      category,
      mrp,
      brand,
      code,
      manufacturer,
      marketedBy,
      stock,
      active,
      packOf,
      hsnCode,
      gstPercent,
      discountPercent,
      lowThreshold,
      prescriptionRequired,
      rating,
      reviewCount,
      badge,
      packInfo,
    } = req.body;

    console.log("Text Data:", req.body);

    const image = req.file;

    console.log("Image:", image);

    // Validation
    if (!image) {
      return res.status(400).json({
        success: false,
        message: "Image is required",
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    if (!price) {
      return res.status(400).json({
        success: false,
        message: "Price is required",
      });
    }

    // Optimize Image
    const optimizedImgBuffer = await sharp(image.buffer)
      .resize({
        width: 800,
        height: 800,
        fit: "inside",
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Buffer -> Data URI
    const fileUri = `data:image/jpeg;base64,${optimizedImgBuffer.toString(
      "base64"
    )}`;

    // Upload to Cloudinary
    const cloudResponse = await cloudinary.uploader.upload(fileUri, {
      folder: "products",
    });

    console.log("Cloudinary Response:", cloudResponse);

    // Multipart sends everything as strings — parse numbers/booleans safely.
    const num = (v, d = undefined) =>
      v === undefined || v === null || v === "" ? d : Number(v);
    const bool = (v, d = false) =>
      v === undefined || v === null || v === "" ? d : v === "true" || v === true;

    // Save Product
    const product = await Product.create({
      title,
      description: description || "",
      price: num(price),
      category,
      mrp: num(mrp),
      brand: brand || "",
      code: code || "",
      manufacturer: manufacturer || "",
      marketedBy: marketedBy || "",
      stock: num(stock, 0),
      active: bool(active, true),
      packOf: num(packOf, 1),
      hsnCode: hsnCode || "",
      gstPercent: num(gstPercent, 0),
      discountPercent: num(discountPercent, 0),
      lowThreshold: num(lowThreshold, 10),
      prescriptionRequired: bool(prescriptionRequired, false),
      rating: num(rating, 4.5),
      reviewCount: num(reviewCount, 0),
      badge: badge || undefined,
      packInfo: packInfo || "",
      image: [
        {
          url: cloudResponse.secure_url,
          publicId: cloudResponse.public_id,
        },
      ],
    });

    return res.status(201).json({
      success: true,
      message: "Product added successfully",
      product,
    });
  } catch (error) {
    console.error("Add Product Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export default addnewProduct;


export const  deleteProduct = async( req, res ) =>{
       
      try{
         
        const product_id = req.params.id ;

        console.log("Product id is : " , product_id ) ;

        const get_product = await Product.findById(product_id) ;
        console.log("product is : " , get_product ) ;


        if( ! get_product ) {
          return res.status(401)
          .json({
            message : " Product not found ",
            success : false
          });
        }

        await Product.findByIdAndDelete(product_id ) ;
        return res.status(201)
        .json({ 
          message :"Product deleted succesfully " ,
          success : true 
        })
      }
      catch(er) {
        console.log(er , " er is")
      }

};


export const getAllProducts =async(req , res ) =>{

    try{
        const products =await Product.find() ;

        if( !products )
          return res.status(401)
        .json({ 
          message :"Product not found ",
          success :false 
        }) ;

        return res.status(200)
        .json({
            message :"all products are fetched successfully ",
            success : true ,
            products
        });


    }
    catch(er){
        console.log(er , " error from fetch all product ") ;
    }
}


// Update an existing product. Updates only the fields that are sent; replaces
// the image only when a new `image` file is uploaded.
export const updateProduct = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await Product.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const b = req.body;
    const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const bool = (v) => (v === undefined || v === null || v === "" ? undefined : v === "true" || v === true);
    const str = (v) => (v === undefined ? undefined : v);

    const setIf = (key, val) => { if (val !== undefined) existing[key] = val; };

    setIf("title", str(b.title));
    setIf("description", str(b.description));
    setIf("category", str(b.category));
    setIf("brand", str(b.brand));
    setIf("code", str(b.code));
    setIf("manufacturer", str(b.manufacturer));
    setIf("marketedBy", str(b.marketedBy));
    setIf("hsnCode", str(b.hsnCode));
    setIf("badge", str(b.badge));
    setIf("packInfo", str(b.packInfo));
    setIf("price", num(b.price));
    setIf("mrp", num(b.mrp));
    setIf("stock", num(b.stock));
    setIf("packOf", num(b.packOf));
    setIf("gstPercent", num(b.gstPercent));
    setIf("discountPercent", num(b.discountPercent));
    setIf("lowThreshold", num(b.lowThreshold));
    setIf("rating", num(b.rating));
    setIf("reviewCount", num(b.reviewCount));
    setIf("active", bool(b.active));
    setIf("prescriptionRequired", bool(b.prescriptionRequired));

    // Optional new image
    if (req.file) {
      const optimized = await sharp(req.file.buffer)
        .resize({ width: 800, height: 800, fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer();
      const uri = `data:image/jpeg;base64,${optimized.toString("base64")}`;
      const cloud = await cloudinary.uploader.upload(uri, { folder: "products" });
      existing.image = [{ url: cloud.secure_url, publicId: cloud.public_id }];
    }

    await existing.save();

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product: existing,
    });
  } catch (error) {
    console.error("Update Product Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}
