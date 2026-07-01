import jwt from "jsonwebtoken";

const isAuthenticated = async (req, res, next) => {
    try {
        // Accept the JWT from either the cookie (mobile) or the
        // Authorization: Bearer header (web + mobile — the reliable path).
        const bearer = req.headers.authorization;
        const token = req.cookies.token ||
            (bearer && bearer.startsWith("Bearer ") ? bearer.split(" ")[1] : null);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Please login first"
            });
        }

        const decode = jwt.verify(
            token,
            process.env.SECRET_KEY
        );

        req.id = decode.userId;

        // console.log("Cookies:", req.cookies);
        // console.log("Token:", req.cookies.token);

        next();

    } catch (er) {
        console.log(er);

        return res.status(401).json({
            success: false,
            message: "Invalid token"
        });
    }
};

export default isAuthenticated;