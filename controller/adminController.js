import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";
import nodemailer from "nodemailer";

const approvalneedUser = async (req, res) => {

    try {

        const pendingUser = await Vendor.find({

            approvalStatus: "Pending"
        });

        console.log(" pending user ", pendingUser);

        // Empty list is not an error — let the admin screen show "no requests".
        return res.status(200)
            .json({
                message: "vendor fetched ",
                success: true,
                pendingUser
            });

    }
    catch (er) {
        console.log("error is :", er);
    }
}

export default approvalneedUser;


export const statusApproval = async (req, res) => {

    try {

        const vendorId = req.params.id;

        const pendingVendor = await Vendor.findById(vendorId);

        if (!pendingVendor) {
            return res.status(401)
                .json({
                    message: "unauthorized ",
                    success: false
                });
        }

        pendingVendor.approvalStatus = "Approved";

        await pendingVendor.save();

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL,
                pass: process.env.E_PASS
            }
        });

        try {
            await transporter.sendMail({
                from: process.env.EMAIL,
                to: pendingVendor.email,
                subject: "Account Approved",
                html: `
                <h2>Registration Approved</h2>
        <p>Hello ${pendingVendor.contact_person_name},</p>
        <p>Your account has been approved by the admin. your user id is: ${pendingVendor.mobile_no} & passowrd is: ${pendingVendor.password} ,</p>
        <p>You can now log in to the application.</p>
      `
            });
        } catch (mailErr) {
            console.log("approval email failed:", mailErr?.message);
        }

        return res.status(200)
            .json({
                message: "approval sent success",
                success: true
            });
    }
    catch (er) {
        console.log(er);
    }
}

