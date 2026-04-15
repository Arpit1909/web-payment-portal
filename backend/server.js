const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const supabase = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const sharp = require('sharp');
const { execFile } = require('child_process');
const telegram = require('./telegram');
const imbpay = require('./imbpay');
const { pollUpdates } = require('./bot');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || 'supersecretkey123';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin@example.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(cors({ origin: [FRONTEND_URL, `http://localhost:${PORT}`], credentials: true }));
app.use(express.json());

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage });
// Serve static upload files
app.use('/uploads', express.static('uploads'));

// --- PUBLIC ROUTES (Frontend Portal) ---

// 1. Get current public offer and settings API
app.get('/api/public/data', async (req, res) => {
    try {
        const [
            { data: offer },
            { data: settings },
            { data: previews },
            { count: activeCount }
        ] = await Promise.all([
            supabase.from('prachi_offers').select('*').eq('is_active', 1).order('id', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('prachi_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('prachi_previews').select('*').order('order_index', { ascending: true }),
            supabase.from('prachi_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active')
        ]);
        
        res.json({
            offer: offer || {},
            settings: settings || {},
            upi_id: settings ? settings.upi_id : '',
            previews: previews || [],
            active_members_count: activeCount || 0,
            bot_username: process.env.TELEGRAM_BOT_USERNAME || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. IMB — Create a payment order
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
function getVipEntryUrl(fallbackUrl = FRONTEND_URL) {
    const envBotUsername = (process.env.TELEGRAM_BOT_USERNAME || 'manager_keshavs_bot').replace(/^@/, '').trim();
    return envBotUsername ? `https://t.me/${envBotUsername}?start=vip` : fallbackUrl;
}

function createBlurredTeaserVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const args = [
            '-y',
            '-i', inputPath,
            '-vf', 'scale=iw*0.85:ih*0.85,boxblur=20:10,eq=brightness=-0.04:saturation=0.82',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '30',
            '-an',
            outputPath
        ];

        execFile(FFMPEG_PATH, args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message || 'ffmpeg failed'));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

app.post('/api/payment/create', async (req, res) => {
    const { phone, telegramUsername, buyerName, email } = req.body;

    if (!phone || phone.length < 10) {
        return res.status(400).json({ error: 'Valid phone number is required' });
    }

    try {
        const { data: offer, error: err } = await supabase.from('prachi_offers').select('*').eq('is_active', 1).order('id', { ascending: false }).limit(1).maybeSingle();
        if (err) return res.status(500).json({ error: err.message });

        const amount = offer ? offer.discounted_price : 399;
        const orderId = `PRACHI_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        const order = await imbpay.createOrder({
            orderId,
            amount,
            phone,
            name: buyerName || '',
            email: email || '',
            webhookUrl: `${BACKEND_URL}/api/payment/webhook`,
            redirectUrl: `${FRONTEND_URL}/payment/callback?oid=${orderId}`
        });

        await supabase.from('prachi_subscriptions').insert({
            telegram_username: telegramUsername || '',
            phone,
            transaction_id: orderId,
            amount,
            plan: 'monthly',
            status: 'pending'
        });

        res.json({
            success: true,
            payment_url: order.paymentUrl,
            qr_code: order.qrCode || '',
            upi_string: order.upiString || '',
            order_id: orderId,
            amount
        });
    } catch (e) {
        console.error('[IMB] Create order error:', e.message);
        res.status(500).json({ error: 'Payment gateway error. Please try again.' });
    }
});

// 2b. IMB — Webhook (server-to-server callback after payment)
app.post('/api/payment/webhook', (req, res) => {
    console.log('[IMB Webhook] Body:', JSON.stringify(req.body));
    res.status(200).send('OK'); // Always respond 200 immediately

    const body = req.body;
    // IMB sends order_id and status in various field names — handle all
    const orderId = body.order_id || body.orderId || body.merchant_order_id || '';
    const txnId   = body.transaction_id || body.txn_id || body.utr || body.utr_no || '';
    const rawStatus = (body.status || body.payment_status || body.txn_status || '').toUpperCase();
    const isPaid = ['SUCCESS', 'PAID', 'COMPLETED', 'CREDIT'].includes(rawStatus);

    if (!orderId || !isPaid) return;

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    (async () => {
        const { data: updatedSub, error: updateErr } = await supabase
            .from('prachi_subscriptions')
            .update({ status: 'active', expires_at: expiresAt, started_at: now })
            .eq('transaction_id', orderId)
            .eq('status', 'pending')
            .select()
            .maybeSingle();

        if (updateErr) { console.error('[Webhook] DB error:', updateErr.message); return; }
        if (!updatedSub) { console.log('[Webhook] No pending sub found for order:', orderId); return; }

        console.log(`[Webhook] Activated subscription #${updatedSub.id} for order ${orderId}`);

        await supabase.from('prachi_payment_logs').insert({
            subscription_id: updatedSub.id,
            transaction_id: txnId || orderId,
            amount: updatedSub.amount,
            status: 'success',
            paid_at: now
        });

        // Notify admins on Telegram
        if (process.env.TELEGRAM_BOT_TOKEN) {
            const adminIds = (process.env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
            const expiryFormatted = new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            for (const adminId of adminIds) {
                try {
                    await telegram.sendMessage(adminId,
                        `💰 <b>New Subscriber!</b>\n\n` +
                        `📱 Phone: ${updatedSub.phone || 'N/A'}\n` +
                        `👤 Telegram: ${updatedSub.telegram_username || 'N/A'}\n` +
                        `💳 Amount: ₹${updatedSub.amount}\n` +
                        `🆔 Order: ${orderId}\n` +
                        `📅 Expires: ${expiryFormatted}`
                    );
                } catch (_) {}
            }
        }
    })();
});

// 2c. IMB — Check order status (called by frontend callback page + polling)
app.get('/api/payment/status/:orderId', async (req, res) => {
    const { orderId } = req.params;

    try {
        const getInviteUrl = async () => {
            let url = 'https://t.me/placeholder';
            const { data: settings } = await supabase.from('prachi_settings').select('telegram_channel_url').order('id', { ascending: false }).limit(1).maybeSingle();
            if (settings) url = settings.telegram_channel_url;
            if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
                try {
                    const linkRes = await telegram.createInviteLink(86400);
                    if (linkRes.ok && linkRes.result) url = linkRes.result.invite_link;
                } catch (_) {}
            }
            return url;
        };

        // First check our DB — webhook may have already activated it
        const { data: sub } = await supabase.from('prachi_subscriptions').select('*').eq('transaction_id', orderId).maybeSingle();

        if (sub && sub.status === 'active') {
            return res.json({ success: true, telegram_url: await getInviteUrl(), expires_at: sub.expires_at });
        }

        // DB not updated yet — ask IMB directly
        const imb = await imbpay.checkOrderStatus(orderId);

        if (!imb.paid) {
            return res.json({ success: false, reason: `Payment status: ${imb.status}` });
        }

        // IMB says paid but DB not updated — activate now
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data: updatedSub } = await supabase
            .from('prachi_subscriptions')
            .update({ status: 'active', expires_at: expiresAt, started_at: now })
            .eq('transaction_id', orderId)
            .eq('status', 'pending')
            .select()
            .maybeSingle();

        if (updatedSub) {
            await supabase.from('prachi_payment_logs').insert({
                subscription_id: updatedSub.id,
                transaction_id: imb.transactionId || orderId,
                amount: updatedSub.amount,
                status: 'success',
                paid_at: now
            });
            // Notify admins of new subscriber
        }

        res.json({ success: true, telegram_url: await getInviteUrl(), expires_at: expiresAt });
    } catch (e) {
        console.error('[IMB] Status check error:', e.message);
        res.status(500).json({ success: false, error: 'Status check failed' });
    }
});

// 3. Check subscription status (public)
app.get('/api/public/subscription/:phone', async (req, res) => {
    const { data: sub, error } = await supabase
        .from('prachi_subscriptions')
        .select('*')
        .eq('phone', req.params.phone)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
    
    if (error) return res.status(500).json({ error: error.message });
    if (!sub) return res.json({ active: false });
    const isActive = sub.status === 'active' && new Date(sub.expires_at) > new Date();
    res.json({ active: isActive, expires_at: sub.expires_at, status: sub.status });
});

// --- ADMIN ROUTES (Secured) ---

// Middleware: Authenticate Admin JWT
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    
    try {
        const verified = jwt.verify(token.split(' ')[1], SECRET_KEY);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ error: 'Invalid token' });
    }
};

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    const { data: user, error } = await supabase.from('prachi_users').select('*').eq('username', username).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    
    if (!user) {
        if (username === ADMIN_USERNAME) {
            const hash = await bcrypt.hash(password, 10);
            await supabase.from('prachi_users').insert({ username: ADMIN_USERNAME, password_hash: hash });
            const token = jwt.sign({ username: ADMIN_USERNAME }, SECRET_KEY, { expiresIn: '1d' });
            return res.json({ token });
        }
        return res.status(400).json({ error: 'User not found' });
    }
    
    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) return res.status(400).json({ error: 'Invalid password' });
    
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1d' });
    res.json({ token });
});

