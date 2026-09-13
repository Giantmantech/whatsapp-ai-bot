const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// 1. Keep-alive server for Render's free tier
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("Gianman Tech WhatsApp Bot is Active!")).listen(PORT, () => {
    console.log(`Keep-alive server listening on port ${PORT}`);
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PHONE_NUMBER = process.env.PHONE_NUMBER; // Format: country code + number without + (e.g., 2348012345678)

// 2. Helper function to call Gemini AI
async function askGemini(userMessage) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const systemInstruction = `You are a helpful customer support and sales representative for Gianman Tech. 
Keep answers concise, polite, professional, and well-formatted for WhatsApp. 
If the user wants to book a service or speak with human management, direct them to email hello@gianmantech.online.`;

    const payload = {
        contents: [{
            role: "user",
            parts: [{ text: `${systemInstruction}\n\nClient inquiry: ${userMessage}` }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "Thank you for contacting Gianman Tech! We'll be with you shortly.";
    } catch (err) {
        console.error("Gemini API Error:", err);
        return "Thank you for your message. A representative will get back to you shortly.";
    }
}

// 3. Connect WhatsApp with Pairing Code
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    // If not registered, request 8-digit pairing code
    if (!sock.authState.creds.registered && PHONE_NUMBER) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER.replace(/\D/g, ''));
                console.log("\n==============================================");
                console.log(`YOUR WHATSAPP PAIRING CODE IS: ${code}`);
                console.log("Go to WhatsApp -> Linked Devices -> Link with phone number");
                console.log("==============================================\n");
            } catch (err) {
                console.error("Error requesting pairing code:", err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('SUCCESS: WhatsApp is connected and listening 24/7!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            const from = msg.key.remoteJid;
            if (from.endsWith('@g.us')) continue; // skip group chats

            const incomingText = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!incomingText) continue;

            console.log(`Message from ${from}: ${incomingText}`);
            const reply = await askGemini(incomingText);
            await sock.sendMessage(from, { text: reply });
        }
    });
}

startBot();
