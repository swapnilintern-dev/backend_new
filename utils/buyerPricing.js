// =============================================================================
// Buyer pricing tiers — what a vendor actually PAYS per unit.
//
// One product carries one regular (retailer) `price` plus two per-product
// discount percentages set by Marketing:
//
//   retail       → price
//   doctor       → price − drDisPercent %       (Hospital / Clinic buyers)
//   wholeseller  → price − wholesellerPercent % (wholesale buyers)
//
// The tier comes from the vendor's own registration fields (vendor_type /
// shop_type) using EXACTLY the rules the app uses to display prices
// (lib/services/buyer_pricing.dart), so the price shown is the price charged.
//
// Nothing here writes to a product: price, stock and the stored percentages
// are read, never changed.
// =============================================================================

export const TIERS = Object.freeze({
  retail: "retail",
  doctor: "doctor",
  wholeseller: "wholeseller",
});

/** The buyer's tier from their registration fields. Unknown → retail (the
 *  undiscounted price), never a discount the account may not be entitled to. */
export const tierOf = (vendor) => {
  const v = String(vendor?.vendor_type ?? "").toLowerCase();
  const s = String(vendor?.shop_type ?? "").toLowerCase();
  if (v.includes("hospital") || v.includes("clinic") || v.includes("doctor")) {
    return TIERS.doctor;
  }
  if (s.includes("hospital") || s.includes("clinic")) return TIERS.doctor;
  if (s.includes("wholesale") || s.includes("wholeseller") || s.includes("distributor")) {
    return TIERS.wholeseller;
  }
  return TIERS.retail;
};

/** Percentages are stored as strings ("5"); blank / junk / out-of-range → 0. */
const pct = (value) => {
  const n = parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
};

/** The discount % this tier gets on [product]. */
export const discountPercentFor = (product, tier) => {
  if (tier === TIERS.doctor) return pct(product?.drDisPercent);
  if (tier === TIERS.wholeseller) return pct(product?.wholesellerPercent);
  return 0;
};

/** Per-unit price this buyer pays, rounded to paise. Never below 0, never
 *  above the regular price. */
export const unitPriceFor = (product, tier) => {
  const base = Number(product?.price) || 0;
  const off = discountPercentFor(product, tier);
  if (off <= 0) return base;
  const discounted = base * (1 - off / 100);
  return Math.round(Math.min(Math.max(discounted, 0), base) * 100) / 100;
};

/** Rounds a rupee amount to paise (keeps totals free of float dust). */
export const toPaise = (amount) => Math.round((Number(amount) || 0) * 100) / 100;