// Update Offer
app.put('/api/admin/offer', verifyToken, async (req, res) => {
    const { original_price, discounted_price, timer_end_date } = req.body;
    
    const { data: latest } = await supabase.from('prachi_offers').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
    if (latest) {
        const { error } = await supabase.from('prachi_offers').update({ original_price, discounted_price, timer_end_date }).eq('id', latest.id);
        if (error) return res.status(500).json({ error: error.message });
    } else {
        await supabase.from('prachi_offers').insert({ original_price, discounted_price, timer_end_date });
    }
    res.json({ success: true });
});

// Get Settings
app.get('/api/admin/settings', verifyToken, async (req, res) => {
    const { data: settings, error } = await supabase.from('prachi_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json(settings || {});
});

// Update Settings
app.put('/api/admin/settings', verifyToken, async (req, res) => {
    const updateData = req.body;
    // Fetch full existing row so we know which columns actually exist
    const { data: latest } = await supabase.from('prachi_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle();

    if (latest) {
        // Only include keys that already exist in the table (prevents "column does not exist" errors)
        const safeUpdate = {};
        for (const key of Object.keys(updateData)) {
            if (key in latest) safeUpdate[key] = updateData[key];
        }
        const { error } = await supabase.from('prachi_settings').update(safeUpdate).eq('id', latest.id);
        if (error) return res.status(500).json({ error: error.message });
    } else {
        await supabase.from('prachi_settings').insert(updateData);
    }
    res.json({ success: true });
});

// Upload media
app.post('/api/admin/upload', verifyToken, upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// Previews CRUD
app.get('/api/admin/previews', verifyToken, async (req, res) => {
    const { data: previews, error } = await supabase.from('prachi_previews').select('*').order('order_index', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(previews || []);
});

app.post('/api/admin/previews', verifyToken, async (req, res) => {
    const { title, caption, vipCaption, publicCaption, url, type, is_locked, order_index, postDestination } = req.body;
    // postDestination: 'vip' | 'public' | 'none'
    const safeCaption = (caption || title || '').toString().trim();
    const safeVipCaption = (vipCaption || safeCaption || title || '').toString().trim();
    const safePublicCaption = (publicCaption || safeCaption || title || '').toString().trim();

    const { data, error } = await supabase.from('prachi_previews').insert({
        title: safeVipCaption || safeCaption || 'Uploaded Media', url, type: type || 'image', is_locked: is_locked !== undefined ? is_locked : 1, order_index: order_index || 0
    }).select().maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    const dest = postDestination || 'none';

    if (dest !== 'none' && process.env.TELEGRAM_BOT_TOKEN) {
        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
        const backendUrl = process.env.BACKEND_URL || frontendUrl;
        const vipEntryUrl = getVipEntryUrl(frontendUrl);
        const isImage = (type || 'image') === 'image';
        const mediaUrl = url ? `${backendUrl}${url}` : '';
        const contentType = isImage ? '📸 New Photo' : '🎬 New Video';
        const vipFallbackCaption = `${contentType} just dropped! 🔥\n\n<i>Enjoy the exclusive content!</i>`;
        const vipPostCaption = safeVipCaption || vipFallbackCaption;
        const publicFallbackCaption = `${contentType} just posted! 🎉`;
        const publicPostCaption = safePublicCaption || publicFallbackCaption;

        (async () => {
            try {
                if (dest === 'vip') {
                    // --- Post actual content to VIP channel ---
                    if (isImage && mediaUrl) {
                        try {
                            await telegram.sendPhotoToVipChannel(mediaUrl, vipPostCaption);
                        } catch (e) {
                            console.error('[POST-VIP] Photo failed, sending text:', e.message);
                            await telegram.postToVipChannel(vipPostCaption).catch(() => {});
                        }
                    } else if (!isImage && mediaUrl) {
                        try {
                            await telegram.sendVideoToVipChannel(mediaUrl, vipPostCaption);
                        } catch (e) {
                            console.error('[POST-VIP] Video failed, sending text:', e.message);
                            await telegram.postToVipChannel(vipPostCaption).catch(() => {});
                        }
                    } else {
                        await telegram.postToVipChannel(vipPostCaption).catch(() => {});
                    }

                    // --- DM all active subscribers: new content alert ---
                    const { data: activeSubs } = await supabase.from('prachi_subscriptions')
                        .select('telegram_user_id')
                        .eq('status', 'active')
                        .gt('expires_at', new Date().toISOString())
                        .not('telegram_user_id', 'is', null);
                    if (activeSubs && activeSubs.length > 0) {
                        for (const s of activeSubs) {
                            try { await telegram.sendMessage(s.telegram_user_id, `🔥 New content just dropped in the channel! Go check it out! 👇`); } catch (_) {}
                            await new Promise(r => setTimeout(r, 50));
                        }
                    }

                    // --- Also post blurred teaser to public channel ---
                    if (process.env.TELEGRAM_PUBLIC_CHANNEL_ID) {
                        const teaserCaption =
                            `${safePublicCaption || `${contentType} just dropped in the VIP Channel!`}\n\n` +
                            `🔒 <b>Exclusive to VIP members only.</b>\n\n` +
                            `👇 Tap below to get access!`;
                        const keyboard = { inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]] };

                        if (isImage && url) {
                            const filename = url.replace('/uploads/', '');
                            const inputPath = path.join('uploads', filename);
                            const blurredFilename = `tease-${Date.now()}-${filename}`;
                            const blurredPath = path.join('uploads', blurredFilename);
                            try {
                                await sharp(inputPath).blur(60).jpeg({ quality: 75 }).toFile(blurredPath);
                                const blurredUrl = `${backendUrl}/uploads/${blurredFilename}`;
                                await telegram.sendTeaserPhoto(blurredUrl, teaserCaption, keyboard);
                                fs.unlink(blurredPath, () => {});
                            } catch (e) {
                                console.error('[POST-VIP] Blur failed, sending text teaser:', e.message);
                                telegram.postToPublicChannel(teaserCaption, keyboard).catch(() => {});
                            }
                        } else if (!isImage && mediaUrl) {
                            const filename = url ? url.replace('/uploads/', '') : '';
                            const inputPath = filename ? path.join('uploads', filename) : '';
                            const teaserFilename = `tease-${Date.now()}-${path.parse(filename || 'video').name}.mp4`;
                            const teaserPath = path.join('uploads', teaserFilename);
                            try {
                                if (!inputPath || !fs.existsSync(inputPath)) {
                                    throw new Error('Original video file not found for teaser generation');
                                }
                                await createBlurredTeaserVideo(inputPath, teaserPath);
                                const teaserUrl = `${backendUrl}/uploads/${teaserFilename}`;
                                await telegram.sendVideoToPublicChannel(teaserUrl, teaserCaption, keyboard);
                                fs.unlink(teaserPath, () => {});
                            } catch (e) {
                                console.error('[POST-VIP] Blurred teaser video failed, sending text:', e.message);
                                telegram.postToPublicChannel(teaserCaption, keyboard).catch(() => {});
                            }
                        } else {
                            telegram.postToPublicChannel(teaserCaption, keyboard).catch(() => {});
                        }
                    }

                } else if (dest === 'public') {
                    // --- Post actual content to public channel (no blur) ---
                    const keyboard = { inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]] };

                    if (isImage && mediaUrl) {
                        try {
                            await telegram.sendTeaserPhoto(mediaUrl, publicPostCaption, keyboard);
                        } catch (e) {
                            console.error('[POST-PUBLIC] Photo failed, sending text:', e.message);
                            telegram.postToPublicChannel(publicPostCaption, keyboard).catch(() => {});
                        }
                    } else if (!isImage && mediaUrl) {
                        try {
                            await telegram.sendVideoToPublicChannel(mediaUrl, publicPostCaption, keyboard);
                        } catch (e) {
                            console.error('[POST-PUBLIC] Video failed, sending text:', e.message);
                            telegram.postToPublicChannel(publicPostCaption, keyboard).catch(() => {});
                        }
                    } else {
                        telegram.postToPublicChannel(publicPostCaption, keyboard).catch(() => {});
                    }
                }
            } catch (e) {
                console.error('[POST-CHANNEL] Unexpected error:', e.message);
            }
        })();
    }

    res.json({ success: true, id: data.id });
});

