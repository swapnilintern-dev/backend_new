import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Email login OTP.
//
// One short-lived document per sign-in attempt. controller/emailverifyController.js
// deletes any previous codes for the address, writes a fresh one, and emails it;
// verification looks the pair up and deletes it immediately so a code can never
// be replayed.
//
// EXPIRY IS ENFORCED BY MONGO, NOT BY THE APP. The controller's email tells the
// user the code lasts 10 minutes, so the TTL index below is what actually makes
// that true — without it an un-redeemed code would stay valid forever.
// ---------------------------------------------------------------------------
const emailOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    otp: {
      type: String,
      required: true,
      trim: true,
    },

    // How many times this code has been submitted. Guards against someone
    // brute-forcing a 6-digit code: the controller refuses the record once this
    // passes MAX_OTP_ATTEMPTS.
    attempts: {
      type: Number,
      default: 0,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      // Mongo removes the document 10 minutes after createdAt. The sweeper runs
      // about once a minute, so a code may survive a few seconds past the
      // deadline — the controller therefore ALSO checks the age itself rather
      // than trusting the index alone.
      expires: 60 * 10,
    },
  },
  { timestamps: false }
);

// Looking a code up is always (email, otp) — index the pair.
emailOtpSchema.index({ email: 1, otp: 1 });

const Eotp = mongoose.model("Eotp", emailOtpSchema);

export default Eotp;
