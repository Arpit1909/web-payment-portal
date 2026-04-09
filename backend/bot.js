const supabase = require('./database');
const { callTelegramAPI, kickUser, sendMessage } = require('./telegram');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);

let lastUpdateId = 0;
let polling = false;

function isAdmin(userId) {
    return ADMIN_IDS.includes(String(userId));
}

async function handleNewChatMember(update) {
    const msg = update.chat_member || update.message;
    if (!msg) return;

    let userId, username, chatId;

    if (update.chat_member) {
        const newMember = update.chat_member.new_chat_member;
        if (!newMember || newMember.status === 'left' || newMember.status === 'kicked') return;
        userId = newMember.user.id;
        username = newMember.user.username || '';
        chatId = update.chat_member.chat.id;
    } else if (msg.new_chat_members) {
        for (const member of msg.new_chat_members) {
            if (member.is_bot) continue;
            userId = member.id;
            username = member.username || '';
            chatId = msg.chat.id;
        }
    }

    if (!userId || String(chatId) !== String(CHANNEL_ID)) return;

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
            console.log(`[BOT] Unverified user joined: ${username || userId} — kicking`);
            try {
                await kickUser(userId);
                await sendMessage(userId,
                    '🚫 You do not have an active subscription.\n\nPlease purchase a subscription first to access the private channel.'
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
        console.log(`[BOT] Verified user joined: ${username || userId} (sub #${sub.id})`);
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
        if (text === '/start') {
            await sendMessage(chatId,
                '👋 Welcome! This bot manages subscriptions for the VIP channel.\n\n' +
                'If you have fully paid on the website, you will automatically be approved when you click the invite link.\n\n' +
                '📞 <b>Need Help?</b> Just reply in this chat and an admin will assist you directly!'
            );
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

    else if (text === '/help') {
        await sendMessage(chatId,
            `🤖 <b>Admin Commands</b>\n\n` +
            `/subscribers — List active subscribers\n` +
            `/expired — List expired/cancelled subs\n` +
            `/stats — Subscription statistics\n` +
            `/broadcast <message> — Send DM to all active subs\n` +
            `/kick <username/phone/id> — Kick & cancel user\n` +
            `/help — Show this message`
        );
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
        await callTelegramAPI('getMe');
        console.log('[BOT] Bot connected successfully');
    } catch (e) {
        console.error('[BOT] Failed to connect:', e.message);
        return;
    }

    while (polling) {
        try {
            const result = await callTelegramAPI('getUpdates', {
                offset: lastUpdateId + 1,
                timeout: 30,
                allowed_updates: ['message', 'chat_member']
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