app.delete('/api/admin/previews/:id', verifyToken, async (req, res) => {
    const { error } = await supabase.from('prachi_previews').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// Mass Broadcast
app.post('/api/admin/broadcast', verifyToken, async (req, res) => {
    const { messageText } = req.body;
    if (!messageText) return res.status(400).json({ error: 'Message text is required' });

    const { data: subs, error } = await supabase
        .from('prachi_subscriptions')
        .select('telegram_user_id')
        .eq('status', 'active')
        .not('telegram_user_id', 'is', null);

    if (error) return res.status(500).json({ error: error.message });

    let sentCount = 0;
    for (const sub of subs) {
        try {
            await telegram.sendMessage(sub.telegram_user_id, messageText);
            sentCount++;
        } catch (err) {
            console.error('[Broadcast] Failed for', sub.telegram_user_id, err.message);
        }
    }

    res.json({ success: true, sentCount, totalActive: subs.length });
});

// --- SUBSCRIPTION MANAGEMENT (Admin) ---

// List all subscriptions
app.get('/api/admin/subscriptions', verifyToken, async (req, res) => {
    const { data: subs, error } = await supabase.from('prachi_subscriptions').select('*').order('id', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(subs || []);
});

// Manually cancel a subscription + kick from channel
app.put('/api/admin/subscriptions/:id/cancel', verifyToken, async (req, res) => {
    const { id } = req.params;
    
    const { data: sub, error } = await supabase.from('prachi_subscriptions').select('*').eq('id', id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    if (sub.telegram_user_id && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
        try {
            await telegram.kickUser(sub.telegram_user_id);
            try {
                await telegram.sendMessage(sub.telegram_user_id,
                    '⚠️ Your subscription has expired. Please renew to continue accessing the private channel.'
                );
            } catch (_) {}
        } catch (e) {
            console.error('Kick error:', e.message);
        }
    }

    const now = new Date().toISOString();
    const { error: err2 } = await supabase.from('prachi_subscriptions').update({ status: 'cancelled', cancelled_at: now, kicked_at: now }).eq('id', id);
    if (err2) return res.status(500).json({ error: err2.message });
    res.json({ success: true });
});

// Manually reactivate a subscription
app.put('/api/admin/subscriptions/:id/reactivate', verifyToken, async (req, res) => {
    const { id } = req.params;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: sub, error } = await supabase.from('prachi_subscriptions').select('*').eq('id', id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    if (sub.telegram_user_id && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
        try {
            await telegram.unbanUser(sub.telegram_user_id);
        } catch (e) {
            console.error('Unban error:', e.message);
        }
    }

    const { error: err2 } = await supabase.from('prachi_subscriptions').update({ status: 'active', expires_at: expiresAt, cancelled_at: null, kicked_at: null }).eq('id', id);
    if (err2) return res.status(500).json({ error: err2.message });
    res.json({ success: true, expires_at: expiresAt });
});

// Get subscription stats
app.get('/api/admin/subscriptions/stats', verifyToken, async (req, res) => {
    const { data: subs, error } = await supabase.from('prachi_subscriptions').select('*');
    if (error) return res.status(500).json({ error: error.message });
    
    let stats = { total: 0, active: 0, cancelled: 0, expired: 0 };
    if (subs) {
        const now = new Date();
        subs.forEach(s => {
            stats.total++;
            if (s.status === 'active' && new Date(s.expires_at) > now) stats.active++;
            if (s.status === 'cancelled') stats.cancelled++;
            if (s.status === 'expired') stats.expired++;
        });
    }
    res.json(stats);
});

// Post promo message to public channel
app.post('/api/admin/post-to-public', verifyToken, async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_PUBLIC_CHANNEL_ID) {
        return res.status(400).json({ error: 'TELEGRAM_PUBLIC_CHANNEL_ID not configured on server' });
    }

    try {
        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
        const vipEntryUrl = getVipEntryUrl(frontendUrl);
        await telegram.postToPublicChannel(message, {
            inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]]
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- CRON: Check expired and expiring subscriptions every hour ---
cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Checking expiring subscriptions...');
    const now = new Date().toISOString();

    // 1. Kick Expired Users
    const { data: expiredSubs } = await supabase
        .from('prachi_subscriptions')
        .select('*')
        .eq('status', 'active')
        .lte('expires_at', now);

    if (expiredSubs && expiredSubs.length > 0) {
        for (const sub of expiredSubs) {
            if (sub.telegram_user_id && process.env.TELEGRAM_BOT_TOKEN) {
                try { await telegram.kickUser(sub.telegram_user_id); } catch (_) {}
                try { await telegram.sendMessage(sub.telegram_user_id, '⚠️ Your monthly subscription has expired.\n\n🔒 Your access to the private channel has been removed.\n\n💳 Renew now to continue enjoying exclusive content!'); } catch (_) {}
            }
            await supabase.from('prachi_subscriptions').update({ status: 'expired', kicked_at: now }).eq('id', sub.id);
        }
    }

    // Helper to find subs expiring in exactly X hours natively
    const notifySubs = async (hoursAway, messageText, replyMarkup = null) => {
        const startWindow = new Date(Date.now() + (hoursAway - 1) * 60 * 60 * 1000).toISOString();
        const endWindow = new Date(Date.now() + hoursAway * 60 * 60 * 1000).toISOString();
        
        const { data: expiringSubs } = await supabase
            .from('prachi_subscriptions')
            .select('*')
            .eq('status', 'active')
            .gte('expires_at', startWindow)
            .lte('expires_at', endWindow)
            .not('telegram_user_id', 'is', null);

        if (expiringSubs && expiringSubs.length > 0) {
            for (const sub of expiringSubs) {
                try {
                    await telegram.sendMessage(sub.telegram_user_id, messageText, replyMarkup);
                } catch (_) {}
            }
        }
    };

    const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const vipEntryUrl = getVipEntryUrl(frontendUrl);
    const renewKeyboard = { inline_keyboard: [[{ text: '💳 Renew Subscription Now', url: vipEntryUrl }]] };

    // 2. Send 3-Day Reminders (72 hours)
    await notifySubs(72, "🔔 <b>Subscription Reminder</b>\n\nYour VIP access expires in exactly <b>3 Days</b>!\n\nPlease renew on the website soon to avoid losing access.", renewKeyboard);
    
    // 3. Send 1-Day Reminders (24 hours)  
    await notifySubs(24, "🚨 <b>Final Reminder!</b>\n\nYour VIP access expires in <b>24 Hours</b>!\n\nRenew your subscription right now to ensure uninterrupted access to the channel!", renewKeyboard);

    // 4. Testimonial Collection (7 days post signup)
    // Find users whose started_at was exactly 7 days ago
    const testStartWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1 * 60 * 60 * 1000).toISOString();
    const testEndWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: testimonialSubs } = await supabase
        .from('prachi_subscriptions')
        .select('*')
        .eq('status', 'active')
        .gte('started_at', testStartWindow)
        .lte('started_at', testEndWindow)
        .not('telegram_user_id', 'is', null);

    if (testimonialSubs && testimonialSubs.length > 0) {
        for (const sub of testimonialSubs) {
            try {
                await telegram.sendMessage(sub.telegram_user_id, 
                    "👋 Hi! You've been in the VIP group for a week now.\n\nAre you enjoying the exclusive videos and photos?",
                    {
                        inline_keyboard: [
                            [{ text: '⭐⭐⭐⭐⭐ (Love it!)', callback_data: 'rate_5' }],
                            [{ text: 'It is okay', callback_data: 'rate_3' }]
                        ]
                    }
                );
            } catch (_) {}
        }
    }
});

// --- CRON: Win-back DM (3 days after expiry, daily at noon) ---
cron.schedule('0 12 * * *', async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const vipEntryUrl = getVipEntryUrl(frontendUrl);
    const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const start = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString();
    const { data: expired } = await supabase.from('prachi_subscriptions')
        .select('*').in('status', ['expired', 'cancelled'])
        .gte('expires_at', start).lte('expires_at', end)
        .not('telegram_user_id', 'is', null);
    if (expired) {
        for (const sub of expired) {
            try {
                await telegram.sendMessage(sub.telegram_user_id,
                    `💔 Hey! We miss you!\n\nYour VIP access expired 3 days ago. Come back and enjoy exclusive content again! 😘\n\n✨ Tap below to rejoin:`,
                    { inline_keyboard: [[{ text: '💳 Come Back!', url: vipEntryUrl }]] }
                );
            } catch (_) {}
        }
    }
    console.log('[CRON] Win-back messages sent');
});

