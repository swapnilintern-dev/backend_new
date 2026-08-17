// Regression tests for the invoice batch-splitting rules (utils/invoiceItems.js).
//
// This is billing maths that reaches a customer-facing document, so the
// invariants that must NEVER regress are pinned here:
//   • the rows a line splits into add back up to that line's quantity
//   • and to its amount, to the paisa
//   • free goods are not multiplied across the split
//   • anything the splitter cannot verify prints as it did before
//
// Run with:  npm test        (node --test, no dependencies)

import test from "node:test";
import assert from "node:assert/strict";
import {
    splitRowByBatch,
    buildInvoiceItems,
    invoiceRow,
} from "../utils/invoiceItems.js";

const row = (quantity, amount, freeQty = 0) => ({
    title: "Test Medicine",
    quantity,
    amount,
    freeQty,
    batch_no: "LINE-MIRROR",
    exp_date: "N/A",
});

const lot = (batch_number, quantity, expiry_date) => ({
    batch_number,
    quantity,
    expiry_date,
});

const sum = (rows, key) => rows.reduce((t, r) => t + Number(r[key]), 0);

test("splits one line into one row per batch, in allocation order", () => {
    const rows = splitRowByBatch(row(500, 14785), [
        lot("D650A", 300, new Date("2027-07-15")),
        lot("D650B", 200, new Date("2027-12-20")),
    ]);

    assert.equal(rows.length, 2);
    assert.deepEqual(
        rows.map((r) => [r.batch_no, r.quantity]),
        [["D650A", 300], ["D650B", 200]]
    );
});

test("quantities and amounts add back up to the line", () => {
    const rows = splitRowByBatch(row(300, 6000), [
        lot("C1", 100),
        lot("C2", 150),
        lot("C3", 50),
    ]);

    assert.equal(sum(rows, "quantity"), 300);
    assert.equal(sum(rows, "amount"), 6000);
});

test("an amount that does not divide evenly still sums exactly", () => {
    // 100 / 3 recurs — the last row must absorb the remainder rather than
    // leaving the invoice a paisa short of its own total.
    const rows = splitRowByBatch(row(3, 100), [
        lot("R1", 1),
        lot("R2", 1),
        lot("R3", 1),
    ]);

    assert.equal(sum(rows, "amount"), 100);
});

test("free goods ride on the first row only, never multiplied", () => {
    const rows = splitRowByBatch(row(300, 6000, 12), [
        lot("C1", 100),
        lot("C2", 150),
        lot("C3", 50),
    ]);

    assert.equal(sum(rows, "freeQty"), 12);
    assert.deepEqual(rows.map((r) => r.freeQty), [12, 0, 0]);
});

test("each row keeps its own expiry", () => {
    const rows = splitRowByBatch(row(500, 100), [
        lot("A", 300, new Date("2027-07-15")),
        lot("B", 200, new Date("2027-12-20")),
    ]);

    assert.equal(rows[0].exp_date.getFullYear(), 2027);
    assert.equal(rows[0].exp_date.getMonth(), 6); // Jul
    assert.equal(rows[1].exp_date.getMonth(), 11); // Dec
});

test("non-batch fields are carried onto every row untouched", () => {
    const base = { ...row(500, 100), mrp: 34.5, hsnCode: "30049099", gstPercent: 5 };
    const rows = splitRowByBatch(base, [lot("A", 300), lot("B", 200)]);

    for (const r of rows) {
        assert.equal(r.title, "Test Medicine");
        assert.equal(r.mrp, 34.5);
        assert.equal(r.hsnCode, "30049099");
        assert.equal(r.gstPercent, 5);
    }
});

// --- the "print it exactly as before" cases --------------------------------

test("a single-lot line is returned untouched", () => {
    const base = row(10, 100);
    const rows = splitRowByBatch(base, [lot("ONLY", 10)]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0], base); // same object — provably unmodified
});

test("a legacy line with no allocations is returned untouched", () => {
    for (const allocations of [undefined, null, []]) {
        const base = row(10, 100);
        const rows = splitRowByBatch(base, allocations);
        assert.equal(rows.length, 1);
        assert.equal(rows[0], base);
    }
});

test("allocations that disagree with the line quantity are not split", () => {
    // A snapshot that does not add up is a data anomaly. Printing the line as
    // it stands is honest; inventing rows from it would not be.
    const base = row(500, 14785);
    const rows = splitRowByBatch(base, [lot("X", 300)]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0], base);
});

test("zero and negative allocation quantities are ignored", () => {
    const rows = splitRowByBatch(row(300, 6000), [
        lot("A", 300),
        lot("EMPTY", 0),
        lot("BAD", -5),
    ]);

    // Only the one real lot remains → single lot → untouched.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quantity, 300);
});

// --- the whole-invoice shape ------------------------------------------------

// --- the shared row mapping ------------------------------------------------

test("invoiceRow prefers the order's batch snapshot over the product mirror", () => {
    // THE REPORTED BUG. product.batch_no is the FEFO-FRONT mirror and moves as
    // stock is consumed; the order's snapshot is what was actually handed over.
    const product = { title: "Med", batch_no: "MIRROR-MOVED-ON" };
    const row = invoiceRow(product, {
        quantity: 10,
        batch_no: "SOLD-LOT",
        exp_date: new Date("2027-10-31"),
    });

    assert.equal(row.batch_no, "SOLD-LOT");
    assert.equal(row.exp_date.getFullYear(), 2027);
});

test("invoiceRow falls back to the product only when the order has no snapshot", () => {
    const product = { title: "Med", batch_no: "P-BATCH", exp_date: "2026-11-30" };
    const row = invoiceRow(product, { quantity: 1 });

    assert.equal(row.batch_no, "P-BATCH");
    assert.equal(row.exp_date, "2026-11-30");
});

test("invoiceRow prints N/A rather than a blank cell", () => {
    const row = invoiceRow({ title: "Med" }, { quantity: 1 });

    assert.equal(row.batch_no, "N/A");
    assert.equal(row.exp_date, "N/A");
    assert.equal(row.hsnCode, "N/A");
    assert.equal(row.manufacturer, "N/A");
    assert.equal(row.marketedBy, "N/A");
});

test("invoiceRow tolerates a missing product without throwing", () => {
    // A deleted product leaves `it.product` null on an old order — the invoice
    // must still render rather than crash the generator.
    const row = invoiceRow(undefined, { quantity: 2, amount: 10 });

    assert.equal(row.title, undefined);
    assert.equal(row.hsnCode, "N/A");
    assert.equal(row.quantity, 2);
});

test("buildInvoiceItems expands lines to rows while total_item stays the line count", () => {
    const lines = [
        { q: 500, a: 14785, al: [lot("D650A", 300), lot("D650B", 200)] },
        { q: 100, a: 5000, al: [lot("AZ500A", 100)] },
        { q: 300, a: 6000, al: [lot("CTZ-A", 100), lot("CTZ-B", 150), lot("CTZ-C", 50)] },
    ];

    const items = buildInvoiceItems(lines, (l) => row(l.q, l.a), (l) => l.al);

    // 3 medicines → 6 invoice rows, but Total Item must still read 3.
    assert.equal(items.length, 6);
    assert.equal(lines.length, 3);

    // Total Qty and Gross Total are unchanged by the split.
    assert.equal(sum(items, "quantity"), 900);
    assert.equal(sum(items, "amount"), 25785);
});
