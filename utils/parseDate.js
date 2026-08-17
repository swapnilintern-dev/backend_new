// =============================================================================
// Date parsing for CLIENT-SUPPLIED dates (product expiry, batch expiry /
// manufacturing dates).
//
// WHY THIS EXISTS
// `new Date(value)` alone is not enough. Node parses ISO ("2028-12-31") fine,
// but returns Invalid Date for the day-first format every Indian spreadsheet,
// CSV import and pharma label uses ("31-12-2028") — which surfaced as a
// 400 "Invalid expiry date" on perfectly valid input. This module accepts every
// format the app, an Excel/CSV import and a human typist realistically send,
// and normalises them all to the SAME instant so the value stored is identical
// no matter which door it came through.
//
// ACCEPTED
//   • a real Date object (already parsed upstream)
//   • ISO 8601 with time   2028-12-31T00:00:00.000Z, 2028-12-31T05:30:00+05:30
//   • ISO date only        2028-12-31        (also 2028/12/31)
//   • day-first            31-12-2028, 31/12/2028, 31.12.2028
//   • month-first (US)     12/31/2028, 12-31-2028
//   • 2-digit years        31-12-28  → 2028   (00-69 → 2000s, 70-99 → 1900s)
//   • Excel serial numbers 47118     (what a raw .xlsx cell often yields)
//
// DAY-FIRST IS THE DEFAULT when both numbers are ≤ 12 (01-02-2028 = 1 Feb
// 2028), because that is what this project's sheets and users mean. A value
// that can only be month-first (day > 12 in the second slot, e.g. 12/31/2028)
// is still read correctly.
//
// NORMALISATION
// A date-only value becomes UTC midnight — byte-identical to what
// `new Date("2028-12-31")` already produced, so nothing that is already stored
// or already working shifts by a day. A value that carries a time keeps it.
//
// REJECTED
// Anything that isn't one of the above, and any calendar-impossible date
// (31-02-2028, month 13, day 0). Callers get null and answer 400 — no silent
// Invalid Date reaching Mongo, no month/day swapped behind the user's back.
// =============================================================================

/// Excel/Sheets serial dates count days from 1899-12-30 (the 1900 leap bug).
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/// Excel serials we accept: 1990-01-01 (32874) .. 2100-01-01 (73051).
///
/// The window is deliberately narrow. A bare "2028" (someone typing just the
/// year) is also a 4-digit number, and a wide window would silently turn it
/// into 1905-07-20 — a wrong date written to the database with no complaint.
/// Outside this window the value is REJECTED so the caller sees a 400 and fixes
/// the cell. No medicine's manufacturing or expiry date falls outside it.
const EXCEL_SERIAL_MIN = 32874;
const EXCEL_SERIAL_MAX = 73051;

/// Builds a UTC-midnight Date and verifies the calendar actually has that day
/// (JS would silently roll 31 Feb over into March).
const utcDate = (year, month, day) => {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // e.g. 31-02-2028 rolled over → not a real date
  }
  return d;
};

/// 2-digit year → 4-digit, matching the Excel/ISO convention.
const expandYear = (y) => (y >= 100 ? y : y <= 69 ? 2000 + y : 1900 + y);

/**
 * Parses a client-supplied date.
 *
 * @param {*} value raw value from req.body (string | number | Date)
 * @returns {Date|null} a valid Date, or null when the value cannot be trusted
 */
export const parseDateInput = (value) => {
  if (value === undefined || value === null || value === "") return null;

  // Already a Date (or a Mongoose-hydrated one).
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  // Excel serial (number, or the same digits as a string).
  if (typeof value === "number" || /^\d{2,5}(\.\d+)?$/.test(String(value).trim())) {
    const serial = Number(value);
    if (
      Number.isFinite(serial) &&
      serial >= EXCEL_SERIAL_MIN &&
      serial <= EXCEL_SERIAL_MAX
    ) {
      const d = new Date(EXCEL_EPOCH_UTC + Math.round(serial * MS_PER_DAY));
      return isNaN(d.getTime()) ? null : d;
    }
    return null; // a bare number outside the serial range is not a date
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // ---- ISO 8601 with a time component → let the engine handle the offset ----
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // ---- Numeric date, any of the three separators ---------------------------
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(raw);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);

    // Year first: 2028-12-31 / 2028/12/31 (ISO order).
    if (m[1].length === 4) return utcDate(a, b, c);

    // Year last: the first two slots are day/month in some order.
    const year = expandYear(c);
    if (a > 12) return utcDate(year, b, a); // 31-12-2028 → day first, certain
    if (b > 12) return utcDate(year, a, b); // 12/31/2028 → month first, certain
    return utcDate(year, b, a); // ambiguous → day first (project convention)
  }

  // ---- Month-name forms: "31 Dec 2028", "Dec 31, 2028", "31-Dec-2028" ------
  // Handed to the engine, but only when the string really looks like a full
  // date: a month word AND two numbers (day + 4-digit year). That bar matters —
  // `new Date()` happily turns "0" into the year 2000 and "Dec-2028" into
  // 1 Dec 2028, and a month-only expiry silently landing on the 1st would expire
  // the lot ~a month early. Such values are rejected so the sender fixes them.
  const numberGroups = raw.match(/\d+/g) || [];
  if (!/[A-Za-z]/.test(raw) || !/\d{4}/.test(raw) || numberGroups.length < 2) {
    return null;
  }
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  if (/\d{1,2}\s*:\s*\d{2}/.test(raw)) return parsed; // carried a time → keep it
  return utcDate(
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate()
  );
};

/**
 * Same as [parseDateInput] but treats "not supplied" and "unparseable"
 * differently — used by the update paths, where an absent field must be left
 * untouched while a bad one must still be rejected.
 *
 * @returns {{ provided: boolean, date: Date|null }}
 */
export const parseOptionalDateInput = (value) => {
  if (value === undefined || value === null || value === "") {
    return { provided: false, date: null };
  }
  return { provided: true, date: parseDateInput(value) };
};

export default parseDateInput;