// --- CRON: Loyalty messages (1 month & 3 month anniversaries, daily at 11am) ---
cron.schedule('0 11 * * *', async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    const check = async (days, msg) => {
        const end = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString();
        const { data: subs } = await supabase.from('prachi_subscriptions')
            .select('*').eq('status', 'active')
            .gte('started_at', start).lte('started_at', end)
            .not('telegram_user_id', 'is', null);
        if (subs) {
            for (const sub of subs) {
                try { await telegram.sendMessage(sub.telegram_user_id, msg); } catch (_) {}
            }
        }
    };
    await check(30, `🎉 Happy 1 Month Anniversary!\n\nYou've been part of our VIP family for a full month now! Thank you so much for your support — it means everything! 💖\n\nHope you're enjoying all the exclusive content! 😘`);
    await check(90, `👑 3 Months Strong!\n\nYou've been a loyal VIP member for 3 whole months! You're an absolute legend and we love having you here! 💋🔥\n\nThank you from the bottom of my heart! 💖`);
    console.log('[CRON] Loyalty messages sent');
});

// --- CRON: Daily morning report to admins (9am) ---
cron.schedule('0 9 * * *', async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_ID) return;
    try {
        const nowTime = new Date();
        const nowIso = nowTime.toISOString();
        const todayStart = new Date(nowTime.setHours(0, 0, 0, 0)).toISOString();
        const { data: allSubs } = await supabase.from('prachi_subscriptions').select('*');
        if (!allSubs) return;
        let active = 0, expired = 0, cancelled = 0, revenue = 0, newToday = 0;
        const expiringToday = [];
        allSubs.forEach(s => {
            if (s.status === 'active' && new Date(s.expires_at) > new Date()) {
                active++; revenue += s.amount || 0;
                if (new Date(s.expires_at) < new Date(Date.now() + 24 * 60 * 60 * 1000)) {
                    expiringToday.push(s.telegram_username || s.phone || `#${s.id}`);
                }
            }
            if (s.status === 'expired') expired++;
            if (s.status === 'cancelled') cancelled++;
            if (s.started_at && s.started_at >= todayStart) newToday++;
        });
        const msg =
            `📊 <b>Daily Report — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b>\n\n` +
            `✅ Active: <b>${active}</b>\n` +
            `🆕 New today: <b>${newToday}</b>\n` +
            `🕐 Expired: ${expired} | ❌ Cancelled: ${cancelled}\n` +
            `💰 Active revenue: ₹${revenue}\n` +
            (expiringToday.length > 0 ? `\n⚠️ <b>Expiring in 24h:</b>\n${expiringToday.slice(0, 10).map(n => `• ${n}`).join('\n')}` : `\n✅ No expiries in next 24h`);
        const adminIds = (process.env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
        for (const adminId of adminIds) {
            try { await telegram.sendMessage(adminId, msg); } catch (_) {}
        }
        console.log('[CRON] Daily report sent');
    } catch (e) {
        console.error('[CRON] Daily report failed:', e.message);
    }
});

