import order from "../model/orderModel.js";
import Vendor from "../model/userModel.js";

export const invoiceGenerate = async (req, res) => {


  try {

    const user = await Vendor.findById(req.id);

    const get_order = await order.findById(req.params.id).populate("orderItems.product");

    console.log("this is user:", user);

    console.log(" this is user's order ", get_order);

    console.log("Products details is :", get_order.orderItems);

    if (!user)
      return res.staus(401)
        .json({

          message: "unauthorized user ",
          success: false
        });

    if (!get_order) {

      return res.status(404)
        .json({

          message: "Not valid order ",
          success: false
        });
    }




    return;


  }

  catch (er) {

    console.log(" er is :", er);

    return res.status(500)
      .json({

        message: "Internal server error ",
        success: false
      });
  }
}

export const previewInv = async (req, res) => {

    try {

        const getOrder = await order.findById(req.params.id).populate("invoice");


        if (!getOrder) {
            return res.status(404).json({
                message: "Order not found",
                success: false
            });
        }

        if (!getOrder.invoice) {
            return res.status(404).json({
                message: "Invoice not found",
                success: false
            });
        }

        return res.redirect(getOrder.invoice.pdfUrl);

    }
    catch (er) {
        console.log(" er is :", er);

        return res.status(500)
            .json({
                message: "Internal server errorlllk ",
                success: false
            });
    }
}






















// import order from "../model/orderModel.js";
// import Vendor from "../model/userModel.js";
// import Order from "../models/order.model.js";
// import { generateInvoiceHTML } from "../templates/invoice/invoiceTemplate.js";

// export const generateInvoice = async (req, res) => {

//     const order = await Order.findById(req.params.orderId);

//     const data = {
//         customerName: order.customerName,
//         invoiceNo: order.invoiceNo,
//         total: order.totalAmount
//     };

//     const html = generateInvoiceHTML(data);

//     res.send(html);
// };