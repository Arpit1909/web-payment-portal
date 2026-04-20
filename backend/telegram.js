const https = require('https');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_VIP_PLUS_CHANNEL_ID; // VIP+ channel (₹399, photos+videos)
const VIP_ONLY_CHANNEL_ID = process.env.TELEGRAM_VIP_CHANNEL_ID || ''; // VIP channel (₹299, photos only)

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
    if (!CHANNEL_ID) throw new Error('TELEGRAM_VIP_PLUS_CHANNEL_ID not set');
    return callTelegramAPI('banChatMember', {
        chat_id: CHANNEL_ID,
        user_id: parseInt(telegramUserId)
    });
}

async function kickUserFromChannel(channelId, telegramUserId) {
    if (!channelId) throw new Error('Channel ID not set');
    return callTelegramAPI('banChatMember', {
        chat_id: channelId,
        user_id: parseInt(telegramUserId)
    });
}

async function unbanUser(telegramUserId) {
    if (!CHANNEL_ID) throw new Error('TELEGRAM_VIP_PLUS_CHANNEL_ID not set');
    return callTelegramAPI('unbanChatMember', {
        chat_id: CHANNEL_ID,
        user_id: parseInt(telegramUserId),
        only_if_banned: true
    });
}

async function unbanUserFromChannel(channelId, telegramUserId) {
    if (!channelId) throw new Error('Channel ID not set');
    return callTelegramAPI('unbanChatMember', {
        chat_id: channelId,
        user_id: parseInt(telegramUserId),
        only_if_banned: true
    });
}

async function createInviteLink(expireSeconds = 86400) {
    if (!CHANNEL_ID) throw new Error('TELEGRAM_VIP_PLUS_CHANNEL_ID not set');
    const expireDate = Math.floor(Date.now() / 1000) + expireSeconds;
    return callTelegramAPI('createChatInviteLink', {
        chat_id: CHANNEL_ID,
        member_limit: 1,
        expire_date: expireDate
    });
}

