const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const telegram = require('./telegram');
const instamojo = require('./instamojo');
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
app.get('/api/public/data', (req, res) => {
    // We run consecutive queries
    db.get('SELECT * FROM offers WHERE is_active = 1 ORDER BY id DESC LIMIT 1', [], (err, offer) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get('SELECT * FROM settings ORDER BY id DESC LIMIT 1', [], (err, settings) => {
            if (err) return res.status(500).json({ error: err.message });

            db.all('SELECT * FROM previews ORDER BY order_index ASC', [], (err, previews) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({
                    offer: offer || {},
                    settings: settings || {},
                    upi_id: settings ? settings.upi_id : '',
                    previews: previews || []
                });
            });
        });
    });
});

// 2. Instamojo — Create a payment request
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

app.post('/api/payment/create', async (req, res) => {
    const { phone, telegramUsername, buyerName, email } = req.body;

    if (!phone || phone.length < 10) {
        return res.status(400).json({ error: 'Valid phone number is required' });
    }

    db.get('SELECT * FROM offers WHERE is_active = 1 ORDER BY id DESC LIMIT 1', [], async (err, offer) => {
        if (err) return res.status(500).json({ error: err.message });

        const amount = offer ? offer.discounted_price : 199;

        try {
            const paymentRequest = await instamojo.createPaymentRequest({
                amount,
                purpose: 'Monthly Exclusive Content Subscription',
                buyerName: buyerName || '',
                phone,
                email: email || '',
                redirectUrl: `${FRONTEND_URL}/payment/callback`,
                webhookUrl: `${BACKEND_URL}/api/payment/webhook`
            });

            db.run(
                `INSERT INTO subscriptions (telegram_username, phone, transaction_id, amount, plan, status, started_at)
                 VALUES (?, ?, ?, ?, 'monthly', 'pending', datetime('now'))`,
                [telegramUsername || '', phone, paymentRequest.id, amount]
            );

            res.json({
                success: true,
                payment_url: paymentRequest.longurl,
                payment_request_id: paymentRequest.id
            });
        } catch (e) {
            console.error('Instamojo create error:', e.message);
            res.status(500).json({ error: 'Payment gateway error. Please try again.' });
        }
    });
});

// 2b. Instamojo — Webhook (server-to-server callback after payment)
app.post('/api/payment/webhook', (req, res) => {
    const { payment_request_id, payment_id, status } = req.body;

    console.log(`[Webhook] payment_request_id=${payment_request_id} payment_id=${payment_id} status=${status}`);

    if (status === 'Credit') {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        db.run(
            `UPDATE subscriptions SET status = 'active', expires_at = ?, transaction_id = ?
             WHERE transaction_id = ? AND status = 'pending'`,
            [expiresAt, payment_id, payment_request_id],
            function (err) {
                if (err) console.error('[Webhook] DB update error:', err.message);
                else console.log(`[Webhook] Subscription activated for request ${payment_request_id}`);

                if (this.lastID || this.changes) {
                    db.run(
                        `INSERT INTO payment_logs (subscription_id, transaction_id, amount, status, paid_at)
                         SELECT id, ?, amount, 'success', ? FROM subscriptions WHERE transaction_id = ? LIMIT 1`,
                        [payment_id, now, payment_id]
                    );
                }
            }
        );
    }

    res.status(200).send('OK');
});

