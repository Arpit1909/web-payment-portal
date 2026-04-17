const supabase = require('./database');
const { callTelegramAPI, kickUser, sendMessage, deleteMessage } = require('./telegram');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const PUBLIC_CHANNEL_ID = process.env.TELEGRAM_PUBLIC_CHANNEL_ID || '';
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);

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
const VIP_SUBSCRIPTION_AMOUNT = 399;

// Persistent store for welcome messages so we can fix their button URLs on restart
const WELCOME_STORE_PATH = path.join(__dirname, 'welcome_msgs.json');
const PAYMENT_STORE_PATH = path.join(__dirname, 'payment_settings.json');
const PENDING_PROOF_PATH = path.join(__dirname, 'pending_proof.json');
const WELCOME_SETTINGS_PATH = path.join(__dirname, 'welcome_settings.json');

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

function addPendingProof(userId) {
    const d = loadPendingProof();
    d[String(userId)] = Date.now();
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

function getVipEntryUrl(fallbackUrl = null) {
    const frontendUrl = fallbackUrl || process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const envBotUsername = (process.env.TELEGRAM_BOT_USERNAME || 'manager_keshavs_bot').replace(/^@/, '').trim();
    const botUsername = (cachedBotUsername || envBotUsername || '').replace(/^@/, '').trim();
    return botUsername ? `https://t.me/${botUsername}?start=vip` : frontendUrl;
}

async function sendVipQrFlow(chatId, userId) {
    const pay = loadPaymentStore();
    if (!pay.qrFileId) {
        await sendMessage(chatId,
            `💳 VIP payment is currently being configured.\n\nPlease contact support and we will share payment details manually.`,
            { inline_keyboard: [[{ text: '🙋 Contact Support', callback_data: 'contact_support' }]] }
        );
        return;
    }

    const qrCaption = pay.qrCaption && String(pay.qrCaption).trim()
        ? String(pay.qrCaption).trim() + `\n\n💰 <b>Amount:</b> Rs ${VIP_SUBSCRIPTION_AMOUNT}/-`
        : `✨ <b>Welcome to Premium VIP Access</b> ✨\n\n` +
          `┏━━━━━━━━━━━━━━━┓\n` +
          `💎 <b>Plan:</b> VIP Membership\n` +
          `💰 <b>Amount:</b> Rs ${VIP_SUBSCRIPTION_AMOUNT}/-\n` +
          `┗━━━━━━━━━━━━━━━┛\n\n` +
          `📌 <b>How to activate:</b>\n` +
          `1️⃣ Scan this QR & complete payment of Rs ${VIP_SUBSCRIPTION_AMOUNT}/-\n` +
          `2️⃣ Tap <b>Send Payment Screenshot</b>\n` +
          `3️⃣ Share screenshot + UTR for quick verification\n\n` +
          `⚡ <i>Once verified, your VIP access is shared here ASAP.</i>`;

    await callTelegramAPI('sendPhoto', {
        chat_id: chatId,
        photo: pay.qrFileId,
        caption: qrCaption,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '📤 Send Payment Screenshot', callback_data: 'send_payment_proof' }]]
        }
    });
    addPendingProof(userId);
}

