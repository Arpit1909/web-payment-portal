const db = require('./database');
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

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
    });
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

    const sub = await dbGet(
        `SELECT * FROM subscriptions WHERE (telegram_user_id = ? OR telegram_username = ?)
         AND status = 'active' AND expires_at > datetime('now')
         ORDER BY id DESC LIMIT 1`,
        [String(userId), username ? `@${username}` : `__no_match__`]
    );

    if (!sub) {
        const subByUsername = await dbGet(
            `SELECT * FROM subscriptions WHERE telegram_username = ?
             AND status = 'active' AND expires_at > datetime('now')
             ORDER BY id DESC LIMIT 1`,
            [username]
        );

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

        await dbRun(
            `UPDATE subscriptions SET telegram_user_id = ? WHERE id = ?`,
            [String(userId), subByUsername.id]
        );
        console.log(`[BOT] Linked telegram_user_id ${userId} to subscription #${subByUsername.id}`);
    } else {
        if (!sub.telegram_user_id) {
            await dbRun(`UPDATE subscriptions SET telegram_user_id = ? WHERE id = ?`, [String(userId), sub.id]);
        }
        console.log(`[BOT] Verified user joined: ${username || userId} (sub #${sub.id})`);
    }
}

async function handleCommand(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = (message.text || '').trim();

    if (!isAdmin(userId)) {
        if (text === '/start') {
            await sendMessage(chatId,
                '👋 Welcome! This bot manages subscriptions for the private channel.\n\n' +
                'After you pay on the website, you\'ll get a link to join the channel automatically.'
            );
        } else if (text === '/status') {
            const sub = await dbGet(
                `SELECT * FROM subscriptions WHERE telegram_user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
                [String(userId)]
            );
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

    if (text === '/subscribers' || text === '/subs') {
        const subs = await dbAll(
            `SELECT * FROM subscriptions WHERE status = 'active' AND expires_at > datetime('now') ORDER BY expires_at ASC`
        );
        if (subs.length === 0) {
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
        const expired = await dbAll(
            `SELECT * FROM subscriptions WHERE status IN ('expired', 'cancelled') ORDER BY id DESC LIMIT 20`
        );
        if (expired.length === 0) {
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
        const rows = await dbAll(`SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' AND expires_at > datetime('now') THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
            SUM(CASE WHEN status = 'active' AND expires_at > datetime('now') THEN amount ELSE 0 END) as revenue
        FROM subscriptions`);
        const st = rows[0] || {};
        await sendMessage(chatId,
            `📊 <b>Subscription Stats</b>\n\n` +
            `👥 Total: ${st.total || 0}\n` +
            `✅ Active: ${st.active || 0}\n` +
            `🕐 Expired: ${st.expired || 0}\n` +
            `❌ Cancelled: ${st.cancelled || 0}\n` +
            `💰 Active revenue: ₹${st.revenue || 0}`
        );
    }

    else if (text.startsWith('/kick ')) {
        const target = text.replace('/kick ', '').trim();
        const sub = await dbGet(
            `SELECT * FROM subscriptions WHERE telegram_username = ? OR telegram_user_id = ? OR phone = ? ORDER BY id DESC LIMIT 1`,
            [target, target, target]
        );
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
        const now = new Date().toISOString();
        await dbRun(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, kicked_at = ? WHERE id = ?`, [now, now, sub.id]);
        await sendMessage(chatId, `✅ Kicked & cancelled: ${sub.telegram_username || sub.phone || sub.id}`);
    }

    else if (text === '/help') {
        await sendMessage(chatId,
            `🤖 <b>Admin Commands</b>\n\n` +
            `/subscribers — List active subscribers\n` +
            `/expired — List expired/cancelled subs\n` +
            `/stats — Subscription statistics\n` +
            `/kick &lt;username/phone/id&gt; — Kick & cancel user\n` +
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

    // Enable chat_member updates
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
