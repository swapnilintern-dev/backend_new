import XLSX from "xlsx";
import product from "../model/productModel.js";
import {
    infoFromDetails,
    infoFromProductRow,
    productIdOf,
    productNameOf,
    readDetailSheets,
} from "../utils/medicineInfo.js";

export const bulkUploadProducts = async (req, res) => {
    try {
    
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Excel file is required"
            });
        }


        const workbook = XLSX.read(req.file.buffer, {
            type: "buffer",
            cellDates: true
        });

        const sheetName = workbook.SheetNames[0];

        const worksheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(
            worksheet,
            {
                defval: ""
            }
        );


        if (!rows.length) {
            return res.status(400).json({
                success: false,
                message: "Excel sheet is empty"
            });
        }

        // Optional details sheet(s) in the same workbook — the company's
        // long-format Side-Effects / Precautions / Usage Direction rows. Absent
        // sheets simply yield empty lookups.
        const detailSheets = readDetailSheets(XLSX, workbook, sheetName);

       // Arrays 

        const productsToInsert = [];

        const failedProducts = [];

        // Excel ke andar duplicate batch check
        const excelBatchNumbers = new Set();


        //  PROCESS EACH EXCEL ROW
     

        for (let i = 0; i < rows.length; i++) {

            const row = rows[i];

            // Excel row number
            // Header = row 1
            const excelRow = i + 2;

            // REQUIRED FIELDS
           
            const title = String(
                row["Title"] || ""
            ).trim();

            const category = String(
                row["Category"] || ""
            ).trim();

            const batchNo = String(
                row["Batch No"] || ""
            ).trim();

            const price = Number(
                row["Selling Price"]
            );

            // TITLE VALIDATION       

            if (!title) {

                failedProducts.push({
                    row: excelRow,
                    reason: "Title is required"
                });

                continue;
            }

            // CATEGORY VALIDATION

            if (!category) {

                failedProducts.push({
                    row: excelRow,
                    title,
                    reason: "Category is required"
                });

                continue;
            }

            // BATCH VALIDATION
           

            if (!batchNo) {

                failedProducts.push({
                    row: excelRow,
                    title,
                    reason: "Batch No is required"
                });

                continue;
            }

            // PRICE VALIDATION

            if (isNaN(price)) {

                failedProducts.push({
                    row: excelRow,
                    title,
                    batchNo,
                    reason: "Invalid Selling Price"
                });

                continue;
            }

            // DUPLICATE BATCH IN EXCEL

            if (excelBatchNumbers.has(batchNo)) {

                failedProducts.push({
                    row: excelRow,
                    title,
                    batchNo,
                    reason: "Duplicate Batch No in Excel"
                });

                continue;
            }

            excelBatchNumbers.add(batchNo);

            // IMAGE URL

            let images = [];

            if (row["Image URL"]) {

                const imageUrls = String(
                    row["Image URL"]
                )
                    .split(",")
                    .map(url => url.trim())
                    .filter(url => url !== "");


                // Product schema ke according
                images = imageUrls.map(url => ({
                    url: url,
                    publicId: ""
                }));
            }


            // PRIMARY IMAGE
            // First URL = Primary Image

            const primaryImage =
                images.length > 0
                    ? images[0].url
                    : "";

            // ACTIVE

            let active = true;

            const activeValue = String(
                row["Active"] || ""
            ).toLowerCase();


            if (
                activeValue === "false" ||
                activeValue === "no" ||
                activeValue === "0"
            ) {
                active = false;
            }


            // PRESCRIPTION REQUIRED

            let prescriptionRequired = false;

            const prescriptionValue = String(
                row["Prescription Required"] || ""
            ).toLowerCase();


            if (
                prescriptionValue === "true" ||
                prescriptionValue === "yes" ||
                prescriptionValue === "1"
            ) {
                prescriptionRequired = true;
            }

            // EXPIRY DATE

            let expDate = null;

            if (row["Expiry Date"]) {

                if (
                    row["Expiry Date"] instanceof Date
                ) {

                    expDate = row["Expiry Date"];

                } else {

                    const parsedDate = new Date(
                        row["Expiry Date"]
                    );

                    if (
                        !isNaN(
                            parsedDate.getTime()
                        )
                    ) {
                        expDate = parsedDate;
                    }
                }
            }

            // PRODUCT DATA

            const productData = {

                title,

                description: String(
                    row["Description"] || ""
                ).trim(),


                // Excel Selling Price
                price: price,


                category,


                // Cold stored
                cold_stored: String(
                    row["Cold Stored"] || ""
                ).trim(),

                // INVENTORY
                mrp:
                    Number(row["MRP"]) || 0,

                brand: String(
                    row["Brand"] || ""
                ).trim(),

                code: String(
                    row["Code"] || ""
                ).trim(),

                batch_no: batchNo,

                exp_date: expDate,

                manufacturer: String(
                    row["Manufacturer"] || ""
                ).trim(),

                marketedBy: String(
                    row["Marketed By"] || ""
                ).trim(),

                stock:
                    Number(row["Stock"]) || 0,

                active,

                // PACK

                packOf:
                    Number(row["Pack Of"]) || 1,

                packInfo: String(
                    row["Pack Info"] || ""
                ).trim(),

                // TAX
                hsnCode: String(
                    row["HSN Code"] || ""
                ).trim(),

                gstPercent:
                    Number(row["GST Percent"]) || 0,

                // DISCOUNT

                discountPercent:
                    Number(
                        row["Discount Percent"]
                    ) || 0,


                // Doctor/Distributor Discount
                drDisPercent: String(
                    row["DR_DIS_%"] || "0"
                ).trim(),


                // Wholeseller Discount
                wholesellerPercent: String(
                    row["Wholseller_%"] || "0"
                ).trim(),

                // STOCK THRESHOLD

                lowThreshold:
                    Number(
                        row["Low Threshold"]
                    ) || 10,

                // PRESCRIPTION
                prescriptionRequired,


                // RATING

                rating:
                    Number(row["Rating"]) || 4.5,

                reviewCount:
                    Number(
                        row["Review Count"]
                    ) || 0,


                // IMAGES

                image: images,

                primaryImage,

                // QUANTITY
                // Schema me String hai

                quantity: String(
                    row["Quantity"] || "1"
                ),

                // MEDICINE INFORMATION (display only — never affects price,
                // stock or validation). Read from the product row's own
                // Composition / Use of Product / Storage / … columns, then from
                // any details sheet in the same file (Side-Effects, Precautions,
                // Usage Direction), matched on Product ID, else on the name.
                ...infoFromProductRow(row),
                ...infoFromDetails(
                    detailSheets.byId.get(productIdOf(row)) ||
                    detailSheets.byName.get(productNameOf(row))
                )
            };
            productsToInsert.push(
                productData
            );
        }

        //NO VALID PRODUCTS

        if (!productsToInsert.length) {

            return res.status(400).json({

                success: false,

                message:
                    "No valid products found",

                totalRows:
                    rows.length,

                uploaded: 0,

                failed:
                    failedProducts.length,

                failedProducts
            });
        }

        // CHECK DUPLICATE BATCH IN DATABASE

        const batchNumbers =
            productsToInsert.map(
                product => product.batch_no
            );


        const existingProducts =
            await product.find({
                batch_no: {
                    $in: batchNumbers
                }
            }).select("batch_no");


        const existingBatchNumbers =
            new Set(
                existingProducts.map(
                    product => product.batch_no
                )
            );

        //  REMOVE EXISTING PRODUCTS
        const finalProducts = [];

        for (const product of productsToInsert) {

            if (
                existingBatchNumbers.has(
                    product.batch_no
                )
            ) {

                failedProducts.push({

                    title:
                        product.title,

                    batchNo:
                        product.batch_no,

                    reason:
                        "Batch No already exists in database"
                });

                continue;
            }


            finalProducts.push(product);
        }
        // INSERT PRODUCTS

        let insertedProducts = [];

        if (finalProducts.length > 0) {

            insertedProducts =
                await product.insertMany(
                    finalProducts,
                    {
                        ordered: false
                    }
                );
        }

        // RESPONSE

        return res.status(200).json({

            success: true,

            message:
                "Bulk product upload completed",

            totalRows:
                rows.length,

            uploaded:
                insertedProducts.length,

            failed:
                failedProducts.length,

            failedProducts
        });


    } catch (error) {

        console.error(
            "Bulk Product Upload Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Bulk product upload failed",

            error:
                error.message
        });
    }
};