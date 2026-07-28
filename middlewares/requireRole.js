/**
 * Role guard. Chain AFTER isAuthenticated — it reads the `role` claim that
 * login() signs into the JWT, so the caller cannot spoof it from the body.
 *
 * Matching is case-insensitive and substring-based on purpose: accounts in the
 * wild carry both "marketing" and "marketing head", and the sign-in screen
 * already routes on the same loose identifier.
 *
 *   router.post("/x", isAuthenticated, requireRole("marketing"), handler)
 */
const requireRole = (...allowed) => {
  const wanted = allowed.flat().map((r) => String(r).toLowerCase());

  return (req, res, next) => {
    const role = String(req.role || "").toLowerCase();

    if (!role) {
      return res.status(403).json({
        success: false,
        message: "Your session has no role. Please sign in again.",
      });
    }

    const ok = wanted.some((w) => role === w || role.includes(w));
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to perform this action.",
      });
    }

    next();
  };
};

export default requireRole;
