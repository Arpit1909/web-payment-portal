const supabase = require('./database');
const { callTelegramAPI, kickUser, kickUserFromChannel, sendMessage: _sendMessageRaw, deleteMessage, smartDistributePhoto, smartDistributeVideo, smartDistributeAlbum, createInviteLinkForChannel } = require('./telegram');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_VIP_PLUS_CHANNEL_ID;           // VIP+ channel (₹399, photos+videos)
const VIP_PLUS_CHANNEL_ID = CHANNEL_ID;
const VIP_ONLY_CHANNEL_ID = process.env.TELEGRAM_VIP_CHANNEL_ID || ''; // VIP channel (₹299, photos only)
const PUBLIC_CHANNEL_ID = process.env.TELEGRAM_PUBLIC_CHANNEL_ID || '';
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);

// Wrapped sendMessage: if the recipient is an admin, also track the message
// so it can be auto-deleted after 24h (keeps admin chat clean and formatted)
async function sendMessage(chatId, text, replyMarkup = null) {
    const res = await _sendMessageRaw(chatId, text, replyMarkup);
    try {
        if (ADMIN_IDS.includes(String(chatId)) && res && res.ok && res.result && res.result.message_id) {
            trackAdminMsg(chatId, res.result.message_id);
        }
    } catch (_) {}
    return res;
}

function matchesChannel(chatId, channelId) {
    if (!channelId) return false;
    // Handle @username format — strip @ and compare username
    const clean = (v) => String(v).replace(/^@/, '').toLowerCase();
    return String(chatId) === String(channelId) || clean(chatId) === clean(channelId);
}

let lastUpdateId = 0;
let polling = false;
let cachedBotUsername = process.env.TELEGRAM_BOT_USERNAME || '';

// Tracks welcome message IDs so they can be deleted when a user leaves
// key: `${userId}_${chatId}`, value: messageId
const welcomeMessageIds = new Map();
const pendingPaymentProofUsers = new Map(); // userId -> timestamp
const awaitingQrUploadAdmins = new Set(); // admin userIds
const awaitingSmartPost = new Map(); // adminId -> { type: 'photo'|'video'|'album', fileId, thumbFileId, items? }
const albumBuffer = new Map(); // `${adminId}_${mediaGroupId}` -> { items: [], caption, timer }
const VIP_AMOUNT = 299;       // photos only
const VIP_PLUS_AMOUNT = 399;  // photos + videos
const VIP_SUBSCRIPTION_AMOUNT = VIP_PLUS_AMOUNT; // backward compat

// Persistent store for welcome messages so we can fix their button URLs on restart
const WELCOME_STORE_PATH = path.join(__dirname, 'welcome_msgs.json');
const PAYMENT_STORE_PATH = path.join(__dirname, 'payment_settings.json');
const PENDING_PROOF_PATH = path.join(__dirname, 'pending_proof.json');
const WELCOME_SETTINGS_PATH = path.join(__dirname, 'welcome_settings.json');
const ADMIN_MSGS_PATH = path.join(__dirname, 'admin_msgs.json');
const PAYMENT_VERIFY_PATH = path.join(__dirname, 'payment_verify_msgs.json');

function loadWelcomeStore() {
    try {
        if (fs.existsSync(WELCOME_STORE_PATH)) {
            return JSON.parse(fs.readFileSync(WELCOME_STORE_PATH, 'utf8'));
        }
    } catch (_) {}
    return [];
}

function saveWelcomeStore(entries) {
    try { fs.writeFileSync(WELCOME_STORE_PATH, JSON.stringify(entries)); } catch (_) {}
}

function loadPaymentStore() {
    try {
        if (fs.existsSync(PAYMENT_STORE_PATH)) {
            return JSON.parse(fs.readFileSync(PAYMENT_STORE_PATH, 'utf8'));
        }
    } catch (_) {}
    return { qrFileId: '', qrCaption: '' };
}

function savePaymentStore(data) {
    try { fs.writeFileSync(PAYMENT_STORE_PATH, JSON.stringify(data || {}, null, 2)); } catch (_) {}
}

function loadWelcomeSettings() {
    try {
        if (fs.existsSync(WELCOME_SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(WELCOME_SETTINGS_PATH, 'utf8'));
        }
    } catch (_) {}
    return { vip: true, public: false }; // public off by default
}

function saveWelcomeSettings(data) {
    try { fs.writeFileSync(WELCOME_SETTINGS_PATH, JSON.stringify(data, null, 2)); } catch (_) {}
}

