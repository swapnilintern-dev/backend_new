import express from "express";
import outletRegister, {
    addOutletStock,
    getOutletProducts,
    getOutlets,
    outlet_login,
} from "../controller/outletController.js";

const router = express.Router();

router.post("/outlet-register", outletRegister);
router.post("/outlet-login", outlet_login);

router.get("/outlets", getOutlets);
router.post("/outlet-stock", addOutletStock);
router.get("/outlet-products/:id", getOutletProducts);

export default router;