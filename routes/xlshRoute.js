import XLSX from "xlsx";
import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";

export const exportOrders = async (req, res) => {
    try {

        const all_orders = await order.find()
            .populate("user")
            .populate("orderItems.product");

        const excelData = all_orders.map(item => ({

            OrderId: item._id,
            vendor: item.user?.contact_person_name,
            TotalAmount: item.totalAmount,
            Status: item.orderStatus,
            Date: item.createdAt.toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
            })

        }));

        const workbook = XLSX.utils.book_new();

        const worksheet = XLSX.utils.json_to_sheet(excelData);

        XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            "Order_Summary"
        );

        const buffer = XLSX.write(workbook, {
            type: "buffer",
            bookType: "xlsx"
        });

        res.setHeader(
            "Content-Disposition",
            "attachment; filename=all_vendors.xlsx"
        );

        res.setHeader(

            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        console.log("excel data is :", excelData);
        return res.send(buffer);
    }
    catch (er) {
        console.log(" er is ", er);

        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}

export const all_vendor = async (req, res) => {

    try {

        const get_vendors = await Vendor.find();

        const excelData = get_vendors.map(item => ({

            store_name: item.store_name,
            contact_person_name: item.contact_person_name,
            mobile_no: item.mobile_no,
            full_address: item.full_address
        }));

        const workbook = XLSX.utils.book_new();

        const worksheet = XLSX.utils.json_to_sheet(excelData);


        XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            "All_vendors"
        );

        const buffer = XLSX.write(workbook, {

            type: "buffer",
            bookType: "xlsx"
        });


        res.setHeader(
            "Content-Disposition",
            "attachment; filename=all_vendors.xlsx"
        );

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        console.log("excel data is :" , excelData ) ;

        return res.send(buffer);


    }
    catch (er) {
        console.log("er is :", er);
        return res.status(500)
            .json({
                message: "Internal server error ",
                success: false
            });
    }
}