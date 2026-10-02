import multer from "multer";

const upload = multer({

  storage: multer.memoryStorage(),

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only Images and PDFs are allowed"));
    }
  },

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

export default upload;

// ---------------------------------------------------------------------------
// Spreadsheet upload (bulk product import)
//
// The default `upload` above only accepts images and PDFs, so posting an .xlsx
// to it is rejected with "Only Images and PDFs are allowed" — the bulk upload
// route could never succeed. This is a SEPARATE uploader rather than a widened
// filter on `upload`, so no existing image/PDF route starts accepting
// spreadsheets.
//
// memoryStorage because controller/bulkUploadController.js reads req.file.buffer
// directly via XLSX.read(..., { type: "buffer" }).
// ---------------------------------------------------------------------------
const SHEET_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls (and what some browsers send for .csv)
  "text/csv",
  "application/csv",
  // Safari/Windows occasionally send a generic type for a picked .xlsx; the
  // extension check below is what actually decides in that case.
  "application/octet-stream",
];

const SHEET_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export const uploadSheet = multer({
  storage: multer.memoryStorage(),

  fileFilter: (req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    const hasSheetExtension = SHEET_EXTENSIONS.some((ext) => name.endsWith(ext));

    // Require the extension in every case: the MIME list has to include the
    // generic octet-stream to cope with browsers that don't label .xlsx, and on
    // its own that would let any binary through.
    if (hasSheetExtension && SHEET_MIMES.includes(file.mimetype)) {
      return cb(null, true);
    }
    if (hasSheetExtension) {
      // Correct extension but an unexpected MIME — still a spreadsheet as far
      // as the user is concerned, and XLSX.read will reject it if it isn't.
      return cb(null, true);
    }
    return cb(new Error("Only .xlsx, .xls or .csv files are allowed"));
  },

  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB — a catalogue sheet is far smaller
  },
});

// ---------------------------------------------------------------------------
// Product media upload (multiple images + one promotional video)
//
// Used only by the add/update-product routes. Kept separate from the default
// `upload` (10 MB images/PDF) so raising the size ceiling for video doesn't
// affect every other single-image route.
//
// Field layout (multer.fields):
//   images  → up to MAX_PRODUCT_IMAGES image files (jpeg/png/webp)
//   image   → legacy single image field (kept for backward compatibility)
//   video   → at most ONE video file (mp4/mov/mkv/webm)
//
// The 100 MB ceiling covers the largest allowed video. Per-field type checking
// happens in the fileFilter; the controller additionally rejects oversized
// images (a video-sized image is never legitimate).
// ---------------------------------------------------------------------------
export const MAX_PRODUCT_IMAGES = 10;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB (enforced in controller)

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
// mkv is reported as video/x-matroska; some Android pickers send video/mkv.
const VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/x-matroska", // .mkv
  "video/mkv",
  "video/webm",
];

const productMedia = multer({
  storage: multer.memoryStorage(),

  fileFilter: (req, file, cb) => {
    if (file.fieldname === "video") {
      if (VIDEO_MIMES.includes(file.mimetype)) return cb(null, true);
      return cb(new Error("Video must be mp4, mov, mkv or webm"));
    }
    // "images" (new) or "image" (legacy) → must be an image
    if (IMAGE_MIMES.includes(file.mimetype)) return cb(null, true);
    return cb(new Error("Images must be jpg, jpeg, png or webp"));
  },

  limits: {
    fileSize: MAX_VIDEO_BYTES,
    files: MAX_PRODUCT_IMAGES + 2, // images + legacy image + video
  },
});

/// Multer middleware for the product add/update routes.
export const uploadProductMedia = productMedia.fields([
  { name: "images", maxCount: MAX_PRODUCT_IMAGES },
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);