import jwt from "jsonwebtoken";

const isAuthenticated = async (req, res, next) => {
    try {
        const token = req.cookies.token;

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