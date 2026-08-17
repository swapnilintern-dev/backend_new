// =============================================================================
// Invoice item rows — turns ONE order line into ONE ROW PER BATCH it consumed.
//
// A line can draw from several lots at once: ordering 500 units when the
// nearest-expiry batch only holds 300 makes the FEFO engine take 300 from one
// lot and 200 from the next. The invoice used to print that as a single row
// ("B1 + B2", qty 500), which hides which stock was actually handed over.
//
// This splits it into a row per lot, each carrying that lot's own batch number,
// expiry and quantity:
//
//     Paracetamol 650 mg Tablet   Batch: B1 | Exp: Jul-2027   qty 300
//     Paracetamol 650 mg Tablet   Batch: B2 | Exp: Dec-2027   qty 200
//
// TOTALS ARE UNAFFECTED. The split only redistributes a line across rows:
// the quantities sum back to the line's quantity and the amounts sum back —
// exactly, see the remainder rule below — to the line's amount. Callers keep
// passing their own gross_total / total_qty / total_item, so every existing
// invoice number stays what it was.
// =============================================================================

/// Splits one built invoice row across `allocations` (the order line's FEFO
/// snapshot: [{ batch_number, expiry_date, quantity }]).
///
/// Returns the row UNCHANGED, as a single-element array, whenever splitting
/// would be wrong or pointless:
///   • no allocations       → pre-multi-batch order, prints exactly as before
///   • one allocation       → already a single lot, nothing to split
///   • quantities disagree  → the snapshot does not add up to the line (a data
///     anomaly); printing the line as-is is honest, inventing rows is not.
export function splitRowByBatch(row, allocations) {
    const lots = (Array.isArray(allocations) ? allocations : []).filter(
        (a) => a && Number(a.quantity) > 0
    );
    if (lots.length <= 1) return [row];

    const lineQty = Number(row.quantity) || 0;
    const allocated = lots.reduce((sum, a) => sum + Number(a.quantity), 0);
    if (allocated !== lineQty) return [row];

    const lineAmount = Number(row.amount) || 0;
    let spent = 0;

    return lots.map((a, i) => {
        const quantity = Number(a.quantity);

        // Share of the line's amount, pro-rata by quantity — the same unit
        // price the line was billed at, so nothing is re-priced here. The LAST
        // row takes the remainder instead of its own division, which guarantees
        // the rows add up to the line amount to the last paisa no matter how
        // the division rounds.
        const isLast = i === lots.length - 1;
        const amount = isLast ? lineAmount - spent : (lineAmount * quantity) / lineQty;
        spent += amount;

        return {
            ...row,
            batch_no: a.batch_number || row.batch_no || "N/A",
            exp_date: a.expiry_date || row.exp_date || "N/A",
            quantity,
            // Free goods belong to the LINE, not to any one lot — putting them
            // on every row would multiply them. They ride on the first row and
            // the rest print 0, so the FREE GOODS column still totals what was
            // actually given away.
            freeQty: i === 0 ? row.freeQty : 0,
            amount,
        };
    });
}

/// Convenience wrapper for the common `items.map(buildRow)` shape: builds each
/// row with `buildRow(source)` and splits it by `allocationsOf(source)`.
/// `total_item` must still be taken from `sources.length` (the LINE count) —
/// the returned array is rows, and a medicine spanning two lots is two rows but
/// one item.
export function buildInvoiceItems(sources, buildRow, allocationsOf) {
    return sources.flatMap((source, i) =>
        splitRowByBatch(buildRow(source, i), allocationsOf(source, i))
    );
}

/// The ONE definition of an invoice row's product columns.
///
/// Four different order paths build invoices (vendor cart, marketing manual,
/// outlet manual, outlet POS) and each used to spell this mapping out for
/// itself. They drifted: three read the batch off the order's FEFO allocation
/// while the vendor-cart one read `product.batch_no` — the product's
/// FEFO-FRONT MIRROR — so a two-batch order printed one batch and the full
/// quantity. Keeping the mapping here means a path cannot quietly diverge again.
///
/// `product` supplies the descriptive columns; the caller supplies the
/// transaction columns, because only it knows whether they come from a cart
/// line, an order line or a POS snapshot.
export function invoiceRow(product, { quantity, freeQty, price, amount, batch_no, exp_date }) {
    return {
        title: product?.title,
        hsnCode: product?.hsnCode || "N/A",
        mrp: product?.mrp,
        gstPercent: product?.gstPercent,
        disPercent: product?.discountPercent || "N/A",
        // Merged into the single "MFG/Mkt By" column by the template.
        manufacturer: product?.manufacturer || "N/A",
        marketedBy: product?.marketedBy || "N/A",

        // Batch + expiry ACTUALLY SOLD. For a single-lot line this is the
        // order's own snapshot; a multi-lot line has these overwritten per row
        // by splitRowByBatch. The product mirror is only a last-resort fallback
        // for orders placed before the snapshot existed.
        batch_no: batch_no || product?.batch_no || "N/A",
        exp_date: exp_date || product?.exp_date || "N/A",

        quantity,
        freeQty,
        price,
        amount,
    };
}