async function sendVipPaymentOption(chatId) {
    await sendMessage(chatId,
        `💳 <b>VIP Payment</b>\n\n` +
        `Tap the button below to view the QR and complete your payment of <b>Rs 399/-</b>.`,
        { inline_keyboard: [[{ text: '💳 Pay via QR - Rs 399/-', callback_data: 'vip_qr' }]] }
    );
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

    // --- VIP CHANNEL: verify subscription then send welcome ---
    if (!matchesChannel(chatId, CHANNEL_ID)) return;

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

    if (!sub) {
        if (!subByUsername) {
            console.log(`[BOT] Unverified user joined VIP: ${username || userId} — kicking`);
            try {
                await kickUser(userId);
                await sendMessage(userId,
                    '🚫 You do not have an active subscription.\n\nPlease purchase a subscription first to access the private channel.',
                    { inline_keyboard: [[{ text: '💳 Get Access', url: vipJoinUrl }]] }
                );
            } catch (e) {
                console.error(`[BOT] Kick failed for ${userId}:`, e.message);
            }
            return;
        }

        await supabase.from('prachi_subscriptions').update({ telegram_user_id: String(userId) }).eq('id', subByUsername.id);
        console.log(`[BOT] Linked telegram_user_id ${userId} to subscription #${subByUsername.id}`);
    } else {
        if (!sub.telegram_user_id) {
            await supabase.from('prachi_subscriptions').update({ telegram_user_id: String(userId) }).eq('id', sub.id);
        }
        console.log(`[BOT] Verified user joined VIP: ${username || userId} (sub #${sub.id})`);
    }

    } // end of subscription check block (skipped when admin approved)

    // --- VIP WELCOME MESSAGE ---
    const welcomeSettings = loadWelcomeSettings();
    if (!welcomeSettings.vip) return; // welcome messages disabled for VIP channel
    const botStartUrl = cachedBotUsername ? `https://t.me/${cachedBotUsername}?start=vip` : frontendUrl;
    try {
        const res = await sendMessage(chatId,
            `Hi ${userMention}! Welcome to the exclusive channel baby 🔥😘💋\n\n` +
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
            addToWelcomeStore(chatId, res.result.message_id, 'vip');
        }
    } catch (e) {
        console.error(`[BOT] VIP welcome failed for ${userId}:`, e.message);
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

        for (const adminId of ADMIN_IDS) {
            try {
                await sendMessage(adminId,
                    `💳 <b>VIP Payment Screenshot Received</b>\n\n` +
                    `👤 Name: ${fullName}\n` +
                    `🔖 Username: ${username}\n` +
                    `🆔 User ID: <code>${userId}</code>\n\n` +
                    `Tap <b>Approve</b> to activate subscription &amp; send invite link automatically.`,
                    { inline_keyboard: [
                        [{ text: '✅ Approve — Activate & Send Link', callback_data: `approve_payment_${userId}_${message.from.username || ''}` }],
                        [{ text: '❌ Reject', callback_data: `reject_payment_${userId}` }]
                    ]}
                );
                await callTelegramAPI('copyMessage', {
                    chat_id: adminId,
                    from_chat_id: message.chat.id,
                    message_id: message.message_id
                });
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
                        [{ text: '💎 Buy VIP Subscription', callback_data: 'vip_qr' }],
                        [{ text: '✅ Check My Subscription', callback_data: 'check_status' }],
                        [{ text: '🔄 Renew Subscription', callback_data: 'renew_status' }],
                        [{ text: '🔓 Join VIP Channel', callback_data: 'renew_status' }],
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
            `👑 <b>Admin Panel</b>\n\nChoose an action or use a command:`,
            {
                inline_keyboard: [
                    [{ text: '📊 Stats', callback_data: 'admin_stats' }, { text: '📋 Active VIP', callback_data: 'admin_subscribers' }],
                    [{ text: '🔴 Non-VIP Users', callback_data: 'admin_nonvip' }, { text: '🕐 Expired', callback_data: 'admin_expired' }],
                    [{ text: '📢 Post to VIP Channel', callback_data: 'admin_post_vip' }],
                    [{ text: '📣 Post to Public Channel', callback_data: 'admin_post_public' }],
                    [{ text: '🔔 Toggle Welcome Messages', callback_data: 'admin_welcome' }],
                    [{ text: '❓ All Commands', callback_data: 'admin_help' }]
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
        let msg = `📋 <b>Active Subscribers (${subs.length})</b>\n\n`;
        for (const s of subs.slice(0, 30)) {
            const expires = new Date(s.expires_at);
            const daysLeft = Math.max(0, Math.ceil((expires - Date.now()) / (1000 * 60 * 60 * 24)));
            const name = s.telegram_username || s.phone || `ID:${s.telegram_user_id}` || `#${s.id}`;
            msg += `• ${name} — ${daysLeft}d left (₹${s.amount})\n`;
        }
        if (subs.length > 30) msg += `\n... and ${subs.length - 30} more`;
        await sendMessage(chatId, msg);
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
        let st = { total: 0, active: 0, cancelled: 0, expired: 0, revenue: 0, totalRevenue: 0 };
        if (subs) {
            const nowTime = new Date();
            subs.forEach(s => {
                st.total++;
                st.totalRevenue += s.amount || 0;
                if (s.status === 'active' && new Date(s.expires_at) > nowTime) {
                    st.active++;
                    st.revenue += s.amount || 0;
                }
                if (s.status === 'cancelled') st.cancelled++;
                if (s.status === 'expired') st.expired++;
            });
        }
        const nonVip = st.total - st.active;

        // Also fetch channel counts from Telegram
        let vipCount = '', publicCount = '';
        try {
            if (CHANNEL_ID) {
                const r = await callTelegramAPI('getChatMemberCount', { chat_id: CHANNEL_ID });
                if (r.ok) vipCount = ` (${r.result} in channel)`;
            }
        } catch (_) {}
        try {
            if (PUBLIC_CHANNEL_ID) {
                const r = await callTelegramAPI('getChatMemberCount', { chat_id: PUBLIC_CHANNEL_ID });
                if (r.ok) publicCount = `\n📣 Public channel members: ${r.result}`;
            }
        } catch (_) {}

        await sendMessage(chatId,
            `📊 <b>Full Stats</b>\n\n` +
            `💎 <b>VIP (Active):</b> ${st.active}${vipCount}\n` +
            `🔴 <b>Non-VIP (Expired/Cancelled):</b> ${nonVip}\n` +
            `🕐 Expired: ${st.expired}\n` +
            `❌ Cancelled: ${st.cancelled}\n` +
            `👥 Total known users: ${st.total}${publicCount}\n\n` +
            `💰 Active MRR: ₹${st.revenue.toLocaleString()}\n` +
            `💵 Lifetime revenue: ₹${st.totalRevenue.toLocaleString()}`
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
        if (target !== 'vip' && target !== 'public') {
            await sendMessage(chatId, '❌ Target must be <b>vip</b> or <b>public</b>.\nExample: <code>/post vip Hello everyone!</code>');
            return;
        }
        const targetChannelId = target === 'vip' ? CHANNEL_ID : PUBLIC_CHANNEL_ID;
        if (!targetChannelId) {
            await sendMessage(chatId, `❌ ${target.toUpperCase()} channel not configured.`);
            return;
        }
        try {
            const { postToVipChannel, postToPublicChannel } = require('./telegram');
            const result = target === 'vip' ? await postToVipChannel(msgText) : await postToPublicChannel(msgText);
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
            `/stats — Full stats (VIP, non-VIP, revenue)\n` +
            `/subscribers — List active VIP subscribers\n` +
            `/nonvip — List expired &amp; cancelled users\n` +
            `/expired — List expired/cancelled (short list)\n` +
            `/search &lt;username/phone&gt; — Look up a user\n\n` +
            `<b>📢 Messaging</b>\n` +
            `/post vip &lt;msg&gt; — Post to VIP channel\n` +
            `/post public &lt;msg&gt; — Post to public channel\n` +
            `/broadcast &lt;msg&gt; — DM all active subscribers\n\n` +
            `<b>⚙️ Management</b>\n` +
            `/extend &lt;username&gt; &lt;days&gt; — Add days to a sub\n` +
            `/kick &lt;username/phone/id&gt; — Kick &amp; cancel user\n` +
            `/setqr — Upload/update VIP payment QR\n` +
            `/showqr — Preview saved VIP QR\n` +
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

    if (data === 'check_status') {
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
                `✅ <b>Active Subscription Found</b>\n\n` +
                `📅 Expires: ${expires.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n` +
                `⏳ Days left: <b>${daysLeft}</b>`
            );
        } else {
            await sendMessage(chatId,
                '❌ No active subscription found on this account.\n\nIf you believe this is an error, use Contact Support. Otherwise tap below to get VIP access.',
                { inline_keyboard: [[{ text: '💳 Get VIP Access', callback_data: 'vip_qr' }]] }
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
        // Trigger the same logic as /stats
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*');
        let st = { total: 0, active: 0, cancelled: 0, expired: 0, revenue: 0, totalRevenue: 0 };
        if (subs) {
            const nowTime = new Date();
            subs.forEach(s => {
                st.total++;
                st.totalRevenue += s.amount || 0;
                if (s.status === 'active' && new Date(s.expires_at) > nowTime) { st.active++; st.revenue += s.amount || 0; }
                if (s.status === 'cancelled') st.cancelled++;
                if (s.status === 'expired') st.expired++;
            });
        }
        let vipCount = '', publicCount = '';
        try { if (CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: CHANNEL_ID }); if (r.ok) vipCount = ` (${r.result} in channel)`; } } catch (_) {}
        try { if (PUBLIC_CHANNEL_ID) { const r = await callTelegramAPI('getChatMemberCount', { chat_id: PUBLIC_CHANNEL_ID }); if (r.ok) publicCount = `\n📣 Public channel members: ${r.result}`; } } catch (_) {}
        await sendMessage(chatId,
            `📊 <b>Full Stats</b>\n\n` +
            `💎 <b>VIP (Active):</b> ${st.active}${vipCount}\n` +
            `🔴 <b>Non-VIP (Expired/Cancelled):</b> ${st.total - st.active}\n` +
            `🕐 Expired: ${st.expired}  ❌ Cancelled: ${st.cancelled}\n` +
            `👥 Total known users: ${st.total}${publicCount}\n\n` +
            `💰 Active MRR: ₹${st.revenue.toLocaleString()}\n` +
            `💵 Lifetime revenue: ₹${st.totalRevenue.toLocaleString()}`
        );

    } else if (data === 'admin_subscribers' && isAdmin(userId)) {
        const now2 = new Date().toISOString();
        const { data: subs } = await supabase.from('prachi_subscriptions').select('*').eq('status', 'active').gt('expires_at', now2).order('expires_at', { ascending: true });
        if (!subs || subs.length === 0) { await sendMessage(chatId, '📋 No active subscribers.'); return; }
        let msg = `📋 <b>Active VIP Subscribers (${subs.length})</b>\n\n`;
        for (const s of subs.slice(0, 30)) {
            const daysLeft = Math.max(0, Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000));
            msg += `• ${s.telegram_username || s.phone || `ID:${s.telegram_user_id}`} — ${daysLeft}d left (₹${s.amount})\n`;
        }
        if (subs.length > 30) msg += `\n...and ${subs.length - 30} more`;
        await sendMessage(chatId, msg);

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

    } else if (data === 'admin_post_vip' && isAdmin(userId)) {
        await sendMessage(chatId, `📢 <b>Post to VIP Channel</b>\n\nSend your message using:\n<code>/post vip Your message here</code>\n\nSupports HTML formatting: <b>bold</b>, <i>italic</i>, <a href='...'>links</a>`);

    } else if (data === 'admin_post_public' && isAdmin(userId)) {
        await sendMessage(chatId, `📣 <b>Post to Public Channel</b>\n\nSend your message using:\n<code>/post public Your message here</code>\n\nSupports HTML formatting: <b>bold</b>, <i>italic</i>, <a href='...'>links</a>`);

    } else if (data === 'admin_help' && isAdmin(userId)) {
        await sendMessage(chatId,
            `🤖 <b>All Admin Commands</b>\n\n` +
            `<b>📊 Stats & Users</b>\n` +
            `/stats — Full stats (VIP, non-VIP, revenue)\n` +
            `/subscribers — Active VIP list\n` +
            `/nonvip — Expired &amp; cancelled users\n` +
            `/expired — Short expired list\n` +
            `/search &lt;user&gt; — Look up a user\n\n` +
            `<b>📢 Messaging</b>\n` +
            `/post vip &lt;msg&gt; — Post to VIP channel\n` +
            `/post public &lt;msg&gt; — Post to public channel\n` +
            `/broadcast &lt;msg&gt; — DM all active subs\n\n` +
            `<b>⚙️ Management</b>\n` +
            `/extend &lt;user&gt; &lt;days&gt; — Add days to sub\n` +
            `/kick &lt;user&gt; — Kick &amp; cancel user\n` +
            `/welcome — Toggle welcome messages on/off\n` +
            `/setqr — Upload/update VIP payment QR\n` +
            `/showqr — Preview saved VIP QR\n` +
            `/menu — Quick-action menu`
        );

    } else if (data.startsWith('approve_payment_') && isAdmin(userId)) {
        const parts = data.split('_'); // approve_payment_{userId}_{username}
        const targetUserId = parts[2];
        const targetUsername = parts.slice(3).join('_') || '';

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
            amount: VIP_SUBSCRIPTION_AMOUNT,
            plan: 'monthly',
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
                chat_id: CHANNEL_ID,
                name: `VIP-${targetUserId}`,
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
            await sendMessage(chatId, `❌ Failed to generate invite link. Make sure the bot is an admin in the VIP channel.`);
            return;
        }

        // Send one-time link to user
        try {
            await sendMessage(targetUserId,
                `🎉 <b>Payment Approved! Welcome to VIP!</b>\n\n` +
                `Your subscription is now active for <b>30 days</b>.\n\n` +
                `⚠️ <b>Important:</b> The link below is <b>for you only</b> — it works once and expires in 24 hours. Do not share it.\n\n` +
                `Tap below to join:`,
                { inline_keyboard: [[{ text: '🔓 Join VIP Channel (1-time link)', url: inviteLink }]] }
            );
        } catch (e) {
            await sendMessage(chatId, `⚠️ Approved in DB but couldn't DM user (they may not have started the bot): ${e.message}\n\nManual link: ${inviteLink}`);
            return;
        }

        await sendMessage(chatId, `✅ Approved!\n\n👤 User: ${targetUsername || targetUserId}\n🔗 One-time link sent (expires 24h, single-use).\n📅 Sub active for 30 days.`);

    } else if (data.startsWith('reject_payment_') && isAdmin(userId)) {
        const targetUserId = data.split('_')[2];
        try {
            await sendMessage(targetUserId,
                `❌ <b>Payment Not Verified</b>\n\nWe could not verify your payment. Please contact support if you believe this is a mistake.`,
                { inline_keyboard: [[{ text: '🙋 Contact Support', callback_data: 'contact_support' }]] }
            );
        } catch (_) {}
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
            { command: 'stats', description: '📊 Full stats — VIP, revenue' },
            { command: 'subscribers', description: '📋 Active VIP subscribers' },
            { command: 'nonvip', description: '🔴 Expired & cancelled users' },
            { command: 'expired', description: '🕐 Expired/cancelled (short list)' },
            { command: 'search', description: '🔍 Look up a user' },
            { command: 'approve', description: '✅ Approve user & send invite link' },
            { command: 'addvip', description: '➕ Grant VIP access to user' },
            { command: 'extend', description: '📅 Add days to a subscription' },
            { command: 'kick', description: '👢 Kick & cancel a user' },
            { command: 'broadcast', description: '📢 DM all active subscribers' },
            { command: 'post', description: '📨 Post to VIP or public channel' },
            { command: 'welcome', description: '📢 Toggle welcome messages on/off' },
            { command: 'setqr', description: '🖼 Upload VIP payment QR image' },
            { command: 'showqr', description: '🧾 Preview current VIP QR' },
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

module.exports = { pollUpdates, stopPolling };