// --- CRON: Weekly subscriber count post to public channel (every Monday 10am) ---
cron.schedule('0 10 * * 1', async () => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_PUBLIC_CHANNEL_ID) return;

    try {
        const now = new Date();
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

        const [{ count: totalActive }, { count: newThisWeek }] = await Promise.all([
            supabase.from('prachi_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active').gt('expires_at', now.toISOString()),
            supabase.from('prachi_subscriptions').select('*', { count: 'exact', head: true }).gte('started_at', weekAgo)
        ]);

        const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
        const vipEntryUrl = getVipEntryUrl(frontendUrl);
        const msg =
            `🔥 <b>VIP Community Update</b>\n\n` +
            `<b>${newThisWeek || 0} new members</b> joined the exclusive VIP channel this week!\n\n` +
            `👥 Total active VIP members: <b>${totalActive || 0}</b>\n\n` +
            `Don't miss out — join the fastest growing exclusive community! 👇`;

        await telegram.postToPublicChannel(msg, {
            inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]]
        });
        console.log('[CRON] Weekly subscriber count posted to public channel');
    } catch (e) {
        console.error('[CRON] Weekly post failed:', e.message);
    }
});

// --- TELEGRAM TOOLS ---

// Post a poll to VIP or public channel
// In-memory history for polls and posted messages
const postedPolls = [];
const postedMessages = [];

