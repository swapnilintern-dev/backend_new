import express from "express";
// import  register, { login, logout }  from "../controller/userController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";
import {
  addAddress,
  deleteAccount,
  deleteAddress,
  getAddresses,
  login,
  logout,
  registerVendor,
  updateAddress,
} from "../controller/userController.js";
import upload from "../middlewares/multer.js";




const router = express.Router();

// router.route('/register').post( register ) ;
router.route('/login').post(login);
router.route('/logout').post(isAuthenticated, logout); // make sure your route call

router.post(
  "/register-vendor",
  upload.fields([
    { name: "gst_pdf", maxCount: 1 },
    { name: "store_pic", maxCount: 1 },
    { name: "drug_lic_copy", maxCount: 1 }
  ]),
  registerVendor
);

// router.put('/update-password', isAuthenticated, updatePassw);cd 

router.delete('/vendor-delete', isAuthenticated, deleteAccount);

// The buyer's saved delivery addresses (customer app address book).
router.get('/addresses', isAuthenticated, getAddresses);
router.post('/addresses', isAuthenticated, addAddress);
router.put('/addresses/:addressId', isAuthenticated, updateAddress);
router.delete('/addresses/:addressId', isAuthenticated, deleteAddress);

// router.post("/login", login ) ;
// router.post("/logout" , logout ) ;



export default router;