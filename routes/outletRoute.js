import express from "express";
import outletRegister, {
    addOutletStock,
    getOutletOrders,
    getOutletProducts,
    getOutlets,
    outlet_login,
} from "../controller/outletController.js";
import outletRegister, { addOutletStock, addToCart, cartSummary, getOutletProducts, outlet_login, outletManualOrder, outletOrderHistory } from "../controller/outletController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();


router.post("/outlet-register", outletRegister);
router.post("/outlet-login", outlet_login);
router.post("/outlet-addstock", addOutletStock);
router.post("/outlet-allstocks/:id", getOutletProducts);
router.post("/outlet-login", isAuthenticated, outlet_login);
router.post("/outlet-addstock", isAuthenticated, addOutletStock);
router.post("/outlet-allstocks/:id", isAuthenticated, getOutletProducts);
router.post("/outlet/add-cart", isAuthenticated, addToCart);
router.get("/outlet/cart-summary", isAuthenticated, cartSummary);

router.post("/outlet/manual-order/:id", isAuthenticated, outletManualOrder);
router.get("/outlet/order-history", isAuthenticated, outletOrderHistory);

export default router;