// 2c. Instamojo — Verify payment from frontend after redirect
app.get('/api/payment/verify/:paymentRequestId/:paymentId', async (req, res) => {
    const { paymentRequestId, paymentId } = req.params;

    try {
        const result = await instamojo.verifyPayment(paymentRequestId, paymentId);

        if (!result.verified) {
            return res.json({ success: false, reason: result.reason });
        }

        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        db.get(
            `SELECT * FROM subscriptions WHERE transaction_id = ?`,
            [paymentId],
            async (err, existingSub) => {
                if (existingSub && existingSub.status === 'active') {
                    let inviteUrl = '';
                    db.get('SELECT telegram_channel_url FROM settings ORDER BY id DESC LIMIT 1', [], async (e, settings) => {
                        inviteUrl = settings ? settings.telegram_channel_url : 'https://t.me/placeholder';
                        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
                            try {
                                const linkRes = await telegram.createInviteLink(86400);
                                if (linkRes.ok && linkRes.result) inviteUrl = linkRes.result.invite_link;
                            } catch (_) {}
                        }
                        return res.json({ success: true, telegram_url: inviteUrl, expires_at: existingSub.expires_at });
                    });
                    return;
                }

                db.run(
                    `UPDATE subscriptions SET status = 'active', expires_at = ?, transaction_id = ?
                     WHERE transaction_id = ? AND status = 'pending'`,
                    [expiresAt, paymentId, paymentRequestId],
                    async function (err2) {
                        if (err2) return res.status(500).json({ error: err2.message });

                        if (this.changes === 0) {
                            db.run(
                                `INSERT INTO subscriptions (phone, transaction_id, amount, plan, status, started_at, expires_at)
                                 VALUES (?, ?, ?, 'monthly', 'active', ?, ?)`,
                                [result.buyerPhone || '', paymentId, result.amount, now, expiresAt]
                            );
                        }

                        db.run(
                            `INSERT INTO payment_logs (subscription_id, transaction_id, amount, status, paid_at)
                             SELECT id, ?, amount, 'success', ? FROM subscriptions WHERE transaction_id = ? LIMIT 1`,
                            [paymentId, now, paymentId]
                        );

                        let inviteUrl = '';
                        db.get('SELECT telegram_channel_url FROM settings ORDER BY id DESC LIMIT 1', [], async (e, settings) => {
                            inviteUrl = settings ? settings.telegram_channel_url : 'https://t.me/placeholder';
                            if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
                                try {
                                    const linkRes = await telegram.createInviteLink(86400);
                                    if (linkRes.ok && linkRes.result) inviteUrl = linkRes.result.invite_link;
                                } catch (_) {}
                            }
                            res.json({ success: true, telegram_url: inviteUrl, expires_at: expiresAt });
                        });
                    }
                );
            }
        );
    } catch (e) {
        console.error('Payment verify error:', e.message);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// 3. Check subscription status (public)
app.get('/api/public/subscription/:phone', (req, res) => {
    db.get(
        `SELECT * FROM subscriptions WHERE phone = ? ORDER BY id DESC LIMIT 1`,
        [req.params.phone],
        (err, sub) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!sub) return res.json({ active: false });
            const isActive = sub.status === 'active' && new Date(sub.expires_at) > new Date();
            res.json({ active: isActive, expires_at: sub.expires_at, status: sub.status });
        }
    );
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
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    // In production, the admin user should be pre-seeded. 
    // We'll create one if the DB is empty on first login for dev purposes!
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (!user) {
            if (username === ADMIN_USERNAME) {
                const hash = await bcrypt.hash(password, 10);
                db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [ADMIN_USERNAME, hash]);
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
});