app.post('/api/admin/post-poll', verifyToken, async (req, res) => {
    const { question, options, channel } = req.body;
    if (!question || !options || options.length < 2) return res.status(400).json({ error: 'Question and at least 2 options required' });
    const channelId = channel === 'vip' ? process.env.TELEGRAM_CHANNEL_ID : process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
    if (!channelId) return res.status(400).json({ error: 'Channel ID not configured' });
    try {
        const result = await telegram.createPoll(channelId, question, options);
        if (result.ok && result.result) {
            postedPolls.unshift({ id: Date.now(), messageId: result.result.message_id, channelId, channel, question, options, sentAt: new Date().toISOString() });
            if (postedPolls.length > 20) postedPolls.pop();
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/posted-polls', verifyToken, (req, res) => res.json(postedPolls));

app.delete('/api/admin/posted-polls/:id', verifyToken, async (req, res) => {
    const idx = postedPolls.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const poll = postedPolls[idx];
    try { await telegram.deleteMessage(poll.channelId, poll.messageId); } catch (_) {}
    postedPolls.splice(idx, 1);
    res.json({ success: true });
});

// Post a countdown teaser to public channel (with optional pin)
app.post('/api/admin/post-countdown', verifyToken, async (req, res) => {
    const { hours, message } = req.body;
    if (!hours) return res.status(400).json({ error: 'Hours required' });
    const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const vipEntryUrl = getVipEntryUrl(frontendUrl);
    const msg =
        `⏰ <b>Something drops in ${hours} hour${hours > 1 ? 's' : ''}!</b>\n\n` +
        `${message || '👀 Stay tuned for something exclusive...'}\n\n` +
        `<i>VIP members only! 🔒</i>`;
    const keyboard = { inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]] };
    try {
        const channelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
        const result = await telegram.postToPublicChannel(msg, keyboard);
        if (result.ok && result.result && channelId) {
            try { await telegram.pinMessage(channelId, result.result.message_id); } catch (_) {}
            postedMessages.unshift({ id: Date.now(), messageId: result.result.message_id, channelId, channel: 'public', text: msg, sentAt: new Date().toISOString() });
            if (postedMessages.length > 20) postedMessages.pop();
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/posted-messages', verifyToken, (req, res) => res.json(postedMessages));

// Channel member counts
app.get('/api/admin/channel-stats', verifyToken, async (req, res) => {
    const { callTelegramAPI } = require('./telegram');
    const stats = { vip: null, public: null };
    try {
        if (process.env.TELEGRAM_CHANNEL_ID) {
            const r = await callTelegramAPI('getChatMemberCount', { chat_id: process.env.TELEGRAM_CHANNEL_ID });
            if (r.ok) stats.vip = r.result;
        }
    } catch (_) {}
    try {
        if (process.env.TELEGRAM_PUBLIC_CHANNEL_ID) {
            const r = await callTelegramAPI('getChatMemberCount', { chat_id: process.env.TELEGRAM_PUBLIC_CHANNEL_ID });
            if (r.ok) stats.public = r.result;
        }
    } catch (_) {}
    res.json(stats);
});

// Add user to VIP channel by generating a one-time invite link and sending it to them
app.post('/api/admin/invite-user', verifyToken, async (req, res) => {
    const { telegramUserId } = req.body;
    if (!telegramUserId) return res.status(400).json({ error: 'telegramUserId required' });
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL_ID) {
        return res.status(400).json({ error: 'Telegram not configured' });
    }
    try {
        // Unban first in case they were previously kicked
        try { await telegram.unbanUser(telegramUserId); } catch (_) {}
        // Generate a one-time invite link
        const linkRes = await telegram.createInviteLink(86400);
        const inviteUrl = linkRes.ok && linkRes.result ? linkRes.result.invite_link : null;
        if (!inviteUrl) return res.status(500).json({ error: 'Could not generate invite link' });
        // DM the invite link to the user
        await telegram.sendMessage(telegramUserId,
            `🎉 You've been added to the VIP channel!\n\nTap the link below to join:\n${inviteUrl}`
        );
        res.json({ success: true, inviteUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/posted-messages/:id', verifyToken, async (req, res) => {
    const idx = postedMessages.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const pm = postedMessages[idx];
    try { await telegram.deleteMessage(pm.channelId, pm.messageId); } catch (_) {}
    postedMessages.splice(idx, 1);
    res.json({ success: true });
});

// --- POST SCHEDULER ---
const scheduledPosts = [];

app.post('/api/admin/schedule-post', verifyToken, (req, res) => {
    const { message, channel, scheduledAt, countdownHours, countdownMessage, photoUrl } = req.body;
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt required' });
    if (!message && !photoUrl) return res.status(400).json({ error: 'Message or photo required' });
    const id = Date.now();
    scheduledPosts.push({ id, message: message || '', channel: channel || 'vip', scheduledAt, countdownHours: countdownHours || null, countdownMessage: countdownMessage || '', photoUrl: photoUrl || null, sent: false, countdownSent: false, pinnedMessageId: null });
    console.log(`[SCHEDULER] Post scheduled for ${scheduledAt} → ${channel}`);
    res.json({ success: true, id });
});

app.get('/api/admin/scheduled-posts', verifyToken, (req, res) => {
    res.json(scheduledPosts.filter(p => !p.sent));
});

app.delete('/api/admin/scheduled-posts/:id', verifyToken, (req, res) => {
    const idx = scheduledPosts.findIndex(p => p.id === parseInt(req.params.id));
    if (idx !== -1) scheduledPosts.splice(idx, 1);
    res.json({ success: true });
});

// --- CRON: Scheduler check (every minute) ---
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const frontendUrl = process.env.FRONTEND_URL || 'https://yourwebsite.com';
    const vipEntryUrl = getVipEntryUrl(frontendUrl);

    for (const post of scheduledPosts) {
        if (post.sent) continue;
        const scheduledTime = new Date(post.scheduledAt);

        // Send countdown if not yet sent
        if (post.countdownHours && !post.countdownSent) {
            const countdownTime = new Date(scheduledTime.getTime() - post.countdownHours * 60 * 60 * 1000);
            if (now >= countdownTime) {
                const cdMsg =
                    `⏰ <b>Something drops in ${post.countdownHours} hour${post.countdownHours > 1 ? 's' : ''}!</b>\n\n` +
                    `${post.countdownMessage || '👀 Stay tuned for something exclusive...'}\n\n` +
                    `<i>VIP members only! 🔒</i>`;
                const keyboard = { inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]] };
                try {
                    const result = await telegram.postToPublicChannel(cdMsg, keyboard);
                    if (result.ok && result.result && process.env.TELEGRAM_PUBLIC_CHANNEL_ID) {
                        try { await telegram.pinMessage(process.env.TELEGRAM_PUBLIC_CHANNEL_ID, result.result.message_id); post.pinnedMessageId = result.result.message_id; } catch (_) {}
                    }
                    post.countdownSent = true;
                    console.log(`[SCHEDULER] Countdown posted for scheduled post #${post.id}`);
                } catch (e) {
                    console.error('[SCHEDULER] Countdown failed:', e.message);
                }
            }
        }

        // Send main post when due
        if (now >= scheduledTime) {
            try {
                const backendUrl = process.env.BACKEND_URL || frontendUrl;
                if (post.channel === 'vip') {
                    if (post.photoUrl) {
                        await telegram.sendPhotoToVipChannel(`${backendUrl}${post.photoUrl}`, post.message || '🔥 New content just dropped!');
                    } else {
                        await telegram.postToVipChannel(post.message);
                    }
                    // DM all active subscribers
                    const { data: subs } = await supabase.from('prachi_subscriptions')
                        .select('telegram_user_id').eq('status', 'active')
                        .gt('expires_at', now.toISOString()).not('telegram_user_id', 'is', null);
                    if (subs) {
                        for (const s of subs) {
                            try { await telegram.sendMessage(s.telegram_user_id, `🔥 New content just dropped in the channel! Go check it out! 👇`); } catch (_) {}
                            await new Promise(r => setTimeout(r, 50));
                        }
                    }
                } else {
                    const keyboard = { inline_keyboard: [[{ text: '🔓 Join VIP Now', url: vipEntryUrl }]] };
                    if (post.photoUrl) {
                        await telegram.sendTeaserPhoto(`${backendUrl}${post.photoUrl}`, post.message || '', keyboard);
                    } else {
                        await telegram.postToPublicChannel(post.message, keyboard);
                    }
                }
                // Unpin countdown if it was pinned
                if (post.pinnedMessageId && process.env.TELEGRAM_PUBLIC_CHANNEL_ID) {
                    try { await telegram.unpinMessage(process.env.TELEGRAM_PUBLIC_CHANNEL_ID, post.pinnedMessageId); } catch (_) {}
                }
                post.sent = true;
                console.log(`[SCHEDULER] Post #${post.id} sent to ${post.channel}`);
            } catch (e) {
                console.error('[SCHEDULER] Post failed:', e.message);
            }
        }
    }

    // Clean up sent posts older than 1 hour
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    for (let i = scheduledPosts.length - 1; i >= 0; i--) {
        if (scheduledPosts[i].sent && new Date(scheduledPosts[i].scheduledAt) < oneHourAgo) {
            scheduledPosts.splice(i, 1);
        }
    }
});

// --- SERVE FRONTEND (Production) ---
// Serve the built React frontend from ../frontend/dist
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendPath));

// SPA fallback — any route not matching an API or static file serves index.html
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Frontend served from ${frontendPath}`);
    console.log(`Subscription expiry check runs every hour`);
    pollUpdates();
});
