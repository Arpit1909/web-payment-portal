const supabase = require('./database');
const { callTelegramAPI, kickUser, sendMessage, deleteMessage } = require('./telegram');
require('dotenv').config();

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
    const userMention = username ? `@${username}` : `<a href="tg://user?id=${userId}">${firstName || 'New member'}</a>`;

    // --- PUBLIC CHANNEL: send welcome with website link ---
    if (matchesChannel(chatId, PUBLIC_CHANNEL_ID) || matchesChannel(chatUsername, PUBLIC_CHANNEL_ID)) {
        console.log(`[BOT] User @${username || userId} joined public channel`);
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
                        [{ text: '🔓 Get VIP Access', url: frontendUrl }]
                    ]
                }
            );
            if (res.ok && res.result) welcomeMessageIds.set(`${userId}_${chatId}`, res.result.message_id);
        } catch (e) {
            console.error(`[BOT] Public welcome failed for ${userId}:`, e.message);
        }
        return;
    }

    // --- VIP CHANNEL: verify subscription then send welcome ---
    if (!matchesChannel(chatId, CHANNEL_ID)) return;

    const now = new Date().toISOString();

    const { data: sub } = await supabase.from('prachi_subscriptions')
        .select('*')
        .or(`telegram_user_id.eq.${userId},telegram_username.eq.${username ? '@'+username : '__no_match__'}`)
        .eq('status', 'active')
        .gt('expires_at', now)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!sub) {
        const { data: subByUsername } = await supabase.from('prachi_subscriptions')
            .select('*')
            .eq('telegram_username', username || '')
            .eq('status', 'active')
            .gt('expires_at', now)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!subByUsername) {
            console.log(`[BOT] Unverified user joined VIP: ${username || userId} — kicking`);
            try {
                await kickUser(userId);
                await sendMessage(userId,
                    '🚫 You do not have an active subscription.\n\nPlease purchase a subscription first to access the private channel.',
                    { inline_keyboard: [[{ text: '💳 Get Access', url: frontendUrl }]] }
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

    // --- VIP WELCOME MESSAGE ---
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
        if (res.ok && res.result) welcomeMessageIds.set(`${userId}_${chatId}`, res.result.message_id);
    } catch (e) {
        console.error(`[BOT] VIP welcome failed for ${userId}:`, e.message);
    }
}

async function handleSupportTicket(message) {
    if (message.chat.type !== 'private') return; // only DM
    const userId = message.from.id;

    if (isAdmin(userId)) {
        // Allow admin to reply
        if (message.reply_to_message && message.reply_to_message.text) {
            const ticketMatch = message.reply_to_message.text.match(/\[Ticket UserID: (\d+)\]/);
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

    // Normal user creates ticket
    for (const adminId of ADMIN_IDS) {
        try {
            await sendMessage(adminId, `📩 <b>Support Ticket from @${message.from.username || message.from.first_name}</b>\n[Ticket UserID: ${userId}]\n\n<i>Swipe right on the message below to reply to them anonymously.</i>`);
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
            const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
            await sendMessage(chatId,
                `👋 <b>Welcome to the VIP Bot!</b>\n\n` +
                `I'm here to help you with your exclusive subscription. Here's what I can do for you:\n\n` +
                `✅ Check if your subscription is active\n` +
                `⏳ See your expiry date & days remaining\n` +
                `💳 Help you renew your subscription\n` +
                `🙋 Connect you with support\n\n` +
                `Tap a button below to get started 👇`,
                {
                    inline_keyboard: [
                        [{ text: '✅ Check My Subscription', callback_data: 'check_status' }],
                        [{ text: '💳 Renew / Get Access', url: frontendUrl }],
                        [{ text: '🔄 Renew Status & Link', callback_data: 'renew_status' }],
                        [{ text: '🙋 Contact Support', callback_data: 'contact_support' }]
                    ]
                }
            );
        } else if (text === '/renew') {
            const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
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
                    `Tap below to renew before it expires! 💳`,
                    { inline_keyboard: [[{ text: '💳 Renew Now', url: frontendUrl }]] }
                );
            } else {
                await sendMessage(chatId,
                    '❌ No active subscription found.\n\nGet access from the website below!',
                    { inline_keyboard: [[{ text: '💳 Get Access', url: frontendUrl }]] }
                );
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

    if (text === '/start' || text.startsWith('/start ')) {
        await sendMessage(chatId,
            `👑 <b>Admin Panel — Bot Commands</b>\n\n` +
            `📋 /subscribers — List all active VIP members\n` +
            `🕐 /expired — List expired &amp; cancelled subs\n` +
            `📊 /stats — Revenue &amp; subscriber statistics\n` +
            `📢 /broadcast &lt;msg&gt; — DM all active subscribers\n` +
            `👢 /kick &lt;username/phone&gt; — Kick &amp; cancel a user\n` +
            `➕ /extend &lt;username&gt; &lt;days&gt; — Add days to a sub\n` +
            `🔍 /search &lt;username/phone&gt; — Look up a user\n` +
            `❓ /help — Show this message again`
        );
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
        let st = { total: 0, active: 0, cancelled: 0, expired: 0, revenue: 0 };
        if (subs) {
            const nowTime = new Date();
            subs.forEach(s => {
                st.total++;
                if (s.status === 'active' && new Date(s.expires_at) > nowTime) {
                    st.active++;
                    st.revenue += s.amount || 0;
                }
                if (s.status === 'cancelled') st.cancelled++;
                if (s.status === 'expired') st.expired++;
            });
        }
        await sendMessage(chatId,
            `📊 <b>Subscription Stats</b>\n\n` +
            `👥 Total: ${st.total}\n` +
            `✅ Active: ${st.active}\n` +
            `🕐 Expired: ${st.expired}\n` +
            `❌ Cancelled: ${st.cancelled}\n` +
            `💰 Active revenue: ₹${st.revenue}`
        );
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

    else if (text === '/help') {
        await sendMessage(chatId,
            `🤖 <b>Admin Commands</b>\n\n` +
            `/subscribers — List active subscribers\n` +
            `/expired — List expired/cancelled subs\n` +
            `/nonvip — List all non-VIP (expired/cancelled) users\n` +
            `/stats — Subscription statistics\n` +
            `/broadcast <message> — DM all active subs\n` +
            `/kick <username/phone/id> — Kick & cancel user\n` +
            `/extend <username> <days> — Add days to a sub\n` +
            `/search <username/phone> — Look up a user\n` +
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
            const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
            await sendMessage(chatId,
                '❌ No active subscription found on this account.\n\nIf you believe this is an error, use the Contact Support button. Otherwise, grab your subscription from the website below!',
                { inline_keyboard: [[{ text: '🛒 Open Website', url: frontendUrl }]] }
            );
        }
    } else if (data === 'renew_status') {
        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
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
                `⏳ Days left: <b>${daysLeft}</b>\n\nTap below to renew! 💳`,
                { inline_keyboard: [[{ text: '💳 Renew Now', url: frontendUrl }]] }
            );
        } else {
            await sendMessage(chatId, '❌ No active subscription found.',
                { inline_keyboard: [[{ text: '💳 Get Access', url: frontendUrl }]] }
            );
        }
    } else if (data === 'contact_support') {
        await sendMessage(chatId, '📩 Please type your question or request below. An admin will reply to you as soon as possible!');
    } else if (data === 'top_content') {
        const channelInvite = process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/c/YOUR_VIP_CHANNEL';
        await sendMessage(chatId, 
            "🔥 <b>Must-Watch VIP Content</b>\n\n" +
            "Here are the most highly-rated exclusive videos from the vault. Enjoy!\n\n" +
            `1️⃣ <a href='${channelInvite}'>Red Dress Exclusive</a>\n` +
            `2️⃣ <a href='${channelInvite}'>Behind The Scenes Vlog</a>\n` +
            `3️⃣ <a href='${channelInvite}'>Private Q&A Session</a>\n\n` +
            "<i>(Note: You must be an active subscriber to view these links!)</i>"
        );
    } else if (data === 'rate_5' || data === 'rate_3') {
        await sendMessage(chatId, "Thank you so much! 💖\n\nCould you write a quick 1-sentence review here in the chat? We'd love to share your feedback anonymously on our website.\n\nJust type it below and we will receive it:");
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