export const rejectApproval = async (req, res) => {

    try {
        const vendor_id = req.params.id;

        const vendor = await Vendor.findById(vendor_id);

        if (!vendor)
            return res.status(401)
                .json({
                    message: "Vendor not found ",
                    success: false
                });

        vendor.approvalStatus = "Rejected";
        await vendor.save();

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL,
                pass: process.env.E_PASS
            }
        });

        try {
            await transporter.sendMail({
                from: process.env.EMAIL,
                to: vendor.email,
                subject: "Account Rejected",
                html: `
        <h2>Registration Rejected</h2>
        <p>Hello ${vendor.contact_person_name},</p>
        <p>Your account has been rejected by the admin .</p>
      `
            });
        } catch (mailErr) {
            console.log("rejection email failed:", mailErr?.message);
        }

        return res.status(200)
            .json({
                message: "Vendor rejected",
                success: true
            });
    }
    catch (er) {
        console.log("error from reject Approval ", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}

export const getAllOrder = async (req, res) => {

    try {

        const allOrders = await order.find()
            .populate("user")
            .populate("orderItems.product")
            .sort({ createdAt: -1 });

        if (!allOrders) {
            return res.status(401)
                .json({
                    message: "orders not found ",
                    success: false
                });
        }

        return res.status(200)
            .json({

                message: "all orders fetched ",
                success: true,
                allOrders
            });

    }
    catch (er) {

        console.log(" error from get all order ", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}

export const getSingleOrder = async (req, res) => {

    try {

        const single_order_id = req.params.id;

        const single_order = await order.findById(single_order_id).populate("orderItems.product");

        //  console.log( "address of order is :" ,  single_order.orderItems[0] );


        if (!single_order) {

            return res.status(401)
                .json({
                    message: "Order not found ",
                    success: false
                });
        }

        return res.status(200)
            .json({
                message: "fetched success ",
                success: true,
                details: single_order.orderItems[0],
                amount: single_order.totalAmount
            });

    }
    catch (er) {

        console.log("error from single order ", er);

        return res.status(500)
            .json({

                message: "Internal server error ",
                success: false
            });
    }
}

export const confirmOrder = async (req, res) => {

    try {

        const order_id = req.params.id;

        const confirm_order = await order.findById(order_id);

        if (!confirm_order) {
            return res.status(404)
                .json({
                    message: "Order not found ",
                    success: false
                });
        }

        confirm_order.orderStatus = "Confirm Order";

        await confirm_order.save();

        return res.status(200)
            .json({

                message: "order confirmed ",
                success: true
            });

    }
    catch (er) {
        console.log("error from confirm order is :", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}

export const shippedOrder = async (req, res) => {

    try {

        const order_id = req.params.id;

        const order_details = await order.findById(order_id);

        if (!order_details) {
            return res.status(401)
                .json({

                    message: "order not found ",
                    success: false
                });
        }
        order_details.orderStatus = "Shipped";
        await order_details.save();

        return res.status(201)
            .json({

                message: "Order status changed successfylly ",
                success: true,
                status: order_details.orderStatus
            });

    }
    catch (er) {
        console.log("error from update order ", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}


export const outofDelivery = async (req, res) => {

    try {

        const order_id = req.params.id;

        const order_details = await order.findById(order_id);

        if (!order_details)
            return res.status(401)
                .json({
                    message: "Order not found ",
                    success: false
                });

        order_details.orderStatus = "Out for Delivery";
        await order_details.save();

        return res.status(200)
            .json({

                message: "Order out of delivery ",
                success: true
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
}

export const deliveredOrder = async (req, res) => {

    try {

        const order_id = req.params.id;

        const order_details = await order.findById(order_id)

        if (!order_details) {
            return res.status(401)
                .json({
                    message: "Order not found ",
                    success: false
                });
        }

        order_details.orderStatus = "Delivered";
        await order_details.save();

        return res.status(201)
            .json({
                message: "Order deliverd successfully ",
                success: true
            });

    }
    catch (er) {

        console.log("error from delivered order ", er);
        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}

export const getallVendors = async (req, res) => {

    try {

        const all_vendors = await Vendor.find() ;

        if( all_vendors.length == 0 )
            return res.status(402)
        .json({
            message :"Vendors are missing" ,
            success : false 
        });

        return res.status(201)
        .json({
            message :"all vendors are fetched successfully " ,
            success : true ,
            all_vendors  
        }) ;
    }
    catch (er) {

        console.log(" error from allVendor", er);
        return res.status(500)
        .json({

            message :"Internal server error ",
            success : false 
        }) ;

    }
}

export const getAllActiveVendor = async( req , res ) =>{

    try{

         const active_vendor = await Vendor.find({
            approvalStatus : "Approved"
         });


         if( active_vendor.length == 0 )
            return res.status(404)
            .json({
                message :"active vendors are not found ",
                success : false 
            }) ;


         return res.status(200)
         .json({
            message :"active vendors fetched successfully " ,
            success : true ,
            count : active_vendor.length ,
            active_vendor
         });
    }
    catch(er){

        console.log("error from get all acitvevendor " , er ) ;

        return res.status(500)
        .json({
            message :"Internal Server error " ,
            success : false
        });
    }
}

export const totalSell = async(req , res ) =>{

    try{
        const all_orders = await order.aggregate([
            {
                $match :{
                    orderStatus:"Delivered"
                },
            },
            {   $group :{
                    _id:null ,
                    totalRevenue :{ $sum : "$totalAmount" } ,
                    count :{ $sum : 1 }
                }
            }
        ]);

        const totalRevenue = all_orders.length > 0 ? all_orders[0].totalRevenue : 0 ;
        const deliveredCount = all_orders.length > 0 ? all_orders[0].count : 0 ;

        return res.status(200)
        .json({
            message :"Total revenue fetched successfully " ,
            success : true ,
            totalRevenue ,
            deliveredCount ,
            all_orders
        });
        
    }
    catch(er){
        console.log(" error from total sell" , er );
        return res.status(500)
        .json({

            message :"Internal server error " ,
            success : false 
        }) ;
    }
}



