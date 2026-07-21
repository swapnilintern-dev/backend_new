import sharp from "sharp";
import { Readable } from "stream";
import cloudinary from "../utils/cloudinary.js";
import Product from "../model/productModel.js";
import Vendor from "../model/userModel.js";
import { MAX_PRODUCT_IMAGES, MAX_IMAGE_BYTES } from "../middlewares/multer.js";

// Naye saved/share controllers `product` (lowercase) aur `Vendor` reference
// karte hain — pehle ye import hi nahi the → ReferenceError → 500.
// `product` ko imported Product model ka alias bana do (same model).
const product = Product;

// ---------------------------------------------------------------------------
// Media helpers (shared by add + update)
// ---------------------------------------------------------------------------

/// Optimizes an image buffer (resize + JPEG) and uploads it to Cloudinary.
/// Returns the { url, publicId } pair persisted on the product.
async function uploadImageBuffer(buffer) {
  const optimized = await sharp(buffer)
    .resize({ width: 800, height: 800, fit: "inside" })
    .jpeg({ quality: 80 })
    .toBuffer();
  const fileUri = `data:image/jpeg;base64,${optimized.toString("base64")}`;
  const res = await cloudinary.uploader.upload(fileUri, { folder: "products" });
  return { url: res.secure_url, publicId: res.public_id };
}

