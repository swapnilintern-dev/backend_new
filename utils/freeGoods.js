// =============================================================================
// Free goods — the units handed over on an order line at NO charge.
//
// They are recorded per line (cart line → order line) and printed in the
// invoice's FREE GOODS column. They are never priced: every amount, GST slab
// and total on the order is computed from the billed `quantity` alone.
//
// This module holds the one rule every entry point shares, so the controllers
// that accept a free-goods quantity all normalise it identically.
// =============================================================================

/**
 * Turns a client-supplied free-goods quantity into a value safe to store.
 * Anything missing, non-numeric or negative becomes 0; decimals are kept, since
 * some packs are billed in fractional units.
 */
export const normalizeFreeQty = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

export default normalizeFreeQty;