// Update Offer
app.put('/api/admin/offer', verifyToken, (req, res) => {
    const { original_price, discounted_price, timer_end_date } = req.body;
    db.run(
        `UPDATE offers SET original_price = ?, discounted_price = ?, timer_end_date = ? 
        WHERE id = (SELECT id FROM offers ORDER BY id DESC LIMIT 1)`,
        [original_price, discounted_price, timer_end_date],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Get Settings
app.get('/api/admin/settings', verifyToken, (req, res) => {
    db.get('SELECT * FROM settings ORDER BY id DESC LIMIT 1', [], (err, settings) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(settings || {});
    });
});

// Update Settings
app.put('/api/admin/settings', verifyToken, (req, res) => {
    const { 
        upi_id, telegram_channel_url, profile_name, profile_handle, 
        profile_avatar, fans_count, videos_count, bio_text,
        offer_title, offer_subtitle, offer_tag, section_title,
        cta_button_text, rotating_text_1, rotating_text_2, rotating_text_3,
        cover_image_url, checkout_title, checkout_subtitle
    } = req.body;
    
    db.run(
        `UPDATE settings SET 
            upi_id = ?, telegram_channel_url = ?, profile_name = ?, 
            profile_handle = ?, profile_avatar = ?, fans_count = ?, 
            videos_count = ?, bio_text = ?,
            offer_title = ?, offer_subtitle = ?, offer_tag = ?,
            section_title = ?, cta_button_text = ?,
            rotating_text_1 = ?, rotating_text_2 = ?, rotating_text_3 = ?,
            cover_image_url = ?, checkout_title = ?, checkout_subtitle = ?
        WHERE id = (SELECT id FROM settings ORDER BY id DESC LIMIT 1)`,
        [upi_id, telegram_channel_url, profile_name, profile_handle, profile_avatar, 
         fans_count, videos_count, bio_text,
         offer_title, offer_subtitle, offer_tag, section_title,
         cta_button_text, rotating_text_1, rotating_text_2, rotating_text_3,
         cover_image_url, checkout_title, checkout_subtitle],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Upload media
app.post('/api/admin/upload', verifyToken, upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// Previews CRUD
app.get('/api/admin/previews', verifyToken, (req, res) => {
    db.all('SELECT * FROM previews ORDER BY order_index ASC', [], (err, previews) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(previews || []);
    });
});

app.post('/api/admin/previews', verifyToken, (req, res) => {
    const { title, url, type, is_locked, order_index } = req.body;
    db.run(
        `INSERT INTO previews (title, url, type, is_locked, order_index) VALUES (?, ?, ?, ?, ?)`,
        [title || '', url, type || 'image', is_locked !== undefined ? is_locked : 1, order_index || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.delete('/api/admin/previews/:id', verifyToken, (req, res) => {
    db.run(`DELETE FROM previews WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- SUBSCRIPTION MANAGEMENT (Admin) ---

// List all subscriptions
app.get('/api/admin/subscriptions', verifyToken, (req, res) => {
    db.all('SELECT * FROM subscriptions ORDER BY id DESC', [], (err, subs) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(subs || []);
    });
});

// Manually cancel a subscription + kick from channel
app.put('/api/admin/subscriptions/:id/cancel', verifyToken, async (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM subscriptions WHERE id = ?', [id], async (err, sub) => {
        if (err) return res.status(500).json({ error: err.message });
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
        db.run(
            `UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, kicked_at = ? WHERE id = ?`,
            [now, now, id],
            function (err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true });
            }
        );
    });
});

// Manually reactivate a subscription
app.put('/api/admin/subscriptions/:id/reactivate', verifyToken, async (req, res) => {
    const { id } = req.params;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.get('SELECT * FROM subscriptions WHERE id = ?', [id], async (err, sub) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sub) return res.status(404).json({ error: 'Subscription not found' });

        if (sub.telegram_user_id && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
            try {
                await telegram.unbanUser(sub.telegram_user_id);
            } catch (e) {
                console.error('Unban error:', e.message);
            }
        }

        db.run(
            `UPDATE subscriptions SET status = 'active', expires_at = ?, cancelled_at = NULL, kicked_at = NULL WHERE id = ?`,
            [expiresAt, id],
            function (err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true, expires_at: expiresAt });
            }
        );
    });
});

// Get subscription stats
app.get('/api/admin/subscriptions/stats', verifyToken, (req, res) => {
    db.all(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' AND expires_at > datetime('now') THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
    FROM subscriptions`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows[0] || { total: 0, active: 0, cancelled: 0, expired: 0 });
    });
});

// --- CRON: Check expired subscriptions every hour ---
cron.schedule('0 * * * *', () => {
    console.log('[CRON] Checking expired subscriptions...');
    const now = new Date().toISOString();

    db.all(
        `SELECT * FROM subscriptions WHERE status = 'active' AND expires_at <= ?`,
        [now],
        async (err, expiredSubs) => {
            if (err) return console.error('[CRON] DB error:', err.message);
            if (!expiredSubs || expiredSubs.length === 0) return;

            console.log(`[CRON] Found ${expiredSubs.length} expired subscriptions`);

            for (const sub of expiredSubs) {
                if (sub.telegram_user_id && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID) {
                    try {
                        await telegram.kickUser(sub.telegram_user_id);
                        console.log(`[CRON] Kicked user ${sub.telegram_username || sub.telegram_user_id}`);
                    } catch (e) {
                        console.error(`[CRON] Kick failed for ${sub.telegram_user_id}:`, e.message);
                    }

                    try {
                        await telegram.sendMessage(sub.telegram_user_id,
                            '⚠️ Your monthly subscription has expired.\n\n🔒 Your access to the private channel has been removed.\n\n💳 Renew now to continue enjoying exclusive content!'
                        );
                    } catch (_) {}
                }

                db.run(
                    `UPDATE subscriptions SET status = 'expired', kicked_at = ? WHERE id = ?`,
                    [now, sub.id]
                );
            }
        }
    );
});

// --- SERVE FRONTEND (Production) ---
// Serve the built React frontend from ../frontend/dist
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendPath));

// SPA fallback — any route not matching an API or static file serves index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Frontend served from ${frontendPath}`);
    console.log(`Subscription expiry check runs every hour`);
    pollUpdates();
});