async function createInviteLinkForChannel(channelId, expireSeconds = 86400) {
    if (!channelId) throw new Error('Channel ID not set');
    const expireDate = Math.floor(Date.now() / 1000) + expireSeconds;
    return callTelegramAPI('createChatInviteLink', {
        chat_id: channelId,
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

async function deleteMessage(chatId, messageId) {
    return callTelegramAPI('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function createPoll(chatId, question, options) {
    return callTelegramAPI('sendPoll', {
        chat_id: chatId,
        question,
        options,
        is_anonymous: true
    });
}

async function pinMessage(chatId, messageId) {
    return callTelegramAPI('pinChatMessage', {
        chat_id: chatId,
        message_id: messageId,
        disable_notification: false
    });
}

async function unpinMessage(chatId, messageId) {
    return callTelegramAPI('unpinChatMessage', {
        chat_id: chatId,
        message_id: messageId
    });
}

async function postToVipChannel(text, replyMarkup = null) {
    const channelId = process.env.TELEGRAM_VIP_PLUS_CHANNEL_ID;
    if (!channelId) throw new Error('TELEGRAM_VIP_PLUS_CHANNEL_ID not set');
    const data = { chat_id: channelId, text, parse_mode: 'HTML' };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendMessage', data);
}

async function sendPhotoToVipChannel(photoUrl, caption, replyMarkup = null) {
    const channelId = process.env.TELEGRAM_VIP_PLUS_CHANNEL_ID;
    if (!channelId) throw new Error('TELEGRAM_VIP_PLUS_CHANNEL_ID not set');
    const data = { chat_id: channelId, photo: photoUrl, caption, parse_mode: 'HTML' };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendPhoto', data);
}

async function sendVideoToVipChannel(videoUrl, caption, replyMarkup = null) {
    const channelId = process.env.TELEGRAM_VIP_PLUS_CHANNEL_ID;
    if (!channelId) throw new Error('TELEGRAM_VIP_PLUS_CHANNEL_ID not set');
    const data = { chat_id: channelId, video: videoUrl, caption, parse_mode: 'HTML' };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendVideo', data);
}

async function postToPublicChannel(text, replyMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!publicChannelId) throw new Error('TELEGRAM_PUBLIC_CHANNEL_ID not set');
    const data = { chat_id: publicChannelId, text, parse_mode: 'HTML' };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendMessage', data);
}

// Send a permanently blurred photo teaser to the public channel
async function sendTeaserPhoto(photoUrl, caption, replyMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!publicChannelId) throw new Error('TELEGRAM_PUBLIC_CHANNEL_ID not set');
    const data = {
        chat_id: publicChannelId,
        photo: photoUrl,
        caption,
        parse_mode: 'HTML'
    };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendPhoto', data);
}

async function sendVideoToPublicChannel(videoUrl, caption, replyMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!publicChannelId) throw new Error('TELEGRAM_PUBLIC_CHANNEL_ID not set');
    const data = {
        chat_id: publicChannelId,
        video: videoUrl,
        caption,
        parse_mode: 'HTML'
    };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendVideo', data);
}

// VIP-only channel (₹299, photos only)
async function sendPhotoToVipOnlyChannel(photoFileId, caption, replyMarkup = null) {
    if (!VIP_ONLY_CHANNEL_ID) return null;
    const data = { chat_id: VIP_ONLY_CHANNEL_ID, photo: photoFileId, caption, parse_mode: 'HTML' };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendPhoto', data);
}

async function sendTeaserToVipOnlyChannel(photoFileId, caption, replyMarkup = null) {
    if (!VIP_ONLY_CHANNEL_ID) return null;
    const data = { chat_id: VIP_ONLY_CHANNEL_ID, photo: photoFileId, caption, parse_mode: 'HTML', has_spoiler: true };
    if (replyMarkup) data.reply_markup = replyMarkup;
    return callTelegramAPI('sendPhoto', data);
}

// Smart distribution — call these from admin panel when posting content
async function smartDistributePhoto(photoFileId, fullCaption, teaserCaption, upgradeMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    const results = {};

    // Full photo → VIP+ channel (₹399)
    if (CHANNEL_ID) {
        try {
            results.vipPlus = await callTelegramAPI('sendPhoto', { chat_id: CHANNEL_ID, photo: photoFileId, caption: fullCaption, parse_mode: 'HTML' });
        } catch (e) { results.vipPlusErr = e.message; }
    }

    // Full photo → VIP channel (₹299)
    if (VIP_ONLY_CHANNEL_ID) {
        try {
            results.vip = await callTelegramAPI('sendPhoto', { chat_id: VIP_ONLY_CHANNEL_ID, photo: photoFileId, caption: fullCaption, parse_mode: 'HTML' });
        } catch (e) { results.vipErr = e.message; }
    }

    // Blur teaser → public channel
    if (publicChannelId) {
        try {
            const markup = upgradeMarkup || null;
            const d = { chat_id: publicChannelId, photo: photoFileId, caption: teaserCaption, parse_mode: 'HTML', has_spoiler: true };
            if (markup) d.reply_markup = markup;
            results.public = await callTelegramAPI('sendPhoto', d);
        } catch (e) { results.publicErr = e.message; }
    }

    return results;
}

async function smartDistributeVideo(videoFileId, thumbFileId, fullCaption, teaserCaption, upgradeMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    const results = {};

    // Full video → VIP+ channel (₹399) only
    if (CHANNEL_ID) {
        try {
            const d = { chat_id: CHANNEL_ID, video: videoFileId, caption: fullCaption, parse_mode: 'HTML' };
            if (thumbFileId) d.thumbnail = thumbFileId;
            results.vipPlus = await callTelegramAPI('sendVideo', d);
        } catch (e) { results.vipPlusErr = e.message; }
    }

    // Blur photo teaser (using thumbnail or first frame) → VIP channel (₹299)
    if (VIP_ONLY_CHANNEL_ID && thumbFileId) {
        try {
            const markup = upgradeMarkup || null;
            const d = { chat_id: VIP_ONLY_CHANNEL_ID, photo: thumbFileId, caption: teaserCaption, parse_mode: 'HTML', has_spoiler: true };
            if (markup) d.reply_markup = markup;
            results.vip = await callTelegramAPI('sendPhoto', d);
        } catch (e) { results.vipErr = e.message; }
    }

    // Blur photo teaser → public channel
    if (publicChannelId && thumbFileId) {
        try {
            const markup = upgradeMarkup || null;
            const d = { chat_id: publicChannelId, photo: thumbFileId, caption: teaserCaption, parse_mode: 'HTML', has_spoiler: true };
            if (markup) d.reply_markup = markup;
            results.public = await callTelegramAPI('sendPhoto', d);
        } catch (e) { results.publicErr = e.message; }
    }

    return results;
}

module.exports = {
    kickUser,
    kickUserFromChannel,
    unbanUser,
    unbanUserFromChannel,
    createInviteLink,
    createInviteLinkForChannel,
    sendMessage,
    postToPublicChannel,
    postToVipChannel,
    sendPhotoToVipChannel,
    sendVideoToVipChannel,
    sendTeaserPhoto,
    sendVideoToPublicChannel,
    sendPhotoToVipOnlyChannel,
    sendTeaserToVipOnlyChannel,
    smartDistributePhoto,
    smartDistributeVideo,
    deleteMessage,
    createPoll,
    pinMessage,
    unpinMessage,
    callTelegramAPI,
    VIP_ONLY_CHANNEL_ID: () => VIP_ONLY_CHANNEL_ID
};
