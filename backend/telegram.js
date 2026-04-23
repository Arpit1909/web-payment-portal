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
            const r = await callTelegramAPI('sendPhoto', { chat_id: CHANNEL_ID, photo: photoFileId, caption: fullCaption, parse_mode: 'HTML' });
            if (r && r.ok) results.vipPlus = r;
            else results.vipPlusErr = (r && r.description) || 'unknown error';
        } catch (e) { results.vipPlusErr = e.message; }
    } else {
        results.vipPlusErr = 'TELEGRAM_VIP_PLUS_CHANNEL_ID not set in .env';
    }

    // Full photo → VIP channel (₹299)
    if (VIP_ONLY_CHANNEL_ID) {
        try {
            const r = await callTelegramAPI('sendPhoto', { chat_id: VIP_ONLY_CHANNEL_ID, photo: photoFileId, caption: fullCaption, parse_mode: 'HTML' });
            if (r && r.ok) results.vip = r;
            else results.vipErr = (r && r.description) || 'unknown error';
        } catch (e) { results.vipErr = e.message; }
    } else {
        results.vipErr = 'TELEGRAM_VIP_CHANNEL_ID not set in .env';
    }

    // Blur teaser → public channel
    if (publicChannelId) {
        try {
            const markup = upgradeMarkup || null;
            const d = { chat_id: publicChannelId, photo: photoFileId, caption: teaserCaption, parse_mode: 'HTML', has_spoiler: true };
            if (markup) d.reply_markup = markup;
            const r = await callTelegramAPI('sendPhoto', d);
            if (r && r.ok) results.public = r;
            else results.publicErr = (r && r.description) || 'unknown error';
        } catch (e) { results.publicErr = e.message; }
    } else {
        results.publicErr = 'TELEGRAM_PUBLIC_CHANNEL_ID not set in .env';
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
            const r = await callTelegramAPI('sendVideo', d);
            if (r && r.ok) results.vipPlus = r;
            else results.vipPlusErr = (r && r.description) || 'unknown error';
        } catch (e) { results.vipPlusErr = e.message; }
    } else {
        results.vipPlusErr = 'TELEGRAM_VIP_PLUS_CHANNEL_ID not set in .env';
    }

    // VIP channel (₹299) — photos only; videos skip this channel entirely
    results.vipSkipped = 'VIP channel is photos-only; videos skip this channel';

    // Blur photo teaser → public channel
    if (publicChannelId) {
        if (!thumbFileId) {
            results.publicErr = 'No video thumbnail available for blur teaser';
        } else {
            try {
                const markup = upgradeMarkup || null;
                const d = { chat_id: publicChannelId, photo: thumbFileId, caption: teaserCaption, parse_mode: 'HTML', has_spoiler: true };
                if (markup) d.reply_markup = markup;
                const r = await callTelegramAPI('sendPhoto', d);
                if (r && r.ok) results.public = r;
                else results.publicErr = (r && r.description) || 'unknown error';
            } catch (e) { results.publicErr = e.message; }
        }
    } else {
        results.publicErr = 'TELEGRAM_PUBLIC_CHANNEL_ID not set in .env';
    }

    return results;
}

// Smart distribution for media albums (carousels) — up to 10 items
// items = [{ type: 'photo'|'video', fileId, thumbFileId? }, ...]
async function smartDistributeAlbum(items, fullCaption, teaserCaption, upgradeMarkup = null) {
    const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    const results = {};

    // Build media group for VIP+ — all items full quality
    const vipPlusMedia = items.map((it, idx) => {
        const base = idx === 0 && fullCaption ? { caption: fullCaption, parse_mode: 'HTML' } : {};
        if (it.type === 'video') return { type: 'video', media: it.fileId, ...base };
        return { type: 'photo', media: it.fileId, ...base };
    });

    // Build media group for VIP — photos only, videos are skipped (VIP channel is photos-only)
    const vipItemsOnly = items.filter(it => it.type === 'photo');
    const vipMedia = vipItemsOnly.map((it, idx) => {
        const base = idx === 0 && fullCaption ? { caption: fullCaption, parse_mode: 'HTML' } : {};
        return { type: 'photo', media: it.fileId, ...base };
    });

    // Build media group for Public — all items blurred (spoiler)
    const publicMedia = items.map((it, idx) => {
        const base = idx === 0 && teaserCaption ? { caption: teaserCaption, parse_mode: 'HTML' } : {};
        if (it.type === 'video') {
            if (!it.thumbFileId) return null;
            return { type: 'photo', media: it.thumbFileId, has_spoiler: true, ...base };
        }
        return { type: 'photo', media: it.fileId, has_spoiler: true, ...base };
    }).filter(Boolean);

    // Send to VIP+
    if (CHANNEL_ID) {
        try {
            const r = await callTelegramAPI('sendMediaGroup', { chat_id: CHANNEL_ID, media: vipPlusMedia });
            if (r && r.ok) results.vipPlus = r;
            else results.vipPlusErr = (r && r.description) || 'unknown error';
        } catch (e) { results.vipPlusErr = e.message; }
    } else {
        results.vipPlusErr = 'TELEGRAM_VIP_PLUS_CHANNEL_ID not set';
    }

    // Send to VIP (photos only — videos are skipped entirely)
    if (VIP_ONLY_CHANNEL_ID) {
        if (vipMedia.length === 0) {
            results.vipSkipped = 'Album has no photos (VIP channel is photos-only)';
        } else if (vipMedia.length === 1) {
            // Media groups require 2+ items; send single as regular photo
            try {
                const m = vipMedia[0];
                const d = { chat_id: VIP_ONLY_CHANNEL_ID, photo: m.media, parse_mode: 'HTML' };
                if (m.caption) d.caption = m.caption;
                const r = await callTelegramAPI('sendPhoto', d);
                if (r && r.ok) results.vip = r;
                else results.vipErr = (r && r.description) || 'unknown error';
            } catch (e) { results.vipErr = e.message; }
        } else {
            try {
                const r = await callTelegramAPI('sendMediaGroup', { chat_id: VIP_ONLY_CHANNEL_ID, media: vipMedia });
                if (r && r.ok) results.vip = r;
                else results.vipErr = (r && r.description) || 'unknown error';
            } catch (e) { results.vipErr = e.message; }
        }
    } else {
        results.vipErr = 'TELEGRAM_VIP_CHANNEL_ID not set';
    }

    // Send to Public
    if (publicChannelId) {
        if (publicMedia.length === 0) {
            results.publicErr = 'No items to send (videos had no thumbnails)';
        } else {
            try {
                const r = await callTelegramAPI('sendMediaGroup', { chat_id: publicChannelId, media: publicMedia });
                if (r && r.ok) {
                    results.public = r;
                    // Media groups can't have inline buttons — send a separate message with the upgrade CTA
                    if (upgradeMarkup) {
                        try {
                            await callTelegramAPI('sendMessage', {
                                chat_id: publicChannelId,
                                text: '🔓 <b>Tap below to unlock full content</b>',
                                parse_mode: 'HTML',
                                reply_markup: upgradeMarkup
                            });
                        } catch (_) {}
                    }
                } else {
                    results.publicErr = (r && r.description) || 'unknown error';
                }
            } catch (e) { results.publicErr = e.message; }
        }
    } else {
        results.publicErr = 'TELEGRAM_PUBLIC_CHANNEL_ID not set';
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
    smartDistributeAlbum,
    deleteMessage,
    createPoll,
    pinMessage,
    unpinMessage,
    callTelegramAPI,
    VIP_ONLY_CHANNEL_ID: () => VIP_ONLY_CHANNEL_ID
};
