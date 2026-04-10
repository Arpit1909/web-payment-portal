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
const telegram = require('./telegram');
const instantpay = require('./instantpay');
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
            active_members_count: activeCount || 0
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. InstantPay — Create a payment request
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

app.post('/api/payment/create', async (req, res) => {
    const { phone, telegramUsername, buyerName, email } = req.body;

    if (!phone || phone.length < 10) {
        return res.status(400).json({ error: 'Valid phone number is required' });
    }

    try {
        const { data: offer, error: err } = await supabase.from('prachi_offers').select('*').eq('is_active', 1).order('id', { ascending: false }).limit(1).maybeSingle();
        if (err) return res.status(500).json({ error: err.message });

        const amount = offer ? offer.discounted_price : 199;

        const paymentRequest = await instantpay.createPaymentRequest({
            amount,
            purpose: 'Monthly Exclusive Content Subscription',
            buyerName: buyerName || '',
            phone,
            email: email || '',
            redirectUrl: `${FRONTEND_URL}/payment/callback`,
            webhookUrl: `${BACKEND_URL}/api/payment/webhook`
        });

        await supabase.from('prachi_subscriptions').insert({
            telegram_username: telegramUsername || '',
            phone,
            transaction_id: paymentRequest.id,
            amount,
            plan: 'monthly',
            status: 'pending'
        });

        res.json({
            success: true,
            payment_url: paymentRequest.longurl,
            payment_request_id: paymentRequest.id
        });
    } catch (e) {
        console.error('InstantPay create error:', e.message);
        res.status(500).json({ error: 'Payment gateway error. Please try again.' });
    }
});

// 2b. InstantPay — Webhook (server-to-server callback after payment)
app.post('/api/payment/webhook', (req, res) => {
    const { payment_request_id, payment_id, status } = req.body;

    console.log(`[Webhook] payment_request_id=${payment_request_id} payment_id=${payment_id} status=${status}`);

    if (status === 'Credit') {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        (async () => {
            const { data: updatedSub, error: updateErr } = await supabase
                .from('prachi_subscriptions')
                .update({ status: 'active', expires_at: expiresAt, transaction_id: payment_id })
                .eq('transaction_id', payment_request_id)
                .eq('status', 'pending')
                .select()
                .maybeSingle();

            if (updateErr) console.error('[Webhook] DB update error:', updateErr.message);
            else if (updatedSub) {
                console.log(`[Webhook] Subscription activated for request ${payment_request_id}`);
                await supabase.from('prachi_payment_logs').insert({
                    subscription_id: updatedSub.id,
                    transaction_id: payment_id,
                    amount: updatedSub.amount,
                    status: 'success',
                    paid_at: now
                });
            }
        })();
    }

    res.status(200).send('OK');
});

// 2c. InstantPay — Verify payment from frontend after redirect
app.get('/api/payment/verify/:paymentRequestId/:paymentId', async (req, res) => {
    const { paymentRequestId, paymentId } = req.params;

    try {
        const result = await instantpay.verifyPayment(paymentRequestId, paymentId);

        if (!result.verified) {
            return res.json({ success: false, reason: result.reason });
        }

        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        let inviteUrl = 'https://t.me/placeholder';
        const { data: settings } = await supabase.from('prachi_settings').select('telegram_channel_url').order('id', { ascending: false }).limit(1).maybeSingle();
        if (settings) inviteUrl = settings.telegram_channel_url;
        
        const getInviteUrl = async () => {
            let url = inviteUrl;
            if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
                try {
                    const linkRes = await telegram.createInviteLink(86400);
                    if (linkRes.ok && linkRes.result) url = linkRes.result.invite_link;
                } catch (_) {}
            }
            return url;
        };

        const { data: existingSub } = await supabase.from('prachi_subscriptions').select('*').eq('transaction_id', paymentId).maybeSingle();
        
        if (existingSub && existingSub.status === 'active') {
            return res.json({ success: true, telegram_url: await getInviteUrl(), expires_at: existingSub.expires_at });
        }

        const { data: updatedSub, error: updateErr } = await supabase
            .from('prachi_subscriptions')
            .update({ status: 'active', expires_at: expiresAt, transaction_id: paymentId })
            .eq('transaction_id', paymentRequestId)
            .eq('status', 'pending')
            .select()
            .maybeSingle();

        if (updateErr) return res.status(500).json({ error: updateErr.message });

        let currentSubId;
        let amountPaid = result.amount;

        if (!updatedSub) {
            const { data: newSub } = await supabase.from('prachi_subscriptions').insert({
                phone: result.buyerPhone || '',
                transaction_id: paymentId,
                amount: result.amount,
                plan: 'monthly',
                status: 'active',
                started_at: now,
                expires_at: expiresAt
            }).select().maybeSingle();
            if (newSub) currentSubId = newSub.id;
        } else {
            currentSubId = updatedSub.id;
            amountPaid = updatedSub.amount;
        }

        if (currentSubId) {
            await supabase.from('prachi_payment_logs').insert({
                subscription_id: currentSubId,
                transaction_id: paymentId,
                amount: amountPaid,
                status: 'success',
                paid_at: now
            });
        }

        res.json({ success: true, telegram_url: await getInviteUrl(), expires_at: expiresAt });
    } catch (e) {
        console.error('Payment verify error:', e.message);
        res.status(500).json({ success: false, error: 'Verification failed' });
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
    const { data: latest } = await supabase.from('prachi_settings').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
    
    if (latest) {
        const { error } = await supabase.from('prachi_settings').update(updateData).eq('id', latest.id);
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
    const { title, url, type, is_locked, order_index } = req.body;
    const { data, error } = await supabase.from('prachi_previews').insert({
        title: title || '', url, type: type || 'image', is_locked: is_locked !== undefined ? is_locked : 1, order_index: order_index || 0
    }).select().maybeSingle();
    
    if (error) return res.status(500).json({ error: error.message });
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
    const renewKeyboard = { inline_keyboard: [[{ text: '💳 Renew Subscription Now', url: frontendUrl }]] };

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
