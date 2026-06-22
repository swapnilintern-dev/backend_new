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