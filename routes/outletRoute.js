import express from "express";
import outletRegister, {
    addOutletStock,
    addToCart,
    cartSummary,
    getOutlets,
    getOutletOrders,
    getOutletProducts,
    getOutletProfile,
    outletManualOrder,
    outletOrderHistory,
    outlet_login,
} from "../controller/outletController.js";
import {
    outletCreatePaymentLink,
    outletCreateRazorpay,
    outletOrderStatus,
    outletVerifyPayment,
} from "../controller/rolePaymentController.js";
import isAuthenticated from "../middlewares/isAuthenticated.js";

const router = express.Router();

// --- Public (no session yet) ------------------------------------------------
// The marketing head registers an outlet; the outlet then signs in with its
// mobile number + the password set at registration.
router.post("/outlet-register", outletRegister);
router.post("/outlet-login", outlet_login);

// --- Marketing → outlet stock assignment (staff session) --------------------
// The "Select Outlet" screen: pick an outlet in a pincode, then push catalog
// stock into it. `/outlet-stock` is what the app posts; `/outlet-addstock` is
// kept as an alias for backward compatibility.
router.get("/outlets", isAuthenticated, getOutlets);
router.post("/outlet-stock", isAuthenticated, addOutletStock);
router.post("/outlet-addstock", isAuthenticated, addOutletStock);

// --- Outlet role: profile + stock + orders (outlet session) -----------------
// The app reads the outlet's own profile, its assigned stock and its order
// history by outlet id.
router.get("/outlet-profile/:id", isAuthenticated, getOutletProfile);
router.get("/outlet-products/:id", isAuthenticated, getOutletProducts);
router.post("/outlet-allstocks/:id", isAuthenticated, getOutletProducts);
router.get("/outlet-orders/:id", isAuthenticated, getOutletOrders);

// --- Outlet role: payment collection (outlet session; order.outlet-scoped) ---
// On-device checkout: razorpay → (razorpay_flutter sheet) → verify. QR / shared
// link: payment → customer pays on their phone → status poll flips to PAID once
// Razorpay confirms. The client never marks anything paid.
router.post("/outlet/orders/:id/razorpay", isAuthenticated, outletCreateRazorpay);
router.post("/outlet/orders/:id/verify", isAuthenticated, outletVerifyPayment);
router.post("/outlet/orders/:id/payment", isAuthenticated, outletCreatePaymentLink);
router.get("/outlet/orders/:id/status", isAuthenticated, outletOrderStatus);

// --- Outlet role: server-side cart flow (used by the backend dev's own flow) -
router.post("/outlet/add-cart", isAuthenticated, addToCart);
router.get("/outlet/cart-summary", isAuthenticated, cartSummary);
router.post("/outlet/manual-order/:id", isAuthenticated, outletManualOrder);
router.get("/outlet/order-history", isAuthenticated, outletOrderHistory);

export default router;
