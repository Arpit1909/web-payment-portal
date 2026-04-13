const https = require('https');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

function callTelegramAPI(method, params = {}) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN) return reject(new Error('TELEGRAM_BOT_TOKEN not set'));

        const postData = JSON.stringify(params);
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function kickUser(telegramUserId) {
    if (!CHANNEL_ID) throw new Error('TELEGRAM_CHANNEL_ID not set');
    return callTelegramAPI('banChatMember', {
        chat_id: CHANNEL_ID,
        user_id: parseInt(telegramUserId)
    });
}

async function unbanUser(telegramUserId) {
    if (!CHANNEL_ID) throw new Error('TELEGRAM_CHANNEL_ID not set');
    return callTelegramAPI('unbanChatMember', {
        chat_id: CHANNEL_ID,
        user_id: parseInt(telegramUserId),
        only_if_banned: true
    });
}

async function createInviteLink(expireSeconds = 86400) {
    if (!CHANNEL_ID) throw new Error('TELEGRAM_CHANNEL_ID not set');
    const expireDate = Math.floor(Date.now() / 1000) + expireSeconds;
    return callTelegramAPI('createChatInviteLink', {
        chat_id: CHANNEL_ID,
        member_limit: 1,
        expire_date: expireDate
    });
}

async function sendMessage(chatId, text, replyMarkup = null) {
    const data = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) {
        data.reply_markup = replyMarkup;
    }
    return callTelegramAPI('sendMessage', data);
}

async function postToPublicChannel(text, replyMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!publicChannelId) throw new Error('TELEGRAM_PUBLIC_CHANNEL_ID not set');
    const data = { chat_id: publicChannelId, text, parse_mode: 'HTML' };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendMessage', data);
}

// Send a blurred (spoiler) photo teaser to the public channel
async function sendTeaserPhoto(photoUrl, caption, replyMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!publicChannelId) throw new Error('TELEGRAM_PUBLIC_CHANNEL_ID not set');
    const data = {
        chat_id: publicChannelId,
        photo: photoUrl,
        caption,
        parse_mode: 'HTML',
        has_spoiler: true   // native Telegram blur effect
    };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendPhoto', data);
}

module.exports = {
    kickUser,
    unbanUser,
    createInviteLink,
    sendMessage,
    postToPublicChannel,
    sendTeaserPhoto,
    callTelegramAPI
};