/// Streams a (potentially large) video buffer to Cloudinary. Streaming avoids
/// building a ~100 MB base64 data-URI in memory the way images do.
function uploadVideoBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "video", folder: "product-videos" },
      (err, res) => {
        if (err) return reject(err);
        resolve({ url: res.secure_url, publicId: res.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

/// Best-effort delete of a Cloudinary asset — used so removed/replaced media
/// never lingers as an orphan. Failures are logged, not fatal.
async function destroyAsset(publicId, resourceType = "image") {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (e) {
    console.warn("Cloudinary destroy failed:", publicId, e.message);
  }
}

/// Collects the image files from a multer.fields() request, accepting both the
/// new `images[]` field and the legacy single `image` field. Rejects any file
/// larger than an image has any business being (a video-sized "image").
function collectImageFiles(req) {
  const files = [
    ...((req.files && req.files.images) || []),
    ...((req.files && req.files.image) || []),
  ];
  for (const f of files) {
    if (f.size > MAX_IMAGE_BYTES) {
      const err = new Error(`Image "${f.originalname}" exceeds 10 MB`);
      err.statusCode = 400;
      throw err;
    }
  }
  return files;
}

/// The single video file from a multer.fields() request, or null.
function firstVideoFile(req) {
  const v = req.files && req.files.video;
  return v && v.length ? v[0] : null;
}

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

    // Media: up to MAX_PRODUCT_IMAGES images (field `images[]`, or the legacy
    // single `image`) + one optional promotional video (field `video`).
    const imageFiles = collectImageFiles(req);
    const videoFile = firstVideoFile(req);

    // Validation
    if (imageFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product image is required",
      });
    }

    if (imageFiles.length > MAX_PRODUCT_IMAGES) {
      return res.status(400).json({
        success: false,
        message: `A product can have at most ${MAX_PRODUCT_IMAGES} images`,
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

    // Upload every image (order preserved) and the video, in parallel.
    const image = await Promise.all(
      imageFiles.map((f) => uploadImageBuffer(f.buffer))
    );
    const video = videoFile ? await uploadVideoBuffer(videoFile.buffer) : undefined;

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
      image, // array of { url, publicId } — first entry is the primary image
      video, // { url, publicId } or undefined
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


export const deleteProduct = async (req, res) => {

  try {

    const product_id = req.params.id;

    console.log("Product id is : ", product_id);

    const get_product = await Product.findById(product_id);
    console.log("product is : ", get_product);


    if (!get_product) {
      return res.status(401)
        .json({
          message: " Product not found ",
          success: false
        });
    }

    // Orphan cleanup: remove the product's images + video from Cloudinary
    // before dropping the document.
    for (const img of get_product.image || []) {
      await destroyAsset(img.publicId, "image");
    }
    if (get_product.video && get_product.video.publicId) {
      await destroyAsset(get_product.video.publicId, "video");
    }

    await Product.findByIdAndDelete(product_id);
    return res.status(201)
      .json({
        message: "Product deleted succesfully ",
        success: true
      })
  }
  catch (er) {
    console.log(er, " er is")
  }

};


export const getAllProducts = async (req, res) => {

  try {
    const products = await Product.find();

    if (!products)
      return res.status(401)
        .json({
          message: "Product not found ",
          success: false
        });

    return res.status(200)
      .json({
        message: "all products are fetched successfully ",
        success: true,
        products
      });


  }
  catch (er) {
    console.log(er, " error from fetch all product ");
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

    // ---- Images ------------------------------------------------------------
    // The client sends `keptImages` — a JSON array of the existing images it
    // wants to keep, in the desired display order — plus any brand-new files in
    // the `images[]` field. We only touch images when the client signals intent
    // (sends keptImages OR uploads new files); a plain field update (e.g. an
    // active-toggle) leaves the media untouched.
    const newImageFiles = collectImageFiles(req);
    const hasKeptField = b.keptImages !== undefined;

    if (hasKeptField || newImageFiles.length > 0) {
      let kept = [];
      if (hasKeptField) {
        let parsed;
        try {
          parsed = JSON.parse(b.keptImages || "[]");
        } catch {
          return res.status(400).json({
            success: false,
            message: "keptImages must be a JSON array",
          });
        }
        const keptIds = new Set(
          (Array.isArray(parsed) ? parsed : [])
            .map((it) => (it && it.publicId ? String(it.publicId) : null))
            .filter(Boolean)
        );
        // Keep the existing sub-docs the client listed, in the ORDER the client
        // gave (supports reordering) — resolved against the DB so a client can't
        // inject arbitrary urls.
        const byId = new Map(
          (existing.image || []).map((img) => [String(img.publicId), img])
        );
        kept = (Array.isArray(parsed) ? parsed : [])
          .map((it) => byId.get(String(it && it.publicId)))
          .filter(Boolean)
          .map((img) => ({ url: img.url, publicId: img.publicId }));
      } else {
        // New files uploaded but no keptImages field → keep all current images.
        kept = (existing.image || []).map((img) => ({
          url: img.url,
          publicId: img.publicId,
        }));
      }

      // Orphan cleanup: delete any existing image the client dropped.
      const keepIds = new Set(kept.map((k) => String(k.publicId)));
      for (const img of existing.image || []) {
        if (!keepIds.has(String(img.publicId))) {
          await destroyAsset(img.publicId, "image");
        }
      }

      // Upload new files (order preserved) and append after the kept ones.
      const uploaded = await Promise.all(
        newImageFiles.map((f) => uploadImageBuffer(f.buffer))
      );
      const finalImages = [...kept, ...uploaded];

      if (finalImages.length === 0) {
        return res.status(400).json({
          success: false,
          message: "A product must keep at least one image",
        });
      }
      if (finalImages.length > MAX_PRODUCT_IMAGES) {
        return res.status(400).json({
          success: false,
          message: `A product can have at most ${MAX_PRODUCT_IMAGES} images`,
        });
      }
      existing.image = finalImages;
    }

    // ---- Video -------------------------------------------------------------
    // removeVideo=true → delete it. A new `video` file → replace it (old one is
    // deleted first). Neither → leave the current video as-is.
    const videoFile = firstVideoFile(req);
    const removeVideo = b.removeVideo === "true" || b.removeVideo === true;
    const currentVideoId = existing.video && existing.video.publicId;

    if (videoFile) {
      if (currentVideoId) await destroyAsset(currentVideoId, "video");
      existing.video = await uploadVideoBuffer(videoFile.buffer);
    } else if (removeVideo) {
      if (currentVideoId) await destroyAsset(currentVideoId, "video");
      existing.video = undefined;
      existing.markModified("video");
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


export const copyUrl = async (req, res) => {
  try {

    const get_product = await product.findById(req.params.id);


    if (!get_product) {

      return res.status(404)
        .json({

          message: "Product not found",
          success: false
        });
    }

    const shareUrl = `https://backend-new-0ady.onrender.com/share-prod/${req.params.id}`;

    return res.status(201)
      .json({

        message: "Product url copied",
        success: true,
        shareUrl
      });
  }
  catch (er) {
    console.log(" er is:", er);

    return res.status(500)
      .json({
        message: "Internal server error ",
        success: false
      });
  }
}



export const saveItem = async( req , res ) =>{

  try{

    const get_user = await Vendor.findById( req.id ) ;

    const get_product = await product.findById( req.params.id ) ;

    // savedProducts ObjectId array hai — string se .includes() hamesha false
    // deta tha (isliye unsave kaam nahi karta tha). .some + .equals se sahi.
    const isSaved = get_user.savedProducts.some(
      (pid) => pid?.equals?.(req.params.id) || pid?.toString() === req.params.id
    );

    if( isSaved ) {

     get_user.savedProducts.pull(req.params.id ) ;
     
     await get_user.save() ;
     
     return res.status(200)
     .json({
      message:"Product Usaved ",
      success: true 
     });
    }

     get_user.savedProducts.push(req.params.id ) ;
     await get_user.save() ;

     return res.status(200)
     .json({

      message:"Product saved ",
      success : true 
     });
  
  }
  catch(er) {

    console.log("er is :" , er ) ;

    return res.status(500)
    .json({
      message:"Internal server error",
      success: false 
    }) ;
  }
}


export const AllsaveItem = async( req , res ) =>{

  try{

    const all_save = await Vendor.findById( req.id )
    .populate("savedProducts");

    console.log(all_save.savedProducts ) ;
    
    return res.status(200)
    .json({ 
      message :"fetched all items ",
      success : true ,
      all_save 
    });
  }
  catch(er) {
    console.log(" er is :" , er ) ;
    return res.status(500)
    .json({
      message:"Internal server error ",
      success : false 
    }) ;
  }
}





