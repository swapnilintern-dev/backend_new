import Vendor from "../model/userModel.js";

/**
 * Admin can switch a vendor account off (PUT /vsArogya/vendor-status/:id).
 * Login already refuses an inactive vendor, but a token issued BEFORE the
 * switch stays valid for up to a day — so the routes that create an order or
 * start a payment check the live flag too.
 *
 * Chain AFTER isAuthenticated:
 *   router.post("/place-order", isAuthenticated, requireActiveVendor, placeOrder)
 *
 * Staff tokens (admin / marketing / …) pass straight through. Only an explicit
 * `isActive: false` blocks: vendors created before the field existed have no
 * value stored and count as active.
 */

export const INACTIVE_MESSAGE =
    "Your account is inactive. Please contact VS Arogya support.";

export const STAFF_ROLES = ["admin", "marketing", "delivery", "agent", "outlet"];

/** True only for a vendor (not staff) whose account was switched off. */
export const isInactiveVendor = (user) =>
    !!user &&
    !STAFF_ROLES.includes(String(user.role || "").toLowerCase()) &&
    user.isActive === false;

const requireActiveVendor = async (req, res, next) => {
    try {
        const role = String(req.role || "").toLowerCase();
        if (STAFF_ROLES.some((r) => role === r || role.includes(r))) {
            return next();
        }

        const user = await Vendor.findById(req.id).select("role isActive").lean();
        if (isInactiveVendor(user)) {
            return res.status(403).json({
                success: false,
                code: "ACCOUNT_INACTIVE",
                message: INACTIVE_MESSAGE,
            });
        }

        next();
    } catch (error) {
        console.error("requireActiveVendor error:", error?.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export default requireActiveVendor;