function loadPendingProof() {
    try {
        if (fs.existsSync(PENDING_PROOF_PATH)) {
            return JSON.parse(fs.readFileSync(PENDING_PROOF_PATH, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function savePendingProof(data) {
    try { fs.writeFileSync(PENDING_PROOF_PATH, JSON.stringify(data || {})); } catch (_) {}
}

function addPendingProof(userId, plan = 'vip_plus') {
    const d = loadPendingProof();
    d[String(userId)] = { ts: Date.now(), plan };
    savePendingProof(d);
}

function removePendingProof(userId) {
    const d = loadPendingProof();
    delete d[String(userId)];
    savePendingProof(d);
}

function hasPendingProof(userId) {
    const d = loadPendingProof();
    return !!d[String(userId)];
}

// ——— Track bot messages in admin chats for auto-cleanup after 24h ———
function loadAdminMsgs() {
    try { if (fs.existsSync(ADMIN_MSGS_PATH)) return JSON.parse(fs.readFileSync(ADMIN_MSGS_PATH, 'utf8')); } catch (_) {}
    return [];
}
function saveAdminMsgs(entries) {
    try { fs.writeFileSync(ADMIN_MSGS_PATH, JSON.stringify(entries)); } catch (_) {}
}
function trackAdminMsg(chatId, messageId) {
    if (!chatId || !messageId) return;
    const entries = loadAdminMsgs();
    entries.push({ chatId, messageId, sentAt: Date.now() });
    saveAdminMsgs(entries);
}
async function sendAdminMessage(adminId, text, replyMarkup = null) {
    const res = await sendMessage(adminId, text, replyMarkup);
    if (res && res.ok && res.result) trackAdminMsg(adminId, res.result.message_id);
    return res;
}
async function cleanupOldAdminMessages() {
    const entries = loadAdminMsgs();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const toDelete = entries.filter(e => e.sentAt && e.sentAt < cutoff);
    if (toDelete.length === 0) return;
    let deleted = 0;
    for (const e of toDelete) {
        try { await deleteMessage(e.chatId, e.messageId); deleted++; } catch (_) {}
    }
    const remaining = entries.filter(e => !(e.sentAt && e.sentAt < cutoff));
    saveAdminMsgs(remaining);
    if (deleted > 0) console.log(`[BOT] Cleaned up ${deleted} admin message(s) older than 24h`);
}

// ——— Track payment verification messages so we can delete on approve/reject ———
function loadVerifyMsgs() {
    try { if (fs.existsSync(PAYMENT_VERIFY_PATH)) return JSON.parse(fs.readFileSync(PAYMENT_VERIFY_PATH, 'utf8')); } catch (_) {}
    return {};
}
function saveVerifyMsgs(data) {
    try { fs.writeFileSync(PAYMENT_VERIFY_PATH, JSON.stringify(data)); } catch (_) {}
}
function addVerifyMsg(userId, chatId, messageId) {
    const d = loadVerifyMsgs();
    const key = String(userId);
    if (!d[key]) d[key] = [];
    d[key].push({ chatId, messageId });
    saveVerifyMsgs(d);
}
async function clearVerifyMsgs(userId) {
    const d = loadVerifyMsgs();
    const key = String(userId);
    const entries = d[key] || [];
    for (const e of entries) {
        try { await deleteMessage(e.chatId, e.messageId); } catch (_) {}
    }
    delete d[key];
    saveVerifyMsgs(d);
}

function getPendingProofPlan(userId) {
    const d = loadPendingProof();
    const entry = d[String(userId)];
    if (!entry) return 'vip_plus';
    return typeof entry === 'object' ? (entry.plan || 'vip_plus') : 'vip_plus';
}

function getVipEntryUrl(fallbackUrl = null) {
    const frontendUrl = fallbackUrl || process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const envBotUsername = (process.env.TELEGRAM_BOT_USERNAME || 'manager_keshavs_bot').replace(/^@/, '').trim();
    const botUsername = (cachedBotUsername || envBotUsername || '').replace(/^@/, '').trim();
    return botUsername ? `https://t.me/${botUsername}?start=vip` : frontendUrl;
}

async function sendVipQrFlow(chatId, userId, plan = 'vip_plus') {
    const pay = loadPaymentStore();
    const amount = plan === 'vip' ? VIP_AMOUNT : VIP_PLUS_AMOUNT;
    const planLabel = plan === 'vip' ? 'VIP — Photos Only' : 'VIP+ — Photos + Videos';

    if (!pay.qrFileId) {
        await sendMessage(chatId,
            `💳 VIP payment is currently being configured.\n\nPlease contact support and we will share payment details manually.`,
            { inline_keyboard: [[{ text: '🙋 Contact Support', callback_data: 'contact_support' }]] }
        );
        return;
    }

    const qrCaption = pay.qrCaption && String(pay.qrCaption).trim()
        ? String(pay.qrCaption).trim() + `\n\n💎 <b>Plan:</b> ${planLabel}\n💰 <b>Amount:</b> Rs ${amount}/-`
        : `✨ <b>Complete Your Payment</b> ✨\n\n` +
          `┏━━━━━━━━━━━━━━━┓\n` +
          `💎 <b>Plan:</b> ${planLabel}\n` +
          `💰 <b>Amount:</b> Rs ${amount}/-\n` +
          `┗━━━━━━━━━━━━━━━┛\n\n` +
          `📌 <b>How to activate:</b>\n` +
          `1️⃣ Scan this QR & complete payment of Rs ${amount}/-\n` +
          `2️⃣ Tap <b>Send Payment Screenshot</b>\n` +
          `3️⃣ Share screenshot + UTR for quick verification\n\n` +
          `⚡ <i>Once verified, your access link is shared here ASAP.</i>`;

    await callTelegramAPI('sendPhoto', {
        chat_id: chatId,
        photo: pay.qrFileId,
        caption: qrCaption,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '📤 Send Payment Screenshot', callback_data: 'send_payment_proof' }]]
        }
    });
    addPendingProof(userId, plan);
}

async function sendPlanSelectionMenu(chatId) {
    await sendMessage(chatId,
        `💎 <b>Choose Your Plan</b>\n\n` +
        `📸 <b>VIP — Photos Only</b>\n` +
        `• Exclusive photos every month\n` +
        `• ₹299/month\n\n` +
        `🔥 <b>VIP+ — Photos + Videos</b>\n` +
        `• All exclusive photos\n` +
        `• All exclusive videos\n` +
        `• ₹399/month\n\n` +
        `Select a plan to continue with payment 👇`,
        {
            inline_keyboard: [
                [{ text: '📸 VIP — Photos Only · ₹299/month', callback_data: 'plan_vip' }],
                [{ text: '🔥 VIP+ — Photos + Videos · ₹399/month', callback_data: 'plan_vip_plus' }]
            ]
        }
    );
}

async function sendVipPaymentOption(chatId) {
    await sendPlanSelectionMenu(chatId);
}

function addToWelcomeStore(chatId, messageId, type) {
    const entries = loadWelcomeStore();
    if (!entries.find(e => e.chatId == chatId && e.messageId == messageId)) {
        entries.push({ chatId, messageId, type, sentAt: Date.now() });
        saveWelcomeStore(entries);
    }
}

function removeFromWelcomeStore(chatId, messageId) {
    const entries = loadWelcomeStore().filter(e => !(e.chatId == chatId && e.messageId == messageId));
    saveWelcomeStore(entries);
}

async function cleanupOldWelcomeMessages() {
    const entries = loadWelcomeStore();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    const toDelete = entries.filter(e => e.sentAt && e.sentAt < cutoff);
    if (toDelete.length === 0) return;

    let deleted = 0;
    for (const e of toDelete) {
        try {
            await deleteMessage(e.chatId, e.messageId);
            deleted++;
        } catch (_) {}
    }

    // Remove deleted entries from store
    const remaining = entries.filter(e => !(e.sentAt && e.sentAt < cutoff));
    saveWelcomeStore(remaining);
    if (deleted > 0) console.log(`[BOT] Cleaned up ${deleted} welcome message(s) older than 24h`);
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(String(userId));
}

async function handleNewChatMember(update) {
    const msg = update.chat_member || update.message;
    if (!msg) return;

    let userId, username, firstName, chatId, chatUsername;

    if (update.chat_member) {
        const newMember = update.chat_member.new_chat_member;
        if (!newMember) return;

        // User left or was kicked — delete their welcome message if we have it
        if (newMember.status === 'left' || newMember.status === 'kicked') {
            const leftUserId = newMember.user.id;
            const leftChatId = update.chat_member.chat.id;
            const key = `${leftUserId}_${leftChatId}`;
            const msgId = welcomeMessageIds.get(key);
            if (msgId) {
                try { await deleteMessage(leftChatId, msgId); } catch (_) {}
                welcomeMessageIds.delete(key);
                removeFromWelcomeStore(leftChatId, msgId);
            }
            return;
        }

        userId = newMember.user.id;
        username = newMember.user.username || '';
        firstName = newMember.user.first_name || '';
        chatId = update.chat_member.chat.id;
        chatUsername = update.chat_member.chat.username || '';
    } else if (msg.new_chat_members) {
        for (const member of msg.new_chat_members) {
            if (member.is_bot) continue;
            userId = member.id;
            username = member.username || '';
            firstName = member.first_name || '';
            chatId = msg.chat.id;
            chatUsername = msg.chat.username || '';
        }
    }

    if (!userId) return;

    const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const vipJoinUrl = getVipEntryUrl(frontendUrl);
    const userMention = username ? `@${username}` : `<a href="tg://user?id=${userId}">${firstName || 'New member'}</a>`;

    // --- PUBLIC CHANNEL: send welcome with website link ---
    if (matchesChannel(chatId, PUBLIC_CHANNEL_ID) || matchesChannel(chatUsername, PUBLIC_CHANNEL_ID)) {
        console.log(`[BOT] User @${username || userId} joined public channel`);
        const welcomeSettings = loadWelcomeSettings();
        if (!welcomeSettings.public) return; // welcome messages disabled for public channel
        const botStartUrl = cachedBotUsername ? `https://t.me/${cachedBotUsername}?start=public` : frontendUrl;
        try {
            const res = await sendMessage(chatId,
                `Hi ${userMention}! Welcome to Prachi's Public Channel! 🎉❤️\n\n` +
                `🔔 <b>Start the bot</b> to get notified when:\n` +
                `• New exclusive content drops 🔥\n` +
                `• Special offers & early access go live 💎\n` +
                `• VIP deals are available just for you\n\n` +
                `<i>Tap the button below so you never miss anything! 👇</i>`,
                {
                    inline_keyboard: [
                        [{ text: '🔔 Start Bot — Get Notified', url: botStartUrl }],
                        [{ text: '🔓 Get VIP Access', url: vipJoinUrl }]
                    ]
                }
            );
            if (res.ok && res.result) {
                welcomeMessageIds.set(`${userId}_${chatId}`, res.result.message_id);
                addToWelcomeStore(chatId, res.result.message_id, 'public');
            }
        } catch (e) {
            console.error(`[BOT] Public welcome failed for ${userId}:`, e.message);
        }
        return;
    }

    // --- VIP+ / VIP CHANNEL: verify subscription then send welcome ---
    const isVipPlusChannel = matchesChannel(chatId, VIP_PLUS_CHANNEL_ID) || matchesChannel(chatUsername, VIP_PLUS_CHANNEL_ID);
    const isVipOnlyChannel = VIP_ONLY_CHANNEL_ID && (matchesChannel(chatId, VIP_ONLY_CHANNEL_ID) || matchesChannel(chatUsername, VIP_ONLY_CHANNEL_ID));

    if (!isVipPlusChannel && !isVipOnlyChannel) return;

    // If the join was approved/performed by an admin (native Telegram join request approval),
    // skip subscription check entirely — the admin intentionally let them in.
    const fromId = update.chat_member?.from?.id;
    const adminApproved = fromId && isAdmin(String(fromId));
    if (adminApproved) {
        console.log(`[BOT] Admin ${fromId} approved user ${username || userId} — skipping subscription check`);
        // Fall through to send welcome message below
    } else {

    const now = new Date().toISOString();

    const { data: sub } = await supabase.from('prachi_subscriptions')
        .select('*')
        .or(`telegram_user_id.eq.${userId},telegram_username.eq.${username ? '@'+username : '__no_match__'}`)
        .eq('status', 'active')
        .gt('expires_at', now)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Fallback: also check username without @ prefix (handles inconsistent storage)
    let subByUsername = null;
    if (!sub && username) {
        const { data: fallback } = await supabase.from('prachi_subscriptions')
            .select('*')
            .eq('telegram_username', username)
            .eq('status', 'active')
            .gt('expires_at', now)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
        subByUsername = fallback;
    }

    const activeSub = sub || subByUsername;

    if (!activeSub) {
        console.log(`[BOT] Unverified user joined channel: ${username || userId} — kicking`);
        try {
            if (isVipPlusChannel) await kickUser(userId);
            else if (isVipOnlyChannel) await kickUserFromChannel(VIP_ONLY_CHANNEL_ID, userId);
            await sendMessage(userId,
                '🚫 You do not have an active subscription.\n\nPlease purchase a plan first to access the private channel.',
                { inline_keyboard: [
                    [{ text: '📸 VIP Photos — ₹299', callback_data: 'plan_vip' }],
                    [{ text: '🔥 VIP+ Photos+Videos — ₹399', callback_data: 'plan_vip_plus' }]
                ]}
            );
        } catch (e) {
            console.error(`[BOT] Kick failed for ${userId}:`, e.message);
        }
        return;
    }

    // VIP+ channel requires vip_plus plan; VIP channel accepts any active plan
    if (isVipPlusChannel && activeSub.plan === 'vip') {
        console.log(`[BOT] VIP-only user tried to join VIP+ channel: ${username || userId} — kicking`);
        try {
            await kickUser(userId);
            await sendMessage(userId,
                '🚫 This channel requires the <b>VIP+ (₹399)</b> plan.\n\nYour current plan is VIP Photos (₹299) — upgrade to access photos + videos.',
                { inline_keyboard: [[{ text: '🔥 Upgrade to VIP+ — ₹399', callback_data: 'plan_vip_plus' }]] }
            );
        } catch (e) {
            console.error(`[BOT] VIP+ kick failed for ${userId}:`, e.message);
        }
        return;
    }

    if (!activeSub.telegram_user_id) {
        await supabase.from('prachi_subscriptions').update({ telegram_user_id: String(userId) }).eq('id', activeSub.id);
    }
    console.log(`[BOT] Verified user joined ${isVipPlusChannel ? 'VIP+' : 'VIP'} channel: ${username || userId} (sub #${activeSub.id}, plan: ${activeSub.plan})`);

    } // end of subscription check block (skipped when admin approved)

    // --- WELCOME MESSAGE ---
    const welcomeSettings = loadWelcomeSettings();
    if (!welcomeSettings.vip) return;
    const channelType = isVipPlusChannel ? 'vip_plus' : 'vip';
    const channelLabel = isVipPlusChannel ? 'VIP+ (Photos + Videos)' : 'VIP Photos';
    const botStartUrl = cachedBotUsername ? `https://t.me/${cachedBotUsername}?start=vip` : frontendUrl;
    try {
        const res = await sendMessage(chatId,
            `Hi ${userMention}! Welcome to the exclusive ${channelLabel} channel baby 🔥😘💋\n\n` +
            `⚠️ <b>Important — Start the bot to activate your membership perks:</b>\n` +
            `• ⏰ Renewal reminders before your access expires\n` +
            `• 🔥 Instant alerts when new content drops\n` +
            `• 💌 Personal updates & special surprises\n\n` +
            `<i>Without starting the bot you won't receive any of these. Tap below! 👇</i>`,
            {
                inline_keyboard: [
                    [{ text: '🔔 Start Bot — Activate Perks', url: botStartUrl }]
                ]
            }
        );
        if (res.ok && res.result) {
            welcomeMessageIds.set(`${userId}_${chatId}`, res.result.message_id);
            addToWelcomeStore(chatId, res.result.message_id, channelType);
        }
    } catch (e) {
        console.error(`[BOT] Channel welcome failed for ${userId}:`, e.message);
    }
}

async function handleSupportTicket(message) {
    if (message.chat.type !== 'private') return; // only DM
    const userId = message.from.id;

    if (isAdmin(userId)) {
        if (awaitingQrUploadAdmins.has(String(userId))) {
            const qrPhoto = message.photo && message.photo.length > 0 ? message.photo[message.photo.length - 1] : null;
            const isImageDoc = message.document && String(message.document.mime_type || '').startsWith('image/');
            if (qrPhoto || isImageDoc) {
                const fileId = qrPhoto ? qrPhoto.file_id : message.document.file_id;
                const store = loadPaymentStore();
                store.qrFileId = fileId;
                if (message.caption && message.caption.trim()) {
                    store.qrCaption = message.caption.trim();
                }
                savePaymentStore(store);
                awaitingQrUploadAdmins.delete(String(userId));
                await sendMessage(userId, `✅ QR updated successfully.\n\nUsers clicking "Join VIP" will now receive this QR automatically.`);
                return;
            }
        }

        // Smart content routing — admin sends photo or video to bot for distribution
        const hasPhoto = message.photo && message.photo.length > 0;
        const hasVideo = message.video;
        const isImageDoc = message.document && String(message.document.mime_type || '').startsWith('image/');
        const mediaGroupId = message.media_group_id;

        // ——— Album / carousel: buffer items until all arrive ———
        if (mediaGroupId && (hasPhoto || hasVideo)) {
            const key = `${userId}_${mediaGroupId}`;
            let entry = albumBuffer.get(key);
            if (!entry) {
                entry = { items: [], caption: '', timer: null };
                albumBuffer.set(key, entry);
            }
            if (hasPhoto) {
                entry.items.push({ type: 'photo', fileId: message.photo[message.photo.length - 1].file_id });
            } else if (hasVideo) {
                entry.items.push({
                    type: 'video',
                    fileId: message.video.file_id,
                    thumbFileId: message.video.thumbnail ? message.video.thumbnail.file_id : ''
                });
            }
            if (message.caption) entry.caption = message.caption;

            // Debounce: wait 1.5s after the last item to assume the album is complete
            if (entry.timer) clearTimeout(entry.timer);
            entry.timer = setTimeout(async () => {
                albumBuffer.delete(key);
                const photoCount = entry.items.filter(i => i.type === 'photo').length;
                const videoCount = entry.items.filter(i => i.type === 'video').length;
                awaitingSmartPost.set(String(userId), { type: 'album', items: entry.items, caption: entry.caption });
                await sendMessage(userId,
                    `🖼 <b>Album received — ${entry.items.length} items</b>\n\n` +
                    `📸 Photos: ${photoCount}\n` +
                    `🎬 Videos: ${videoCount}\n` +
                    `<b>Caption:</b> ${entry.caption || '(none)'}\n\n` +
                    `Distribute as a carousel?\n` +
                    `• VIP+ (₹399): Full photos & videos\n` +
                    `• VIP (₹299): Photos only (videos skipped)\n` +
                    `• Public: Blurred teasers`,
                    { inline_keyboard: [
                        [{ text: '🖼 Route as Album', callback_data: 'smart_route_album' }],
                        [{ text: '🚫 Cancel', callback_data: 'smart_cancel' }]
                    ]}
                );
            }, 1500);
            return;
        }

        if (awaitingSmartPost.has(String(userId))) {
            // Admin is confirming or cancelling — handled by callback_query, skip here
        } else if (hasPhoto || isImageDoc) {
            const fileId = hasPhoto ? message.photo[message.photo.length - 1].file_id : message.document.file_id;
            const caption = message.caption || '';
            awaitingSmartPost.set(String(userId), { type: 'photo', fileId, caption });
            await sendMessage(userId,
                `📸 <b>Photo received!</b>\n\n` +
                `<b>Caption:</b> ${caption || '(none)'}\n\n` +
                `How would you like to distribute it?`,
                { inline_keyboard: [
                    [{ text: '📸 Route as Photo (VIP + VIP+ + Public blur)', callback_data: 'smart_route_photo' }],
                    [{ text: '🚫 Cancel', callback_data: 'smart_cancel' }]
                ]}
            );
            return;
        } else if (hasVideo) {
            const fileId = message.video.file_id;
            const thumbFileId = message.video.thumbnail ? message.video.thumbnail.file_id : '';
            const caption = message.caption || '';
            awaitingSmartPost.set(String(userId), { type: 'video', fileId, thumbFileId, caption });
            const thumbWarning = thumbFileId ? '' : '\n\n⚠️ <i>No thumbnail detected — public blur teaser will be skipped.</i>';
            await sendMessage(userId,
                `🎬 <b>Video received!</b>\n\n` +
                `<b>Caption:</b> ${caption || '(none)'}\n\n` +
                `Route as video? VIP+ full · Public blur teaser · VIP (photos-only) skipped.${thumbWarning}`,
                { inline_keyboard: [
                    [{ text: '🎬 Route as Video (VIP+ full · Public blur)', callback_data: 'smart_route_video' }],
                    [{ text: '🚫 Cancel', callback_data: 'smart_cancel' }]
                ]}
            );
            return;
        }

        // Fix old welcome message: admin forwards a channel welcome message to the bot
        const fwdOrigin = message.forward_origin; // new Telegram API
        const fwdChat = (fwdOrigin && fwdOrigin.chat) || message.forward_from_chat;
        const fwdMsgId = (fwdOrigin && fwdOrigin.message_id) || message.forward_from_message_id;

        if (fwdChat && fwdMsgId) {
            const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
            const isVip = matchesChannel(fwdChat.id, CHANNEL_ID) || matchesChannel(fwdChat.username || '', CHANNEL_ID);
            const isPublic = PUBLIC_CHANNEL_ID && (matchesChannel(fwdChat.id, PUBLIC_CHANNEL_ID) || matchesChannel(fwdChat.username || '', PUBLIC_CHANNEL_ID));

            if (isVip || isPublic) {
                const botUrl = cachedBotUsername
                    ? `https://t.me/${cachedBotUsername}?start=${isVip ? 'vip' : 'public'}`
                    : frontendUrl;
                const vipJoinUrl = getVipEntryUrl(frontendUrl);

                const markup = isVip
                    ? { inline_keyboard: [[{ text: '🔔 Start Bot — Activate Perks', url: botUrl }]] }
                    : { inline_keyboard: [
                        [{ text: '🔔 Start Bot — Get Notified', url: botUrl }],
                        [{ text: '🔓 Get VIP Access', url: vipJoinUrl }]
                      ]};

                try {
                    await callTelegramAPI('editMessageReplyMarkup', {
                        chat_id: fwdChat.id,
                        message_id: fwdMsgId,
                        reply_markup: markup
                    });
                    await sendMessage(message.chat.id, `✅ Fixed! Button now links to:\n${botUrl}`);
                } catch (e) {
                    await sendMessage(message.chat.id, `❌ Could not edit: ${e.message}\n\nMake sure you forwarded the exact welcome message from the channel.`);
                }
                return;
            }
        }

        // Allow admin to reply
        const replyOrig = message.reply_to_message;
        if (replyOrig && (replyOrig.text || replyOrig.caption)) {
            const replyText = replyOrig.text || replyOrig.caption || '';
            const ticketMatch = replyText.match(/\[Ticket UserID: (\d+)\]/) || replyText.match(/User ID:\s*(?:<code>)?(\d+)/i);
            if (ticketMatch) {
                const targetUserId = ticketMatch[1];
                try {
                    await callTelegramAPI('copyMessage', {
                        chat_id: targetUserId,
                        from_chat_id: message.chat.id,
                        message_id: message.message_id
                    });
                    await sendMessage(message.chat.id, `✅ Reply secretly sent to User ${targetUserId}`);
                } catch(e) {
                    await sendMessage(message.chat.id, `❌ Failed to send reply: ${e.message}`);
                }
            }
        }
        return; 
    }

    if (hasPendingProof(userId)) {
        const hasPhoto = message.photo && message.photo.length > 0;
        const isImageDoc = message.document && String(message.document.mime_type || '').startsWith('image/');
        if (!hasPhoto && !isImageDoc) {
            await sendMessage(userId, `⚠️ Please send a <b>payment screenshot image</b> so we can verify your payment.`);
            return;
        }

        const username = message.from.username ? `@${message.from.username}` : '(no username)';
        const firstName = message.from.first_name || '';
        const lastName = message.from.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'N/A';
        const plan = getPendingProofPlan(userId);
        const planLabel = plan === 'vip' ? '📸 VIP — Photos Only (₹299)' : '🔥 VIP+ — Photos + Videos (₹399)';
        const approveCallbackData = plan === 'vip'
            ? `appvip_${userId}_${message.from.username || ''}`
            : `appvipplus_${userId}_${message.from.username || ''}`;
        const approveButtonText = plan === 'vip'
            ? '✅ Approve VIP ₹299 — Send Photos Channel Link'
            : '✅ Approve VIP+ ₹399 — Send Videos+Photos Link';

        for (const adminId of ADMIN_IDS) {
            try {
                const textRes = await sendMessage(adminId,
                    `💳 <b>Payment Screenshot Received</b>\n\n` +
                    `👤 Name: ${fullName}\n` +
                    `🔖 Username: ${username}\n` +
                    `🆔 User ID: <code>${userId}</code>\n` +
                    `💎 <b>Plan: ${planLabel}</b>\n\n` +
                    `Tap <b>Approve</b> to activate subscription &amp; send invite link automatically.`,
                    { inline_keyboard: [
                        [{ text: approveButtonText, callback_data: approveCallbackData }],
                        [{ text: '❌ Reject', callback_data: `reject_payment_${userId}` }]
                    ]}
                );
                if (textRes?.ok && textRes.result) addVerifyMsg(userId, adminId, textRes.result.message_id);
                const copyRes = await callTelegramAPI('copyMessage', {
                    chat_id: adminId,
                    from_chat_id: message.chat.id,
                    message_id: message.message_id
                });
                if (copyRes?.ok && copyRes.result) addVerifyMsg(userId, adminId, copyRes.result.message_id);
            } catch (_) {}
        }

        removePendingProof(userId);
        const userMention = message.from.username ? `@${message.from.username}` : (message.from.first_name || 'there');
        await sendMessage(userId,
            `✅ <b>Screenshot Received!</b>\n\n` +
            `Thank you ${userMention}! Your payment is being reviewed.\n\n` +
            `⏳ You'll receive your <b>personal VIP invite link</b> here once approved — usually within a few hours.\n\n` +
            `<i>Do not leave this chat open — you'll get a notification when it's ready!</i>`);
        return;
    }

    // Normal user creates ticket
    for (const adminId of ADMIN_IDS) {
        try {
            await sendMessage(adminId, `📩 <b>Support Ticket from @${message.from.username || message.from.first_name}</b>\n[Ticket UserID: ${userId}]\n\n<i>👉 Swipe right on THIS message to reply to them anonymously.</i>`);
            await callTelegramAPI('copyMessage', {
                chat_id: adminId,
                from_chat_id: message.chat.id,
                message_id: message.message_id
            });
        } catch(e) {}
    }
}

async function handleCommand(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = (message.text || '').trim();

    if (!isAdmin(userId)) {
        if (text === '/start' || text.startsWith('/start ')) {
            const startParam = text.includes(' ') ? text.split(' ').slice(1).join(' ').trim().toLowerCase() : '';
            if (startParam === 'vip' || startParam === 'pay' || startParam === 'getvip') {
                await sendVipPaymentOption(chatId);
                return;
            }

            const firstName = message.from.first_name || 'there';
            await sendMessage(chatId,
                `👋 <b>Hey ${firstName}! Welcome to Prachi's VIP Bot</b> 💋🔥\n\n` +
                `I'm your personal assistant for everything VIP.\n` +
                `Choose an option below 👇`,
                {
                    inline_keyboard: [
                        [{ text: '📸 Buy VIP — Photos Only · ₹299/mo', callback_data: 'plan_vip' }],
                        [{ text: '🔥 Buy VIP+ — Photos+Videos · ₹399/mo', callback_data: 'plan_vip_plus' }],
                        [{ text: '✅ Check My Subscription', callback_data: 'check_status' }],
                        [{ text: '🔄 Renew Subscription', callback_data: 'renew_status' }],
                        [{ text: '🔓 Join My Channel', callback_data: 'join_channel' }],
                        [{ text: '🙋 Contact Support', callback_data: 'contact_support' }]
                    ]
                }
            );
        } else if (text === '/help') {
            await sendMessage(chatId,
                `🤖 <b>Available Commands</b>\n\n` +
                `/start — Main menu\n` +
                `/status — Check your subscription\n` +
                `/renew — Renew or get VIP access\n\n` +
                `<i>Need help? Use the Contact Support button from /start.</i>`
            );
        } else if (text === '/renew') {
            const { data: sub } = await supabase.from('prachi_subscriptions')
                .select('*')
                .eq('telegram_user_id', String(userId))
                .eq('status', 'active')
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (sub) {
                const expires = new Date(sub.expires_at);
                const daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24)));
                await sendMessage(chatId,
                    `⏳ <b>Your Subscription</b>\n\n` +
                    `📅 Expires: ${expires.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n` +
                    `⏳ Days left: <b>${daysLeft}</b>\n\n` +
                    `Tap below to renew before it expires! 💳`
                );
                await sendVipPaymentOption(chatId);
            } else {
                await sendMessage(chatId, '❌ No active subscription found.\n\nYou can purchase VIP access below.');
                await sendVipPaymentOption(chatId);
            }
        } else if (text === '/status') {
            const { data: sub } = await supabase.from('prachi_subscriptions')
                .select('*')
                .eq('telegram_user_id', String(userId))
                .eq('status', 'active')
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle();
                
            if (sub) {
                const expires = new Date(sub.expires_at);
                const daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24)));
                await sendMessage(chatId,
                    `✅ <b>Active Subscription</b>\n\n` +
                    `📅 Expires: ${expires.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n` +
                    `⏳ Days left: <b>${daysLeft}</b>\n` +
                    `💰 Amount: ₹${sub.amount}`
                );
            } else {
                await sendMessage(chatId,
                    '❌ No active subscription found.\n\nVisit the website to purchase access.'
                );
            }
        }
        return;
    }

    // --- Admin commands ---
    const now = new Date().toISOString();

    if (text === '/start' || text.startsWith('/start ') || text === '/menu') {
        await sendMessage(chatId,
            `👑 <b>ADMIN PANEL</b> — Prachi's VIP Bot\n` +
            `━━━━━━━━━━━━━━━━━━━━━━`,
            {
                inline_keyboard: [
                    [{ text: '——— 📊 Overview ———', callback_data: 'noop' }],
                    [{ text: '📊 Full Stats', callback_data: 'admin_stats' }, { text: '📋 Subscribers', callback_data: 'admin_subscribers' }],
                    [{ text: '👥 Users List (with Kick)', callback_data: 'admin_userslist_0' }],
                    [{ text: '🔴 Non-VIP', callback_data: 'admin_nonvip' }, { text: '🕐 Expired', callback_data: 'admin_expired' }],
                    [{ text: '——— 📢 Post Content ———', callback_data: 'noop' }],
                    [{ text: '📤 Smart Route Photo / Video', callback_data: 'admin_smart_post' }],
                    [{ text: '📸 Post → VIP ₹299', callback_data: 'admin_post_vip' }, { text: '🔥 Post → VIP+ ₹399', callback_data: 'admin_post_vipplus' }],
                    [{ text: '📣 Post → Public Channel', callback_data: 'admin_post_public' }],
                    [{ text: '——— ⚙️ Settings ———', callback_data: 'noop' }],
                    [{ text: '🔔 Welcome Messages', callback_data: 'admin_welcome' }, { text: '❓ All Commands', callback_data: 'admin_help' }]
                ]
            }
        );
        return;
    }

    if (text === '/setqr') {
        awaitingQrUploadAdmins.add(String(userId));
        await sendMessage(chatId, `📸 Send the payment QR image now.\n\nOptional: add caption text in the same photo message to set payment instructions.`);
        return;
    }

    if (text === '/channels' || text === '/diag') {
        let msg = `🔧 <b>CHANNEL DIAGNOSTICS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        const check = async (label, channelId, envKey) => {
            if (!channelId) return `❌ <b>${label}</b>\n  └ <code>${envKey}</code> not set in .env\n\n`;
            let section = `• <b>${label}</b>\n  ├ ID: <code>${channelId}</code>\n`;
            try {
                const info = await callTelegramAPI('getChat', { chat_id: channelId });
                if (!info.ok) return section + `  └ ❌ getChat failed: ${info.description}\n\n`;
                section += `  ├ Name: ${info.result.title || '(no title)'}\n`;
                const me = await callTelegramAPI('getChatMember', { chat_id: channelId, user_id: (await callTelegramAPI('getMe')).result.id });
                if (!me.ok) return section + `  └ ❌ getChatMember failed: ${me.description}\n\n`;
                const status = me.result.status;
                const canPost = me.result.can_post_messages;
                const canInvite = me.result.can_invite_users;
                section += `  ├ Bot status: ${status}\n`;
                section += `  ├ Can post: ${canPost ? '✅' : '❌'}\n`;
                section += `  └ Can invite: ${canInvite ? '✅' : '❌'}\n\n`;
                return section;
            } catch (e) {
                return section + `  └ ❌ Error: ${e.message}\n\n`;
            }
        };

        msg += await check('📣 Public Channel', PUBLIC_CHANNEL_ID, 'TELEGRAM_PUBLIC_CHANNEL_ID');
        msg += await check('📸 VIP Channel (₹299)', VIP_ONLY_CHANNEL_ID, 'TELEGRAM_VIP_CHANNEL_ID');
        msg += await check('🔥 VIP+ Channel (₹399)', VIP_PLUS_CHANNEL_ID, 'TELEGRAM_VIP_PLUS_CHANNEL_ID');

        await sendMessage(chatId, msg);
        return;
    }

    if (text === '/cleanchat' || text === '/clearchat') {
        const parts = text.split(' ');
        const requestedRange = parseInt(parts[1]);
        const range = Math.min(Math.max(requestedRange || 500, 10), 2000);
        const startId = message.message_id;

        const notice = await sendMessage(chatId,
            `🧹 <b>Cleaning chat...</b>\n\nAttempting to delete up to ${range} bot messages.\n<i>(Only bot messages within the last 48h will delete — Telegram limits.)</i>`
        );
        const noticeId = notice?.result?.message_id;

        let deleted = 0, failed = 0;
        for (let i = 1; i <= range; i++) {
            const msgId = startId - i;
            if (msgId <= 0) break;
            try {
                const r = await deleteMessage(chatId, msgId);
                if (r?.ok) deleted++;
                else failed++;
            } catch (_) { failed++; }
            if (i % 25 === 0) await new Promise(r => setTimeout(r, 300)); // rate limit safety
        }

        // Also clear the tracked store since we deleted everything
        try {
            const entries = loadAdminMsgs();
            const remaining = entries.filter(e => String(e.chatId) !== String(chatId));
            saveAdminMsgs(remaining);
        } catch (_) {}

        // Delete the command itself + the "cleaning..." notice
        try { await deleteMessage(chatId, message.message_id); } catch (_) {}
        if (noticeId) try { await deleteMessage(chatId, noticeId); } catch (_) {}

        const result = await sendMessage(chatId,
            `✅ <b>Chat cleaned!</b>\n\n` +
            `🗑 Deleted: <b>${deleted}</b> messages\n` +
            `<i>This message will auto-delete in 24h.</i>`
        );
        return;
    }

    if (text === '/showqr') {
        const pay = loadPaymentStore();
        if (!pay.qrFileId) {
            await sendMessage(chatId, '⚠️ QR not set yet. Use /setqr first.');
            return;
        }
        await callTelegramAPI('sendPhoto', {
            chat_id: chatId,
            photo: pay.qrFileId,
            caption: pay.qrCaption || 'Current VIP QR',
            parse_mode: 'HTML'
        });
        return;
    }

    if (text === '/subscribers' || text === '/subs') {
        const { data: subs } = await supabase.from('prachi_subscriptions')
            .select('*')
            .eq('status', 'active')
            .gt('expires_at', now)
            .order('expires_at', { ascending: true });

        if (!subs || subs.length === 0) {
            await sendMessage(chatId, '📋 No active subscribers.');
            return;
        }

        const vipSubs = subs.filter(s => s.plan === 'vip');
        const vipPlusSubs = subs.filter(s => s.plan !== 'vip');

        let msg = `📋 <b>ACTIVE SUBSCRIBERS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📸 VIP (₹299): <b>${vipSubs.length}</b>  🔥 VIP+ (₹399): <b>${vipPlusSubs.length}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        for (const s of subs.slice(0, 30)) {
            const expires = new Date(s.expires_at);
            const daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24)));
            const name = s.telegram_username || s.phone || `ID:${s.telegram_user_id}` || `#${s.id}`;
            const planBadge = s.plan === 'vip' ? '📸' : '🔥';
            const urgency = daysLeft <= 3 ? ' ⚠️' : daysLeft <= 7 ? ' ⏳' : '';
            msg += `${planBadge} <b>${name}</b>${urgency}\n   ⏳ ${daysLeft}d left · ₹${s.amount}\n\n`;
        }
        if (subs.length > 30) msg += `<i>... and ${subs.length - 30} more</i>\n`;
        msg += `\nTap below to open the interactive users list with <b>kick buttons</b> 👇`;
        await sendMessage(chatId, msg, {
            inline_keyboard: [[{ text: '👥 Open Users List (with Kick)', callback_data: 'admin_userslist_0' }]]
        });
    }

    else if (text === '/expired') {
        const { data: expired } = await supabase.from('prachi_subscriptions')
            .select('*')
            .in('status', ['expired', 'cancelled'])
            .order('id', { ascending: false })
            .limit(20);
            
        if (!expired || expired.length === 0) {
            await sendMessage(chatId, '✅ No expired subscriptions.');
            return;
        }
        let msg = `🕐 <b>Expired/Cancelled (last 20)</b>\n\n`;
        for (const s of expired) {
            const name = s.telegram_username || s.phone || `#${s.id}`;
            msg += `• ${name} — ${s.status} (₹${s.amount})\n`;
        }
        await sendMessage(chatId, msg);
    }

    else if (text === '/stats') {
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*');
        let st = { total: 0, activeVip: 0, activeVipPlus: 0, cancelled: 0, expired: 0, revenue: 0, totalRevenue: 0 };
        if (subs) {
            const nowTime = new Date();
            subs.forEach(s => {
                st.total++;
                st.totalRevenue += s.amount || 0;
                if (s.status === 'active' && new Date(s.expires_at) > nowTime) {
                    if (s.plan === 'vip') st.activeVip++;
                    else st.activeVipPlus++;
                    st.revenue += s.amount || 0;
                }
                if (s.status === 'cancelled') st.cancelled++;
                if (s.status === 'expired') st.expired++;
            });
        }
        const totalActive = st.activeVip + st.activeVipPlus;

        let publicMembers = '—', vipMembers = '—', vipPlusMembers = '—';
        try { if (PUBLIC_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: PUBLIC_CHANNEL_ID }); if (r.ok) publicMembers = r.result.toLocaleString(); } } catch (_) {}
        try { if (VIP_ONLY_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: VIP_ONLY_CHANNEL_ID }); if (r.ok) vipMembers = r.result.toLocaleString(); } } catch (_) {}
        try { if (VIP_PLUS_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: VIP_PLUS_CHANNEL_ID }); if (r.ok) vipPlusMembers = r.result.toLocaleString(); } } catch (_) {}

        await sendMessage(chatId,
            `📊 <b>FULL STATS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📡 <b>Channel Members</b>\n` +
            `├ 📣 Public Channel:  <b>${publicMembers}</b>\n` +
            `├ 📸 VIP (₹299):      <b>${vipMembers}</b>\n` +
            `└ 🔥 VIP+ (₹399):     <b>${vipPlusMembers}</b>\n\n` +
            `💎 <b>Subscriptions</b>\n` +
            `├ 📸 VIP Active:      <b>${st.activeVip}</b> users\n` +
            `├ 🔥 VIP+ Active:     <b>${st.activeVipPlus}</b> users\n` +
            `├ 💎 Total Active:    <b>${totalActive}</b> users\n` +
            `├ 🔴 Non-VIP:        <b>${st.total - totalActive}</b> users\n` +
            `├ 🕐 Expired:        <b>${st.expired}</b>\n` +
            `└ ❌ Cancelled:      <b>${st.cancelled}</b>\n\n` +
            `💰 <b>Revenue</b>\n` +
            `├ 📅 Active MRR:     <b>₹${st.revenue.toLocaleString()}</b>\n` +
            `└ 💵 Lifetime:       <b>₹${st.totalRevenue.toLocaleString()}</b>`
        );
    }

    else if (text.startsWith('/addvip ')) {
        // /addvip @username [days]  — grant VIP access directly (no payment screenshot needed)
        const parts = text.split(' ');
        const target = (parts[1] || '').replace('@', '').trim();
        const days = parseInt(parts[2]) || 30;
        if (!target) {
            await sendMessage(chatId, '❌ Usage: /addvip @username [days]\nExample: /addvip @johndoe 30');
            return;
        }
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        const expiryFormatted = new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

        // Check if already active
        const { data: existing } = await supabase.from('prachi_subscriptions')
            .select('id, expires_at')
            .or(`telegram_username.eq.@${target},telegram_username.eq.${target}`)
            .eq('status', 'active')
            .gt('expires_at', now)
            .maybeSingle();

        if (existing) {
            await sendMessage(chatId, `⚠️ @${target} already has an active sub until ${new Date(existing.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.\nUse /extend @${target} ${days} instead.`);
            return;
        }

        await supabase.from('prachi_subscriptions').insert({
            telegram_username: `@${target}`,
            phone: '',
            transaction_id: `ADMIN_GRANT_${Date.now()}`,
            amount: VIP_SUBSCRIPTION_AMOUNT,
            plan: 'monthly',
            status: 'active',
            expires_at: expiresAt
        });
        await sendMessage(chatId, `✅ VIP access granted to @${target} for ${days} days.\n📅 Expires: ${expiryFormatted}`);
    }

    else if (text.startsWith('/approve ')) {
        // /approve @username or /approve userId — generates invite link for user (no screenshot needed)
        const target = text.replace('/approve ', '').trim().replace('@', '');
        if (!target) {
            await sendMessage(chatId, '❌ Usage: /approve @username\nThis creates a 1-time invite link and activates their subscription.');
            return;
        }

        // Check existing or create subscription
        const { data: existSub } = await supabase.from('prachi_subscriptions')
            .select('id, telegram_user_id')
            .or(`telegram_username.eq.@${target},telegram_username.eq.${target},telegram_user_id.eq.${target}`)
            .eq('status', 'active')
            .gt('expires_at', now)
            .maybeSingle();

        let targetUserId = existSub?.telegram_user_id || (/^\d+$/.test(target) ? target : null);

        if (!existSub) {
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('prachi_subscriptions').insert({
                telegram_username: /^\d+$/.test(target) ? '' : `@${target}`,
                telegram_user_id: /^\d+$/.test(target) ? target : null,
                phone: '',
                transaction_id: `APPROVE_${Date.now()}`,
                amount: VIP_SUBSCRIPTION_AMOUNT,
                plan: 'monthly',
                status: 'active',
                expires_at: expiresAt
            });
        }

        // Generate one-time link
        const expireDate = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
        let inviteLink = '';
        try {
            const linkRes = await callTelegramAPI('createChatInviteLink', {
                chat_id: CHANNEL_ID,
                name: `Approved-${target}`,
                expire_date: expireDate,
                member_limit: 1
            });
            if (linkRes.ok && linkRes.result) inviteLink = linkRes.result.invite_link;
        } catch (e) {
            await sendMessage(chatId, `❌ Could not generate link: ${e.message}`);
            return;
        }

        if (!inviteLink) {
            await sendMessage(chatId, '❌ Failed to generate invite link. Is the bot an admin in the VIP channel?');
            return;
        }

        // Try to DM the user if we have their ID
        if (targetUserId) {
            try {
                await sendMessage(targetUserId,
                    `🎉 <b>You've been approved for VIP access!</b>\n\n` +
                    `Your subscription is active for <b>30 days</b>.\n\n` +
                    `⚠️ This link is <b>for you only</b> — single use, valid 24 hours:`,
                    { inline_keyboard: [[{ text: '🔓 Join VIP Channel', url: inviteLink }]] }
                );
                await sendMessage(chatId, `✅ Approved @${target}!\n🔗 One-time link sent via DM.\n📅 Sub active 30 days.`);
            } catch (e) {
                await sendMessage(chatId, `✅ Subscription created.\n⚠️ Couldn't DM user — send them this link manually:\n\n${inviteLink}`);
            }
        } else {
            await sendMessage(chatId, `✅ Subscription created for @${target}.\n\nSend them this link manually (1-use, 24h):\n\n${inviteLink}`);
        }
    }

    else if (text.startsWith('/kick ')) {
        const target = text.replace('/kick ', '').trim();
        const { data: sub } = await supabase.from('prachi_subscriptions')
            .select('*')
            .or(`telegram_username.eq.${target},telegram_user_id.eq.${target},phone.eq.${target}`)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
            
        if (!sub) {
            await sendMessage(chatId, `❌ No subscription found for "${target}"`);
            return;
        }
        if (sub.telegram_user_id) {
            try {
                await kickUser(sub.telegram_user_id);
            } catch (e) {
                await sendMessage(chatId, `⚠️ Kick API failed: ${e.message}`);
            }
        }
        await supabase.from('prachi_subscriptions').update({ status: 'cancelled', cancelled_at: now, kicked_at: now }).eq('id', sub.id);
        await sendMessage(chatId, `✅ Kicked & cancelled: ${sub.telegram_username || sub.phone || sub.id}`);
    }

    else if (text.startsWith('/broadcast')) {
        let msgToBroadcast = text.replace('/broadcast', '').trim();
        let fromChatId = chatId;
        let messageIdToCopy = null;

        if (message.reply_to_message) {
            messageIdToCopy = message.reply_to_message.message_id;
        }

        if (!msgToBroadcast && !messageIdToCopy) {
            await sendMessage(chatId, '❌ Please either type `/broadcast Your message` or reply to a message with `/broadcast`');
            return;
        }

        const { data: subs } = await supabase.from('prachi_subscriptions')
            .select('telegram_user_id')
            .eq('status', 'active')
            .gt('expires_at', now)
            .not('telegram_user_id', 'is', null);

        if (!subs || subs.length === 0) {
            await sendMessage(chatId, '❌ No active subscribers with connected telegram accounts found.');
            return;
        }

        await sendMessage(chatId, `⏳ Broadcasting to ${subs.length} active users...`);
        let success = 0, fail = 0;

        for (const s of subs) {
            try {
                if (messageIdToCopy) {
                    await callTelegramAPI('copyMessage', {
                        chat_id: s.telegram_user_id,
                        from_chat_id: fromChatId,
                        message_id: messageIdToCopy
                    });
                } else {
                    await sendMessage(s.telegram_user_id, msgToBroadcast);
                }
                success++;
            } catch (e) {
                fail++;
            }
            await new Promise(r => setTimeout(r, 50)); 
        }

        await sendMessage(chatId, `✅ <b>Broadcast Complete!</b>\nSuccess: ${success}\nFailed: ${fail}`);
    }

    else if (text.startsWith('/extend ')) {
        const parts = text.split(' ');
        if (parts.length < 3) {
            await sendMessage(chatId, '❌ Usage: /extend @username 7');
            return;
        }
        const target = parts[1].replace('@', '');
        const days = parseInt(parts[2]);
        if (isNaN(days) || days <= 0) {
            await sendMessage(chatId, '❌ Invalid number of days. Usage: /extend @username 7');
            return;
        }
        const { data: sub } = await supabase.from('prachi_subscriptions')
            .select('*')
            .or(`telegram_username.eq.@${target},telegram_username.eq.${target},phone.eq.${target},telegram_user_id.eq.${target}`)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (!sub) {
            await sendMessage(chatId, `❌ No subscription found for "${target}"`);
            return;
        }
        const currentExpiry = new Date(sub.expires_at);
        const newExpiry = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('prachi_subscriptions').update({ expires_at: newExpiry }).eq('id', sub.id);
        const expiryFormatted = new Date(newExpiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        await sendMessage(chatId, `✅ Extended <b>${sub.telegram_username || sub.phone}</b>'s subscription by ${days} days.\nNew expiry: ${expiryFormatted}`);
        if (sub.telegram_user_id) {
            try {
                await sendMessage(sub.telegram_user_id,
                    `🎁 Great news! Your subscription has been extended by <b>${days} days</b>!\n\n📅 New expiry: ${expiryFormatted}`
                );
            } catch (_) {}
        }
    }

    else if (text.startsWith('/info ') || text.startsWith('/user ') || text.startsWith('/history ')) {
        const target = text.split(' ').slice(1).join(' ').trim().replace('@', '');
        if (!target) {
            await sendMessage(chatId, '❌ Usage: /info @username\nShows full history of a user.');
            return;
        }
        // Find ALL subscription records for this user (not just active)
        const { data: subs } = await supabase.from('prachi_subscriptions')
            .select('*')
            .or(`telegram_username.eq.@${target},telegram_username.eq.${target},phone.eq.${target},telegram_user_id.eq.${target}`)
            .order('id', { ascending: true });

        if (!subs || subs.length === 0) {
            await sendMessage(chatId, `❌ No records found for "${target}"`);
            return;
        }

        const first = subs[0];
        const latest = subs[subs.length - 1];
        const active = subs.find(s => s.status === 'active' && new Date(s.expires_at) > new Date());
        const totalPaid = subs.reduce((sum, s) => sum + (s.amount || 0), 0);

        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

        let msg = `🔍 <b>USER HISTORY</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 <b>Identity</b>\n` +
            `├ Username:  ${latest.telegram_username || '—'}\n` +
            `├ User ID:   <code>${latest.telegram_user_id || '—'}</code>\n` +
            `└ Phone:     ${latest.phone || '—'}\n\n` +
            `📅 <b>Timeline</b>\n` +
            `├ First seen:    ${fmtDateTime(first.created_at || first.started_at)}\n` +
            `├ Latest action: ${fmtDateTime(latest.created_at || latest.started_at)}\n`;

        if (active) {
            const daysLeft = Math.max(0, Math.ceil((new Date(active.expires_at) - Date.now()) / 86400000));
            const planLabel = active.plan === 'vip' ? '📸 VIP (₹299)' : '🔥 VIP+ (₹399)';
            msg += `└ Current plan:  ${planLabel}\n\n` +
                `✅ <b>Active Subscription</b>\n` +
                `├ Started:    ${fmtDate(active.started_at || active.created_at)}\n` +
                `├ Expires:    ${fmtDate(active.expires_at)}\n` +
                `├ Days left:  <b>${daysLeft}</b>\n` +
                `└ Amount:     ₹${active.amount}\n\n`;
        } else {
            msg += `└ Status:        🔴 No active subscription\n\n`;
        }

        msg += `💳 <b>All Subscriptions (${subs.length})</b>\n`;
        for (const s of subs.slice(-10).reverse()) {
            const planBadge = s.plan === 'vip' ? '📸' : '🔥';
            const statusIcon = s.status === 'active' ? (new Date(s.expires_at) > new Date() ? '✅' : '🕐') : (s.status === 'cancelled' ? '❌' : '🕐');
            msg += `${statusIcon} ${planBadge} ₹${s.amount} · ${s.status} · ${fmtDate(s.started_at || s.created_at)}\n`;
        }
        if (subs.length > 10) msg += `<i>...and ${subs.length - 10} older entries</i>\n`;

        msg += `\n💰 <b>Total paid: ₹${totalPaid.toLocaleString()}</b>`;

        await sendMessage(chatId, msg);
    }

    else if (text.startsWith('/search ')) {
        const target = text.replace('/search ', '').trim().replace('@', '');
        const { data: subs } = await supabase.from('prachi_subscriptions')
            .select('*')
            .or(`telegram_username.eq.@${target},telegram_username.eq.${target},phone.eq.${target},telegram_user_id.eq.${target}`)
            .order('id', { ascending: false })
            .limit(5);
        if (!subs || subs.length === 0) {
            await sendMessage(chatId, `❌ No subscription found for "${target}"`);
            return;
        }
        let msg = `🔍 <b>Results for "${target}"</b>\n\n`;
        for (const s of subs) {
            const expires = s.expires_at ? new Date(s.expires_at) : null;
            const daysLeft = expires ? Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
            msg += `👤 ${s.telegram_username || s.phone || `ID:${s.telegram_user_id}`}\n`;
            msg += `📋 Status: <b>${s.status}</b>\n`;
            msg += `💰 Amount: ₹${s.amount}\n`;
            if (expires) msg += `📅 Expires: ${expires.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} (${daysLeft}d left)\n`;
            msg += `\n`;
        }
        await sendMessage(chatId, msg);
    }

    else if (text === '/nonvip') {
        const now = new Date().toISOString();
        // Expired active subs + cancelled subs — these are known users not currently in VIP
        const { data: subs } = await supabase.from('prachi_subscriptions')
            .select('*')
            .or(`status.eq.expired,status.eq.cancelled,and(status.eq.active,expires_at.lt.${now})`)
            .order('expires_at', { ascending: false })
            .limit(30);

        if (!subs || subs.length === 0) {
            await sendMessage(chatId, '✅ No non-VIP users found — everyone is active!');
            return;
        }

        // Split into chunks of 10 to avoid message length limits
        const chunks = [];
        for (let i = 0; i < subs.length; i += 10) chunks.push(subs.slice(i, i + 10));

        for (const chunk of chunks) {
            let msg = `👥 <b>Non-VIP Users (${subs.length} total)</b>\n\n`;
            for (const s of chunk) {
                const expires = s.expires_at ? new Date(s.expires_at) : null;
                const daysSince = expires ? Math.floor((Date.now() - expires) / (1000 * 60 * 60 * 24)) : null;
                const user = s.telegram_username || s.phone || (s.telegram_user_id ? `ID:${s.telegram_user_id}` : 'Unknown');
                const statusEmoji = s.status === 'cancelled' ? '❌' : '🕐';
                msg += `${statusEmoji} <b>${user}</b>\n`;
                msg += `   Status: ${s.status}`;
                if (expires) msg += ` · Expired ${daysSince}d ago`;
                msg += `\n   Paid: ₹${s.amount || 0}\n\n`;
            }
            await sendMessage(chatId, msg);
        }
    }

    else if (text.startsWith('/post ')) {
        // /post vip <message>  or  /post public <message>
        const parts = text.replace('/post ', '').trim();
        const spaceIdx = parts.indexOf(' ');
        if (spaceIdx === -1) {
            await sendMessage(chatId, '❌ Usage:\n<code>/post vip Your message here</code>\n<code>/post public Your message here</code>');
            return;
        }
        const target = parts.slice(0, spaceIdx).toLowerCase();
        const msgText = parts.slice(spaceIdx + 1).trim();
        if (!msgText) {
            await sendMessage(chatId, '❌ Message cannot be empty.');
            return;
        }
        if (target !== 'vip' && target !== 'vipplus' && target !== 'public') {
            await sendMessage(chatId, '❌ Target must be <b>vip</b>, <b>vipplus</b>, or <b>public</b>.\nExample: <code>/post vipplus Hello everyone!</code>');
            return;
        }
        const targetChannelId = target === 'vip' ? VIP_ONLY_CHANNEL_ID : (target === 'vipplus' ? VIP_PLUS_CHANNEL_ID : PUBLIC_CHANNEL_ID);
        if (!targetChannelId) {
            await sendMessage(chatId, `❌ ${target.toUpperCase()} channel not configured. Set TELEGRAM_VIP_CHANNEL_ID in .env`);
            return;
        }
        try {
            const result = await callTelegramAPI('sendMessage', { chat_id: targetChannelId, text: msgText, parse_mode: 'HTML' });
            if (result && !result.ok) throw new Error(result.description || 'Unknown Telegram error');
            await sendMessage(chatId, `✅ Message posted to ${target.toUpperCase()} channel!`);
        } catch (e) {
            await sendMessage(chatId, `❌ Failed to post: ${e.message}`);
        }
    }

    else if (text.startsWith('/welcome')) {
        const parts = text.split(' ');
        const target = (parts[1] || '').toLowerCase(); // vip or public
        const action = (parts[2] || '').toLowerCase(); // on or off
        const settings = loadWelcomeSettings();

        if (!target) {
            // Show current status
            await sendMessage(chatId,
                `📢 <b>Welcome Message Status</b>\n\n` +
                `VIP channel: ${settings.vip ? '✅ ON' : '❌ OFF'}\n` +
                `Public channel: ${settings.public ? '✅ ON' : '❌ OFF'}\n\n` +
                `<b>Commands:</b>\n` +
                `/welcome vip on — enable VIP welcome\n` +
                `/welcome vip off — disable VIP welcome\n` +
                `/welcome public on — enable public welcome\n` +
                `/welcome public off — disable public welcome`
            );
            return;
        }

        if (target !== 'vip' && target !== 'public') {
            await sendMessage(chatId, '❌ Usage: /welcome vip on|off  or  /welcome public on|off');
            return;
        }
        if (action !== 'on' && action !== 'off') {
            await sendMessage(chatId, `❌ Usage: /welcome ${target} on|off`);
            return;
        }

        settings[target] = action === 'on';
        saveWelcomeSettings(settings);
        await sendMessage(chatId,
            `${action === 'on' ? '✅' : '❌'} Welcome messages for <b>${target.toUpperCase()} channel</b> turned <b>${action.toUpperCase()}</b>.`
        );
    }

    else if (text === '/help') {
        await sendMessage(chatId,
            `🤖 <b>Admin Commands</b>\n\n` +
            `<b>📊 Stats & Users</b>\n` +
            `/stats — Full stats (VIP, VIP+, revenue)\n` +
            `/subscribers — Active subs with ❌ kick buttons\n` +
            `/nonvip — List expired &amp; cancelled users\n` +
            `/expired — List expired/cancelled (short)\n` +
            `/search &lt;username/phone&gt; — Look up user (short)\n` +
            `/info &lt;username/phone&gt; — Full user history\n\n` +
            `<b>📢 Messaging</b>\n` +
            `/post vip &lt;msg&gt; — Post to VIP Photos channel (₹299)\n` +
            `/post vipplus &lt;msg&gt; — Post to VIP+ channel (₹399)\n` +
            `/post public &lt;msg&gt; — Post to public channel\n` +
            `/broadcast &lt;msg&gt; — DM all active subscribers\n\n` +
            `<b>📤 Smart Content Routing</b>\n` +
            `Send photo → bot asks routing (VIP+VIP+ full, public blur)\n` +
            `Send video → bot asks routing (VIP+ full, VIP+public blur)\n\n` +
            `<b>⚙️ Management</b>\n` +
            `/extend &lt;username&gt; &lt;days&gt; — Add days to sub\n` +
            `/kick &lt;username/phone/id&gt; — Kick &amp; cancel user\n` +
            `/setqr — Upload/update payment QR\n` +
            `/showqr — Preview saved QR\n` +
            `/menu — Show quick-action menu\n` +
            `/help — Show this message`
        );
    }
}

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data;
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;

    // Acknowledge the callback query so the loading spinner stops
    callTelegramAPI('answerCallbackQuery', { callback_query_id: callbackQuery.id }).catch(()=>{});

    if (data === 'plan_vip') {
        await sendVipQrFlow(chatId, userId, 'vip');
    } else if (data === 'plan_vip_plus') {
        await sendVipQrFlow(chatId, userId, 'vip_plus');
    } else if (data === 'join_channel') {
        const { data: sub } = await supabase.from('prachi_subscriptions')
            .select('plan')
            .eq('telegram_user_id', String(userId))
            .eq('status', 'active')
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (sub) {
            const channelId = sub.plan === 'vip' ? VIP_ONLY_CHANNEL_ID : VIP_PLUS_CHANNEL_ID;
            const planLabel = sub.plan === 'vip' ? 'VIP Photos' : 'VIP+ Photos+Videos';
            if (!channelId) {
                await sendMessage(chatId, `⚠️ Channel not configured yet. Contact support.`);
            } else {
                const expireDate = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
                try {
                    const linkRes = await callTelegramAPI('createChatInviteLink', { chat_id: channelId, expire_date: expireDate, member_limit: 1 });
                    if (linkRes.ok && linkRes.result) {
                        await sendMessage(chatId, `🔓 Here is your ${planLabel} invite link (valid 24h, single-use):`,
                            { inline_keyboard: [[{ text: `🔓 Join ${planLabel}`, url: linkRes.result.invite_link }]] });
                    } else {
                        await sendMessage(chatId, `❌ Could not generate link. Contact support.`);
                    }
                } catch (e) {
                    await sendMessage(chatId, `❌ Error: ${e.message}`);
                }
            }
        } else {
            await sendMessage(chatId, `❌ No active subscription found. Purchase a plan first.`,
                { inline_keyboard: [
                    [{ text: '📸 VIP — Photos · ₹299', callback_data: 'plan_vip' }],
                    [{ text: '🔥 VIP+ — Photos+Videos · ₹399', callback_data: 'plan_vip_plus' }]
                ]}
            );
        }
    } else if (data === 'check_status') {
        const { data: sub } = await supabase.from('prachi_subscriptions')
            .select('*')
            .eq('telegram_user_id', String(userId))
            .eq('status', 'active')
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (sub) {
            const expires = new Date(sub.expires_at);
            const daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24)));
            const planLabel = sub.plan === 'vip' ? '📸 VIP — Photos Only (₹299)' : '🔥 VIP+ — Photos+Videos (₹399)';
            await sendMessage(chatId,
                `✅ <b>Active Subscription</b>\n\n` +
                `💎 Plan: ${planLabel}\n` +
                `📅 Expires: ${expires.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n` +
                `⏳ Days left: <b>${daysLeft}</b>`,
                { inline_keyboard: [[{ text: '🔓 Join My Channel', callback_data: 'join_channel' }]] }
            );
        } else {
            await sendMessage(chatId,
                '❌ No active subscription found on this account.\n\nIf you believe this is an error, use Contact Support. Otherwise tap below to get access.',
                { inline_keyboard: [
                    [{ text: '📸 VIP Photos — ₹299', callback_data: 'plan_vip' }],
                    [{ text: '🔥 VIP+ Photos+Videos — ₹399', callback_data: 'plan_vip_plus' }]
                ]}
            );
        }
    } else if (data === 'renew_status') {
        const { data: sub } = await supabase.from('prachi_subscriptions')
            .select('*')
            .eq('telegram_user_id', String(userId))
            .eq('status', 'active')
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (sub) {
            const expires = new Date(sub.expires_at);
            const daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24)));
            await sendMessage(chatId,
                `⏳ <b>Your Subscription</b>\n\n` +
                `📅 Expires: ${expires.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n` +
                `⏳ Days left: <b>${daysLeft}</b>\n\nTap below to renew! 💳`
            );
            await sendVipPaymentOption(chatId);
        } else {
            await sendMessage(chatId, '❌ No active subscription found.',
                { inline_keyboard: [[{ text: '💳 Get Access', callback_data: 'vip_qr' }]] }
            );
        }
    } else if (data === 'vip_qr') {
        await sendVipQrFlow(chatId, userId);
    } else if (data === 'send_payment_proof') {
        await sendMessage(chatId,
            `📤 Please send your <b>payment screenshot</b> in this chat.\n\n` +
            `Also include your UTR/reference in text if visible.`
        );
    } else if (data === 'admin_stats' && isAdmin(userId)) {
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*');
        let st = { total: 0, activeVip: 0, activeVipPlus: 0, cancelled: 0, expired: 0, revenue: 0, totalRevenue: 0 };
        if (subs) {
            const nowTime = new Date();
            subs.forEach(s => {
                st.total++;
                st.totalRevenue += s.amount || 0;
                if (s.status === 'active' && new Date(s.expires_at) > nowTime) {
                    if (s.plan === 'vip') st.activeVip++;
                    else st.activeVipPlus++;
                    st.revenue += s.amount || 0;
                }
                if (s.status === 'cancelled') st.cancelled++;
                if (s.status === 'expired') st.expired++;
            });
        }
        const totalActive = st.activeVip + st.activeVipPlus;
        let publicMembers = '—', vipMembers = '—', vipPlusMembers = '—';
        try { if (PUBLIC_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: PUBLIC_CHANNEL_ID }); if (r.ok) publicMembers = r.result.toLocaleString(); } } catch (_) {}
        try { if (VIP_ONLY_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: VIP_ONLY_CHANNEL_ID }); if (r.ok) vipMembers = r.result.toLocaleString(); } } catch (_) {}
        try { if (VIP_PLUS_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: VIP_PLUS_CHANNEL_ID }); if (r.ok) vipPlusMembers = r.result.toLocaleString(); } } catch (_) {}
        await sendMessage(chatId,
            `📊 <b>FULL STATS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📡 <b>Channel Members</b>\n` +
            `├ 📣 Public Channel:  <b>${publicMembers}</b>\n` +
            `├ 📸 VIP (₹299):      <b>${vipMembers}</b>\n` +
            `└ 🔥 VIP+ (₹399):     <b>${vipPlusMembers}</b>\n\n` +
            `💎 <b>Subscriptions</b>\n` +
            `├ 📸 VIP Active:      <b>${st.activeVip}</b> users\n` +
            `├ 🔥 VIP+ Active:     <b>${st.activeVipPlus}</b> users\n` +
            `├ 💎 Total Active:    <b>${totalActive}</b> users\n` +
            `├ 🔴 Non-VIP:        <b>${st.total - totalActive}</b> users\n` +
            `├ 🕐 Expired:        <b>${st.expired}</b>\n` +
            `└ ❌ Cancelled:      <b>${st.cancelled}</b>\n\n` +
            `💰 <b>Revenue</b>\n` +
            `├ 📅 Active MRR:     <b>₹${st.revenue.toLocaleString()}</b>\n` +
            `└ 💵 Lifetime:       <b>₹${st.totalRevenue.toLocaleString()}</b>`
        );

    } else if (data === 'noop') {
        // Section header buttons — do nothing

    } else if (data === 'admin_subscribers' && isAdmin(userId)) {
        const now2 = new Date().toISOString();
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*').eq('status', 'active').gt('expires_at', now2).order('expires_at', { ascending: true });
        if (!subs || subs.length === 0) { await sendMessage(chatId, '📋 No active subscribers.'); return; }
        const vipCount = subs.filter(s => s.plan === 'vip').length;
        const vipPlusCount = subs.filter(s => s.plan !== 'vip').length;
        let msg = `📋 <b>ACTIVE SUBSCRIBERS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📸 VIP (₹299): <b>${vipCount}</b>  🔥 VIP+ (₹399): <b>${vipPlusCount}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const s of subs.slice(0, 30)) {
            const daysLeft = Math.max(0, Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000));
            const name = s.telegram_username || s.phone || `ID:${s.telegram_user_id}`;
            const planBadge = s.plan === 'vip' ? '📸' : '🔥';
            const urgency = daysLeft <= 3 ? ' ⚠️' : daysLeft <= 7 ? ' ⏳' : '';
            msg += `${planBadge} <b>${name}</b>${urgency}\n   ⏳ ${daysLeft}d left · ₹${s.amount}\n\n`;
        }
        if (subs.length > 30) msg += `<i>...and ${subs.length - 30} more</i>\n`;
        msg += `\nTap below to open the interactive users list with <b>kick buttons</b> 👇`;
        await sendMessage(chatId, msg, {
            inline_keyboard: [[{ text: '👥 Open Users List (with Kick)', callback_data: 'admin_userslist_0' }]]
        });

    } else if (data.startsWith('admin_userslist_') && isAdmin(userId)) {
        const page = parseInt(data.replace('admin_userslist_', '')) || 0;
        const PAGE_SIZE = 8;
        const now2 = new Date().toISOString();
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*')
            .eq('status', 'active').gt('expires_at', now2)
            .order('expires_at', { ascending: true });
        if (!subs || subs.length === 0) {
            await sendMessage(chatId, '👥 No active users.');
            return;
        }
        const totalPages = Math.ceil(subs.length / PAGE_SIZE);
        const pageSubs = subs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        let msg = `👥 <b>USERS LIST</b> · Page ${page + 1}/${totalPages}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Total active: <b>${subs.length}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n`;

        const keyboard = [];
        for (const s of pageSubs) {
            const daysLeft = Math.max(0, Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000));
            const name = s.telegram_username || s.phone || (s.telegram_user_id ? `ID:${s.telegram_user_id}` : `#${s.id}`);
            const badge = s.plan === 'vip' ? '📸' : '🔥';
            keyboard.push([{ text: `${badge} ${name} · ${daysLeft}d · ❌ Kick`, callback_data: `kicksub_${s.id}` }]);
        }
        const navRow = [];
        if (page > 0) navRow.push({ text: '◀️ Prev', callback_data: `admin_userslist_${page - 1}` });
        if (page < totalPages - 1) navRow.push({ text: 'Next ▶️', callback_data: `admin_userslist_${page + 1}` });
        if (navRow.length) keyboard.push(navRow);
        keyboard.push([{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]);

        await sendMessage(chatId, msg, { inline_keyboard: keyboard });

    } else if (data.startsWith('kicksub_') && isAdmin(userId)) {
        const subId = parseInt(data.replace('kicksub_', ''));
        const { data: sub } = await supabase.from('prachi_subscriptions').select('*').eq('id', subId).maybeSingle();
        if (!sub) { await sendMessage(chatId, '⚠️ Subscription not found.'); return; }
        const name = sub.telegram_username || sub.phone || `ID:${sub.telegram_user_id}` || `#${sub.id}`;
        await sendMessage(chatId,
            `⚠️ <b>Confirm Kick & Cancel</b>\n\n` +
            `👤 ${name}\n` +
            `💎 Plan: ${sub.plan === 'vip' ? '📸 VIP (₹299)' : '🔥 VIP+ (₹399)'}\n` +
            `📅 Expires: ${new Date(sub.expires_at).toLocaleDateString('en-IN')}\n\n` +
            `This will <b>kick them from the channel</b> and <b>cancel their subscription</b>.`,
            { inline_keyboard: [
                [{ text: '✅ Yes, Kick & Cancel', callback_data: `kickconfirm_${subId}` }],
                [{ text: '🚫 No, Keep Them', callback_data: 'admin_userslist_0' }]
            ]}
        );

    } else if (data.startsWith('kickconfirm_') && isAdmin(userId)) {
        const subId = parseInt(data.replace('kickconfirm_', ''));
        const { data: sub } = await supabase.from('prachi_subscriptions').select('*').eq('id', subId).maybeSingle();
        if (!sub) { await sendMessage(chatId, '⚠️ Subscription not found.'); return; }
        const name = sub.telegram_username || sub.phone || `ID:${sub.telegram_user_id}`;
        const nowIso = new Date().toISOString();
        // Kick from correct channel based on plan
        if (sub.telegram_user_id) {
            try {
                if (sub.plan === 'vip' && VIP_ONLY_CHANNEL_ID) {
                    await kickUserFromChannel(VIP_ONLY_CHANNEL_ID, sub.telegram_user_id);
                } else {
                    await kickUser(sub.telegram_user_id);
                }
            } catch (e) {
                await sendMessage(chatId, `⚠️ Kick API failed: ${e.message}\nMarking sub as cancelled anyway.`);
            }
        }
        await supabase.from('prachi_subscriptions').update({ status: 'cancelled', cancelled_at: nowIso, kicked_at: nowIso }).eq('id', subId);
        await sendMessage(chatId, `✅ <b>Kicked & Cancelled</b>\n\n👤 ${name}\n💎 Plan: ${sub.plan === 'vip' ? '📸 VIP' : '🔥 VIP+'}`);

    } else if (data === 'admin_back' && isAdmin(userId)) {
        await sendMessage(chatId,
            `👑 <b>ADMIN PANEL</b> — Prachi's VIP Bot\n` +
            `━━━━━━━━━━━━━━━━━━━━━━`,
            {
                inline_keyboard: [
                    [{ text: '——— 📊 Overview ———', callback_data: 'noop' }],
                    [{ text: '📊 Full Stats', callback_data: 'admin_stats' }, { text: '📋 Subscribers', callback_data: 'admin_subscribers' }],
                    [{ text: '👥 Users List (with Kick)', callback_data: 'admin_userslist_0' }],
                    [{ text: '🔴 Non-VIP', callback_data: 'admin_nonvip' }, { text: '🕐 Expired', callback_data: 'admin_expired' }],
                    [{ text: '——— 📢 Post Content ———', callback_data: 'noop' }],
                    [{ text: '📤 Smart Route Photo / Video', callback_data: 'admin_smart_post' }],
                    [{ text: '📸 Post → VIP ₹299', callback_data: 'admin_post_vip' }, { text: '🔥 Post → VIP+ ₹399', callback_data: 'admin_post_vipplus' }],
                    [{ text: '📣 Post → Public Channel', callback_data: 'admin_post_public' }],
                    [{ text: '——— ⚙️ Settings ———', callback_data: 'noop' }],
                    [{ text: '🔔 Welcome Messages', callback_data: 'admin_welcome' }, { text: '❓ All Commands', callback_data: 'admin_help' }]
                ]
            }
        );

    } else if (data === 'admin_nonvip' && isAdmin(userId)) {
        const now2 = new Date().toISOString();
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*')
            .or(`status.eq.expired,status.eq.cancelled,and(status.eq.active,expires_at.lt.${now2})`)
            .order('expires_at', { ascending: false }).limit(30);
        if (!subs || subs.length === 0) { await sendMessage(chatId, '✅ No non-VIP users found!'); return; }
        const chunks = [];
        for (let i = 0; i < subs.length; i += 10) chunks.push(subs.slice(i, i + 10));
        for (const chunk of chunks) {
            let msg = `🔴 <b>Non-VIP Users (${subs.length} total)</b>\n\n`;
            for (const s of chunk) {
                const expires = s.expires_at ? new Date(s.expires_at) : null;
                const daysSince = expires ? Math.floor((Date.now() - expires) / 86400000) : null;
                const user = s.telegram_username || s.phone || (s.telegram_user_id ? `ID:${s.telegram_user_id}` : 'Unknown');
                msg += `${s.status === 'cancelled' ? '❌' : '🕐'} <b>${user}</b> — ${s.status}`;
                if (daysSince !== null) msg += ` · ${daysSince}d ago`;
                msg += `\n   Paid: ₹${s.amount || 0}\n\n`;
            }
            await sendMessage(chatId, msg);
        }

    } else if (data === 'admin_expired' && isAdmin(userId)) {
        const { data: expired } = await supabase.from('prachi_subscriptions').select('*').in('status', ['expired', 'cancelled']).order('id', { ascending: false }).limit(20);
        if (!expired || expired.length === 0) { await sendMessage(chatId, '✅ No expired subscriptions.'); return; }
        let msg = `🕐 <b>Expired/Cancelled (last 20)</b>\n\n`;
        for (const s of expired) msg += `• ${s.telegram_username || s.phone || `#${s.id}`} — ${s.status} (₹${s.amount})\n`;
        await sendMessage(chatId, msg);

    } else if (data === 'admin_welcome' && isAdmin(userId)) {
        const s = loadWelcomeSettings();
        await sendMessage(chatId,
            `🔔 <b>Welcome Messages</b>\n\n` +
            `VIP channel: ${s.vip ? '✅ ON' : '❌ OFF'}\n` +
            `Public channel: ${s.public ? '✅ ON' : '❌ OFF'}\n\n` +
            `Tap to toggle:`,
            { inline_keyboard: [
                [{ text: `${s.vip ? '✅ VIP — ON' : '❌ VIP — OFF'} (tap to toggle)`, callback_data: 'toggle_welcome_vip' }],
                [{ text: `${s.public ? '✅ Public — ON' : '❌ Public — OFF'} (tap to toggle)`, callback_data: 'toggle_welcome_public' }]
            ]}
        );

    } else if (data === 'toggle_welcome_vip' && isAdmin(userId)) {
        const s = loadWelcomeSettings();
        s.vip = !s.vip;
        saveWelcomeSettings(s);
        await sendMessage(chatId, `${s.vip ? '✅' : '❌'} VIP welcome messages turned <b>${s.vip ? 'ON' : 'OFF'}</b>.`);

    } else if (data === 'toggle_welcome_public' && isAdmin(userId)) {
        const s = loadWelcomeSettings();
        s.public = !s.public;
        saveWelcomeSettings(s);
        await sendMessage(chatId, `${s.public ? '✅' : '❌'} Public welcome messages turned <b>${s.public ? 'ON' : 'OFF'}</b>.`);

    } else if (data === 'smart_route_photo' && isAdmin(userId)) {
        const pending = awaitingSmartPost.get(String(userId));
        if (!pending || pending.type !== 'photo') { await sendMessage(chatId, '⚠️ No photo pending. Send a photo first.'); return; }
        awaitingSmartPost.delete(String(userId));
        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
        const vipJoinUrl = getVipEntryUrl(frontendUrl);
        const teaserCaption = (pending.caption ? pending.caption + '\n\n' : '') + `🔒 <b>Exclusive content — join VIP to see full image!</b>`;
        const upgradeMarkup = { inline_keyboard: [[{ text: '🔓 Get VIP Access', url: vipJoinUrl }]] };
        try {
            const r = await smartDistributePhoto(pending.fileId, pending.caption || '', teaserCaption, upgradeMarkup);
            let msg = `📸 <b>Photo Distribution Result</b>\n\n`;
            msg += r.vipPlus?.ok ? `✅ VIP+ (₹399): Posted\n` : `❌ VIP+ (₹399): ${r.vipPlusErr || 'failed'}\n`;
            msg += r.vip?.ok     ? `✅ VIP (₹299):  Posted\n` : `❌ VIP (₹299):  ${r.vipErr || 'failed'}\n`;
            msg += r.public?.ok  ? `✅ Public:      Posted (blur)\n` : `❌ Public:      ${r.publicErr || 'failed'}\n`;
            await sendMessage(chatId, msg);
        } catch (e) {
            await sendMessage(chatId, `❌ Distribution failed: ${e.message}`);
        }

    } else if (data === 'smart_route_video' && isAdmin(userId)) {
        const pending = awaitingSmartPost.get(String(userId));
        if (!pending || pending.type !== 'video') { await sendMessage(chatId, '⚠️ No video pending. Send a video first.'); return; }
        awaitingSmartPost.delete(String(userId));
        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
        const vipJoinUrl = getVipEntryUrl(frontendUrl);
        const teaserCaption = (pending.caption ? pending.caption + '\n\n' : '') + `🔒 <b>Exclusive video — upgrade to VIP+ to watch!</b>`;
        const upgradeMarkup = { inline_keyboard: [[{ text: '🔥 Upgrade to VIP+', url: vipJoinUrl }]] };
        try {
            const r = await smartDistributeVideo(pending.fileId, pending.thumbFileId, pending.caption || '', teaserCaption, upgradeMarkup);
            let msg = `🎬 <b>Video Distribution Result</b>\n\n`;
            msg += r.vipPlus?.ok ? `✅ VIP+ (₹399): Posted (full)\n` : `❌ VIP+ (₹399): ${r.vipPlusErr || 'failed'}\n`;
            msg += `⏭ VIP (₹299):  Skipped (photos-only channel)\n`;
            msg += r.public?.ok  ? `✅ Public:      Posted (blur teaser)\n` : `❌ Public:      ${r.publicErr || 'failed'}\n`;
            await sendMessage(chatId, msg);
        } catch (e) {
            await sendMessage(chatId, `❌ Distribution failed: ${e.message}`);
        }

    } else if (data === 'smart_route_album' && isAdmin(userId)) {
        const pending = awaitingSmartPost.get(String(userId));
        if (!pending || pending.type !== 'album') { await sendMessage(chatId, '⚠️ No album pending. Send multiple photos/videos first.'); return; }
        awaitingSmartPost.delete(String(userId));
        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
        const vipJoinUrl = getVipEntryUrl(frontendUrl);
        const teaserCaption = (pending.caption ? pending.caption + '\n\n' : '') + `🔒 <b>Exclusive album — join VIP to unlock!</b>`;
        const upgradeMarkup = { inline_keyboard: [[{ text: '🔓 Get VIP Access', url: vipJoinUrl }]] };
        try {
            const r = await smartDistributeAlbum(pending.items, pending.caption || '', teaserCaption, upgradeMarkup);
            let msg = `🖼 <b>Album Distribution Result</b>\n\n` +
                `Items: ${pending.items.length} (📸 ${pending.items.filter(i=>i.type==='photo').length} · 🎬 ${pending.items.filter(i=>i.type==='video').length})\n\n`;
            msg += r.vipPlus?.ok ? `✅ VIP+ (₹399): Posted\n` : `❌ VIP+ (₹399): ${r.vipPlusErr || 'failed'}\n`;
            msg += r.vip?.ok     ? `✅ VIP (₹299):  Posted\n` : `❌ VIP (₹299):  ${r.vipErr || 'failed'}\n`;
            msg += r.public?.ok  ? `✅ Public:      Posted (blur)\n` : `❌ Public:      ${r.publicErr || 'failed'}\n`;
            await sendMessage(chatId, msg);
        } catch (e) {
            await sendMessage(chatId, `❌ Album distribution failed: ${e.message}`);
        }

    } else if (data === 'smart_cancel' && isAdmin(userId)) {
        awaitingSmartPost.delete(String(userId));
        await sendMessage(chatId, '🚫 Cancelled.');

    } else if (data === 'admin_smart_post' && isAdmin(userId)) {
        await sendMessage(chatId,
            `📤 <b>Smart Content Routing</b>\n\n` +
            `Send a <b>photo</b>, <b>video</b>, or <b>album</b> (multiple items) to this bot DM and I'll ask how to distribute it.\n\n` +
            `📸 <b>Photo routing:</b>\n` +
            `• Full → VIP (₹299) + VIP+ (₹399)\n` +
            `• Blurred teaser → Public\n\n` +
            `🎬 <b>Video routing:</b>\n` +
            `• Full → VIP+ (₹399) only\n` +
            `• Blurred thumbnail → Public\n` +
            `• VIP (₹299) skipped — photos-only channel\n\n` +
            `🖼 <b>Album / Carousel (up to 10 items):</b>\n` +
            `• VIP+ (₹399): full photos & videos\n` +
            `• VIP (₹299): photos only (videos skipped)\n` +
            `• Public: blurred teasers\n\n` +
            `<i>Send your content now 👇</i>`
        );

    } else if (data === 'admin_post_vip' && isAdmin(userId)) {
        await sendMessage(chatId, `📸 <b>Post to VIP Channel (₹299 — Photos)</b>\n\nSend your message using:\n<code>/post vip Your message here</code>\n\nOr send a photo to this chat for smart routing.`);

    } else if (data === 'admin_post_vipplus' && isAdmin(userId)) {
        await sendMessage(chatId, `🔥 <b>Post to VIP+ Channel (₹399 — Photos+Videos)</b>\n\nSend your message using:\n<code>/post vipplus Your message here</code>\n\nOr send a photo/video to this chat for smart routing.`);

    } else if (data === 'admin_post_public' && isAdmin(userId)) {
        await sendMessage(chatId, `📣 <b>Post to Public Channel</b>\n\nSend your message using:\n<code>/post public Your message here</code>\n\nSupports HTML formatting: <b>bold</b>, <i>italic</i>, <a href='...'>links</a>`);

    } else if (data === 'admin_help' && isAdmin(userId)) {
        await sendMessage(chatId,
            `🤖 <b>All Admin Commands</b>\n\n` +
            `<b>📊 Stats & Users</b>\n` +
            `/stats — Full stats (VIP, VIP+, revenue)\n` +
            `/subscribers — Active subs with ❌ kick buttons\n` +
            `/nonvip — Expired &amp; cancelled users\n` +
            `/expired — Short expired list\n` +
            `/search &lt;user&gt; — Look up a user (short)\n` +
            `/info &lt;user&gt; — Full user history\n\n` +
            `<b>📢 Messaging</b>\n` +
            `/post vip &lt;msg&gt; — Post to VIP Photos channel (₹299)\n` +
            `/post vipplus &lt;msg&gt; — Post to VIP+ channel (₹399)\n` +
            `/post public &lt;msg&gt; — Post to public channel\n` +
            `/broadcast &lt;msg&gt; — DM all active subs\n\n` +
            `<b>📤 Smart Content</b>\n` +
            `Send a photo/video to bot → auto-routing menu\n` +
            `• Photo → both VIP channels + public blur\n` +
            `• Video → VIP+ full + VIP blur + public blur\n\n` +
            `<b>⚙️ Management</b>\n` +
            `/extend &lt;user&gt; &lt;days&gt; — Add days to sub\n` +
            `/kick &lt;user&gt; — Kick &amp; cancel user\n` +
            `👥 Users List button → kick any user with one tap\n` +
            `/welcome — Toggle welcome messages on/off\n` +
            `/setqr — Upload/update payment QR\n` +
            `/showqr — Preview saved QR\n` +
            `/menu — Quick-action menu`
        );

    } else if ((data.startsWith('appvip_') || data.startsWith('appvipplus_')) && isAdmin(userId)) {
        const isVipPlus = data.startsWith('appvipplus_');
        const withoutPrefix = isVipPlus ? data.slice('appvipplus_'.length) : data.slice('appvip_'.length);
        const underscoreIdx = withoutPrefix.indexOf('_');
        const targetUserId = underscoreIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, underscoreIdx);
        const targetUsername = underscoreIdx === -1 ? '' : withoutPrefix.slice(underscoreIdx + 1);
        const plan = isVipPlus ? 'vip_plus' : 'vip';
        const amount = isVipPlus ? VIP_PLUS_AMOUNT : VIP_AMOUNT;
        const channelId = isVipPlus ? VIP_PLUS_CHANNEL_ID : VIP_ONLY_CHANNEL_ID;
        const planLabel = isVipPlus ? 'VIP+ (₹399 Photos+Videos)' : 'VIP (₹299 Photos)';
        const channelLabel = isVipPlus ? 'VIP+ Photos+Videos' : 'VIP Photos';

        if (!channelId) {
            await sendMessage(chatId, `❌ ${planLabel} channel not configured. Set TELEGRAM_VIP_CHANNEL_ID in .env`);
            return;
        }

        // Check for existing active subscription (prevent double-approve)
        const nowIso = new Date().toISOString();
        const { data: existing } = await supabase.from('prachi_subscriptions')
            .select('id, expires_at')
            .eq('telegram_user_id', targetUserId)
            .eq('status', 'active')
            .gt('expires_at', nowIso)
            .maybeSingle();

        if (existing) {
            const expiryStr = new Date(existing.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            await sendMessage(chatId, `⚠️ User ${targetUsername || targetUserId} already has an active subscription until ${expiryStr}.\n\nUse /extend if you want to add more days.`);
            return;
        }

        // Create active subscription in DB (30 days)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const { error: insertErr } = await supabase.from('prachi_subscriptions').insert({
            telegram_user_id: targetUserId,
            telegram_username: targetUsername ? `@${targetUsername}` : '',
            phone: '',
            transaction_id: `MANUAL_${Date.now()}`,
            amount,
            plan,
            status: 'active',
            expires_at: expiresAt
        });

        if (insertErr) {
            await sendMessage(chatId, `❌ DB error: ${insertErr.message}`);
            return;
        }

        // Generate a one-time invite link (expires in 24h, single use)
        const expireDate = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
        let inviteLink = '';
        try {
            const linkRes = await callTelegramAPI('createChatInviteLink', {
                chat_id: channelId,
                name: `${plan}-${targetUserId}`,
                expire_date: expireDate,
                member_limit: 1
            });
            if (linkRes.ok && linkRes.result && linkRes.result.invite_link) {
                inviteLink = linkRes.result.invite_link;
            }
        } catch (e) {
            await sendMessage(chatId, `❌ Could not generate invite link: ${e.message}`);
            return;
        }

        if (!inviteLink) {
            await sendMessage(chatId, `❌ Failed to generate invite link. Make sure the bot is admin in the ${channelLabel} channel.`);
            return;
        }

        // Send one-time link to user
        try {
            await sendMessage(targetUserId,
                `🎉 <b>Payment Approved!</b>\n\n` +
                `💎 <b>Plan: ${planLabel}</b>\n` +
                `Your subscription is now active for <b>30 days</b>.\n\n` +
                `⚠️ <b>Important:</b> The link below is <b>for you only</b> — it works once and expires in 24 hours. Do not share it.\n\n` +
                `Tap below to join:`,
                { inline_keyboard: [[{ text: `🔓 Join ${channelLabel} (1-time link)`, url: inviteLink }]] }
            );
        } catch (e) {
            await sendMessage(chatId, `⚠️ Approved in DB but couldn't DM user (they may not have started the bot): ${e.message}\n\nManual link: ${inviteLink}`);
            return;
        }

        // Delete the verification messages (screenshot + approve/reject buttons) to keep admin chat clean
        await clearVerifyMsgs(targetUserId);
        await sendMessage(chatId, `✅ Approved!\n\n👤 User: ${targetUsername || targetUserId}\n💎 Plan: ${planLabel}\n🔗 One-time link sent (expires 24h, single-use).\n📅 Sub active for 30 days.`);

    } else if (data.startsWith('approve_payment_') && isAdmin(userId)) {
        // Legacy callback — treat as vip_plus for backward compat
        const parts = data.split('_');
        const targetUserId = parts[2];
        const targetUsername = parts.slice(3).join('_') || '';
        const nowIso = new Date().toISOString();
        const { data: existing } = await supabase.from('prachi_subscriptions').select('id, expires_at').eq('telegram_user_id', targetUserId).eq('status', 'active').gt('expires_at', nowIso).maybeSingle();
        if (existing) {
            await sendMessage(chatId, `⚠️ User already has an active sub until ${new Date(existing.expires_at).toLocaleDateString('en-IN')}.`);
            return;
        }
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('prachi_subscriptions').insert({ telegram_user_id: targetUserId, telegram_username: targetUsername ? `@${targetUsername}` : '', phone: '', transaction_id: `MANUAL_${Date.now()}`, amount: VIP_PLUS_AMOUNT, plan: 'vip_plus', status: 'active', expires_at: expiresAt });
        const expireDate = Math.floor(Date.now() / 1000) + 86400;
        const linkRes = await callTelegramAPI('createChatInviteLink', { chat_id: VIP_PLUS_CHANNEL_ID, expire_date: expireDate, member_limit: 1 });
        if (!linkRes.ok) { await sendMessage(chatId, '❌ Failed to generate link.'); return; }
        try { await sendMessage(targetUserId, `🎉 <b>Payment Approved! Welcome to VIP+!</b>\n\nSub active 30 days.`, { inline_keyboard: [[{ text: '🔓 Join VIP+ Channel', url: linkRes.result.invite_link }]] }); } catch (_) {}
        await clearVerifyMsgs(targetUserId);
        await sendMessage(chatId, `✅ Approved (VIP+)!\n👤 ${targetUsername || targetUserId}\n📅 30 days`);

    } else if (data.startsWith('reject_payment_') && isAdmin(userId)) {
        const targetUserId = data.split('_')[2];
        try {
            await sendMessage(targetUserId,
                `❌ <b>Payment Not Verified</b>\n\nWe could not verify your payment. Please contact support if you believe this is a mistake.`,
                { inline_keyboard: [[{ text: '🙋 Contact Support', callback_data: 'contact_support' }]] }
            );
        } catch (_) {}
        // Delete the verification messages (screenshot + approve/reject buttons)
        await clearVerifyMsgs(targetUserId);
        await sendMessage(chatId, `❌ Rejected. User ${targetUserId} has been notified.`);

    } else if (data === 'contact_support') {
        await sendMessage(chatId, '📩 Please type your question or request below. An admin will reply as soon as possible!');
    }
}

