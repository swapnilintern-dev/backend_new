import WhatsAppMessage from '../models/WhatsAppMessage.js'; // ध्यान दें: ES Modules में .js लिखना जरूरी है

// 1. GET Request: Meta Webhook Verification
export const verifyWebhook = (req, res) => {
  // आपके द्वारा Meta पर डाला गया सीक्रेट टोकन
//   const VERIFY_TOKEN = "whatsappwebhookdfghertyudvbnr678456efv8i₹12";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN  || "whatsappwebhookdfghertyudvbnr678456efv8i₹12"

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge); // Meta को challenge वापस भेजना जरूरी है
    } else {
      return res.sendStatus(403); // अगर टोकन मैच नहीं हुआ
    }
  }
  return res.sendStatus(400);
};

// 2. POST Request: Incoming Messages handling from Meta
export const receiveMessage = async (req, res) => {
  try {
    const body = req.body;

    // चेक करें कि यह व्हाट्सएप का ही इवेंट ऑब्जेक्ट है
    if (body.object === 'whatsapp_business_account') {
      if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        
        const messageData = body.entry[0].changes[0].value.messages[0];
        const from = messageData.from; // ग्राहक का नंबर
        const wamid = messageData.id; // मैसेज की यूनिक ID
        const type = messageData.type; // मैसेज का टाइप

        let textBody = '';
        if (type === 'text') {
          textBody = messageData.text.body;
        }

        // डेटाबेस में मैसेज सेव करना
        const newMessage = new WhatsAppMessage({
          from,
          wamid,
          messageType: type,
          textBody
        });

        await newMessage.save();
        console.log(`New message saved from ${from}: ${textBody}`);
      }

      // Meta को हमेशा 200 OK रिस्पॉन्स देना जरूरी है, नहीं तो वो एरर मानेगा
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.sendStatus(404);
    }
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).send('Internal Server Error');
  }
};