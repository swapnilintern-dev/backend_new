import mongoose from 'mongoose';

const WhatsAppMessageSchema = new mongoose.Schema({
  from: { type: String, required: true }, // ग्राहक का व्हाट्सएप नंबर
  wamid: { type: String, required: true, unique: true }, // Meta का यूनिक मैसेज ID
  messageType: { type: String, required: true }, // text, image, document आदि
  textBody: { type: String }, // अगर टेक्स्ट मैसेज है तो उसका कंटेंट
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'received' } // received, delivered, read
}, { timestamps: true });

const WhatsAppMessage = mongoose.model('WhatsAppMessage', WhatsAppMessageSchema);
export default WhatsAppMessage;