async function pollUpdates() {
    if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
        console.log('[BOT] Telegram bot disabled (no token configured)');
        return;
    }

    polling = true;
    console.log('[BOT] Telegram bot started polling...');

    try {
        const me = await callTelegramAPI('getMe');
        if (me.ok && me.result && me.result.username) {
            cachedBotUsername = me.result.username;
            console.log(`[BOT] Bot connected: @${cachedBotUsername}`);
        } else {
            console.log('[BOT] Bot connected successfully');
        }

        // Auto-fix any stored welcome messages that have the old website URL in their buttons
        if (cachedBotUsername) {
            const stored = loadWelcomeStore();
            if (stored.length > 0) {
                console.log(`[BOT] Auto-fixing ${stored.length} stored welcome message(s)...`);
                const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
                const vipJoinUrl = getVipEntryUrl(frontendUrl);
                let fixed = 0;
                for (const entry of stored) {
                    const botUrl = `https://t.me/${cachedBotUsername}?start=${entry.type || 'vip'}`;
                    const markup = entry.type === 'public'
                        ? { inline_keyboard: [
                            [{ text: '🔔 Start Bot — Get Notified', url: botUrl }],
                            [{ text: '🔓 Get VIP Access', url: vipJoinUrl }]
                          ]}
                        : { inline_keyboard: [[{ text: '🔔 Start Bot — Activate Perks', url: botUrl }]] };
                    try {
                        const r = await callTelegramAPI('editMessageReplyMarkup', {
                            chat_id: entry.chatId,
                            message_id: entry.messageId,
                            reply_markup: markup
                        });
                        if (r.ok) fixed++;
                    } catch (_) {}
                }
                console.log(`[BOT] Fixed ${fixed}/${stored.length} welcome message button(s)`);
            }
        }

        // Register user-facing commands (visible to all users)
        await callTelegramAPI('setMyCommands', {
            commands: [
                { command: 'start', description: '🏠 Main menu' },
                { command: 'status', description: '✅ Check my subscription status' },
                { command: 'renew', description: '💳 Renew or get VIP access' },
            ]
        }).catch(() => {});

        // Register admin commands scoped to each admin's private chat
        const adminCommands = [
            { command: 'menu', description: '👑 Quick-action menu' },
            { command: 'stats', description: '📊 Full stats — VIP, VIP+, revenue' },
            { command: 'subscribers', description: '📋 Active subscribers' },
            { command: 'nonvip', description: '🔴 Expired & cancelled users' },
            { command: 'expired', description: '🕐 Expired/cancelled (short list)' },
            { command: 'search', description: '🔍 Look up a user (short)' },
            { command: 'info', description: '📜 Full user history (joins, subs, payments)' },
            { command: 'approve', description: '✅ Approve user & send invite link' },
            { command: 'addvip', description: '➕ Grant VIP access to user' },
            { command: 'extend', description: '📅 Add days to a subscription' },
            { command: 'kick', description: '👢 Kick & cancel a user' },
            { command: 'broadcast', description: '📢 DM all active subscribers' },
            { command: 'post', description: '📨 Post to vip / vipplus / public channel' },
            { command: 'welcome', description: '📢 Toggle welcome messages on/off' },
            { command: 'setqr', description: '🖼 Upload payment QR image' },
            { command: 'showqr', description: '🧾 Preview current QR' },
            { command: 'channels', description: '🔧 Diagnose channel IDs & bot permissions' },
            { command: 'cleanchat', description: '🧹 Bulk-clean old bot messages (48h limit)' },
            { command: 'help', description: '❓ All admin commands' },
        ];
        for (const adminId of ADMIN_IDS) {
            await callTelegramAPI('setMyCommands', {
                commands: adminCommands,
                scope: { type: 'chat', chat_id: Number(adminId) }
            }).catch(() => {});
        }
        console.log('[BOT] Commands registered');

        // Run welcome message cleanup every hour
        cleanupOldWelcomeMessages();
        setInterval(cleanupOldWelcomeMessages, 60 * 60 * 1000);
        console.log('[BOT] Welcome message cleanup scheduled (every 1h)');

        // Run admin chat cleanup every hour — deletes bot messages older than 24h
        cleanupOldAdminMessages();
        setInterval(cleanupOldAdminMessages, 60 * 60 * 1000);
        console.log('[BOT] Admin chat cleanup scheduled (every 1h)');
    } catch (e) {
        console.error('[BOT] Failed to connect:', e.message);
        return;
    }

    while (polling) {
        try {
            const result = await callTelegramAPI('getUpdates', {
                offset: lastUpdateId + 1,
                timeout: 30,
                allowed_updates: ['message', 'chat_member', 'callback_query']
            });

            if (result.ok && result.result && result.result.length > 0) {
                for (const update of result.result) {
                    lastUpdateId = update.update_id;

                    try {
                        if (update.chat_member) {
                            await handleNewChatMember(update);
                        }
                        if (update.message) {
                            if (update.message.new_chat_members) {
                                await handleNewChatMember(update);
                            }
                            if (update.message.text && update.message.text.startsWith('/')) {
                                await handleCommand(update.message);
                            } else {
                                await handleSupportTicket(update.message);
                            }
                        }
                        if (update.callback_query) {
                            await handleCallbackQuery(update.callback_query);
                        }
                    } catch (e) {
                        console.error('[BOT] Error processing update:', e.message);
                    }
                }
            }
        } catch (e) {
            console.error('[BOT] Polling error:', e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

function stopPolling() {
    polling = false;
}

module.exports = { pollUpdates, stopPolling, trackAdminMsg };
