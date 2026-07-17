import jwt from "jsonwebtoken";
import Outlet from "../model/outletregistersModel.js";
import outletStock from "../model/outletStockModel.js";
import product from "../model/productModel.js";


const outletRegister = async (req, res) => {
    try {


        console.log("outlet register called ");

        const { outletName, ownerName, mobileNo,
            email, address, city, state, pincode,
            gstNumber, status, password
        } = req.body;

        console.log("req.body is :", req.body);

        if (!outletName || !ownerName || !mobileNo || !email || !address || !city || !state
            || !pincode || !gstNumber || !password
        ) {
            return res.status(400)
                .json({
                    message: "Missing fields ",
                    success: false
                });
        }

        const outlet = await Outlet.create({
            outletName,
            ownerName,
            mobileNo,
            email,
            address,
            city,
            state,
            pincode,
            gstNumber ,
            password

        });

        return res.status(201)
            .json({
                message: "Outlet registered successfully ",
                success: true,
                outlet
            });

    }
    catch (er) {
        console.log("error is :", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
};

export default outletRegister;


export const outlet_login = async (req, res) => {

    try {
        const { mobileNo, password } = req.body;

        if (!mobileNo || !password) {
            return res.status(400)
                .json({
                    message: "Field are missing ",
                    success: false
                });
        }

        const outlet_details = await Outlet.findOne({ mobileNo });

        if (!outlet_details) {
            return res.status(400)
                .json({
                    message: "Data mismatch",
                    success: false
                });
        }

        if (password !== outlet_details.password) {
            return res.status(400)
                .json({
                    message: "Somthing is wrong ",
                    success: false
                });
        }

        // token generate 
        const token = jwt.sign(

            {
                outletId: outlet_details._id,
                role: "outlet"
            },
            process.env.SECRET_KEY,
            { expiresIn: "7d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: "strict"
        });

        // The cookie is httpOnly + sameSite:strict, so the app can't read it
        // on web and has nothing to scope /outlet-products/:id by. Send the
        // token and the outlet itself in the body too — never the password.
        const outlet = outlet_details.toObject();
        delete outlet.password;

        return res.status(200)
            .json({
                message: "Outlet Login success ",
                success: true,
                role: "outlet",
                token,
                outlet
            });
    }
    catch (er) {
        console.log("error is ", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
};


export const addOutletStock = async (req, res) => {
    try {
        const { productId, outletId, quantity } = req.body;

        if (!productId || !outletId || !quantity) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const qty = Number(quantity);

        // A negative qty would ADD to Product.stock below, and a fractional one
        // would corrupt both counters — neither is a real assignment.
        if (!Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({
                success: false,
                message: "Quantity must be a positive whole number"
            });
        }

        const Product = await product.findById(productId);
        const outlet = await Outlet.findById(outletId);

        if (!Product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        if (!outlet) {
            return res.status(404).json({
                success: false,
                message: "Outlet not found"
            });
        }

        // Assigning stock MOVES it out of the global catalog and into the
        // outlet. The check and the deduction apply to the first assignment
        // exactly as they do to a top-up — otherwise the row created below
        // would invent stock the catalog never had.
        if (Product.stock < qty) {
            return res.status(400).json({
                success: false,
                message: "Insufficient stock available"
            });
        }

        const existingStock = await outletStock.findOne({
            product: productId,
            outlet: outletId
        });

        Product.stock -= qty;

        if (existingStock) {

            existingStock.quantity += qty;

            await existingStock.save();
            await Product.save();

            return res.status(200).json({
                success: true,
                message: "Stock updated successfully",
                stock: existingStock
            });
        }

        const stock = await outletStock.create({
            product: productId,
            outlet: outletId,
            quantity: qty
        });

        await Product.save();

        return res.status(201).json({
            success: true,
            message: "Stock added successfully",
            stock
        });

    }
    catch (error) {

        console.log("er is :", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// The outlet directory the marketing head picks from before assigning stock.
// GET /outlets            → every outlet
// GET /outlets?pincode=X  → only that pincode
// Returns an empty array (not a 404) when nothing matches, so the app can show
// "no outlets found" rather than treat it as an error.
export const getOutlets = async (req, res) => {
    try {
        const { pincode } = req.query;

        const filter = {};
        if (pincode) filter.pincode = String(pincode).trim();

        const outlets = await Outlet
            .find(filter)
            .select("-password")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: outlets.length,
            outlets
        });

    } catch (error) {
        console.log("er is :", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

export const getOutletProducts = async (req, res) => {
    try {

        const outletId = req.params.id;

        const stocks = await outletStock
            .find({ outlet: outletId })
            .populate("product");

        console.log("stock is :", outletId);

        return res.status(200).json({
            success: true,
            count: stocks.length,
            products: stocks
        });

    } catch (error) {
        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
}