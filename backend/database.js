const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_PATH
    ? path.resolve(__dirname, process.env.DB_PATH)
    : path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Initialize tables
        db.serialize(() => {
            // Users table (Admin)
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password_hash TEXT
            )`);
            
            // Offers table
            db.run(`CREATE TABLE IF NOT EXISTS offers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_price REAL,
                discounted_price REAL,
                timer_end_date TEXT,
                is_active INTEGER DEFAULT 1
            )`);

            // Previews table
            db.run(`CREATE TABLE IF NOT EXISTS previews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                video_url TEXT,
                url TEXT,
                type TEXT DEFAULT 'image',
                duration TEXT,
                is_locked INTEGER DEFAULT 1,
                order_index INTEGER DEFAULT 0
            )`);

            // Settings table
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upi_id TEXT,
                telegram_channel_url TEXT,
                profile_name TEXT DEFAULT 'Prachi Sharma',
                profile_handle TEXT DEFAULT '@prachi_vip',
                profile_avatar TEXT DEFAULT 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400&h=400',
                fans_count TEXT DEFAULT '25.4K',
                videos_count TEXT DEFAULT '840+',
                bio_text TEXT DEFAULT 'The only place to access my completely unfiltered, private life. New high-quality content uploaded daily. Chat with me directly in the VIP group!',
                offer_title TEXT DEFAULT 'Lifetime VIP Access Pass',
                offer_subtitle TEXT DEFAULT 'One-time payment. Zero monthly rebills. Get instant access to the private Telegram channel immediately after payment.',
                offer_tag TEXT DEFAULT 'FLASH SALE ACTIVE',
                section_title TEXT DEFAULT 'Exclusive Previews',
                cta_button_text TEXT DEFAULT 'Become VIP Now',
                rotating_text_1 TEXT DEFAULT '🔒 PRIVATE CHAT & VIDEO CALL',
                rotating_text_2 TEXT DEFAULT '✨ Exclusive Content & Private Access',
                rotating_text_3 TEXT DEFAULT '🎬 200+ Photos/Videos Inside',
                cover_image_url TEXT DEFAULT '',
                checkout_title TEXT DEFAULT 'Unlock VIP Access',
                checkout_subtitle TEXT DEFAULT 'Pay securely via any UPI app (GPay, PhonePe, Paytm)'
            )`);
            
            // Seamlessly inject columns if they don't exist yet (for existing DB)
            const addColumn = (col, type, defVal) => {
                db.run(`ALTER TABLE settings ADD COLUMN ${col} ${type} DEFAULT '${defVal}'`, function(err) {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('Error adding column ' + col, err.message);
                    }
                });
            };
            const addPreviewColumn = (col, type, defVal) => {
                db.run(`ALTER TABLE previews ADD COLUMN ${col} ${type} DEFAULT '${defVal}'`, function(err) {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('Error adding column ' + col, err.message);
                    }
                });
            };
            addPreviewColumn('url', 'TEXT', '');
            addPreviewColumn('type', 'TEXT', 'image');
            addColumn('profile_name', 'TEXT', 'Prachi Sharma');
            addColumn('profile_handle', 'TEXT', '@prachi_vip');
            addColumn('profile_avatar', 'TEXT', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400&h=400');
            addColumn('fans_count', 'TEXT', '25.4K');
            addColumn('videos_count', 'TEXT', '840+');
            addColumn('bio_text', 'TEXT', 'The only place to access my completely unfiltered, private life. New high-quality content uploaded daily. Chat with me directly in the VIP group!');
            addColumn('offer_title', 'TEXT', 'Lifetime VIP Access Pass');
            addColumn('offer_subtitle', 'TEXT', 'One-time payment. Zero monthly rebills. Get instant access to the private Telegram channel immediately after payment.');
            addColumn('offer_tag', 'TEXT', 'FLASH SALE ACTIVE');
            addColumn('section_title', 'TEXT', 'Exclusive Previews');
            addColumn('cta_button_text', 'TEXT', 'Become VIP Now');
            addColumn('rotating_text_1', 'TEXT', '🔒 PRIVATE CHAT & VIDEO CALL');
            addColumn('rotating_text_2', 'TEXT', '✨ Exclusive Content & Private Access');
            addColumn('rotating_text_3', 'TEXT', '🎬 200+ Photos/Videos Inside');
            addColumn('cover_image_url', 'TEXT', '');
            addColumn('checkout_title', 'TEXT', 'Unlock VIP Access');
            addColumn('checkout_subtitle', 'TEXT', 'Pay securely via any UPI app (GPay, PhonePe, Paytm)');
            
            // Subscriptions table
            db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id TEXT,
                telegram_username TEXT,
                phone TEXT,
                transaction_id TEXT,
                amount REAL,
                plan TEXT DEFAULT 'monthly',
                status TEXT DEFAULT 'active',
                started_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT,
                cancelled_at TEXT,
                kicked_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )`);

            // Payment logs table
            db.run(`CREATE TABLE IF NOT EXISTS payment_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_id INTEGER,
                transaction_id TEXT,
                amount REAL,
                status TEXT DEFAULT 'pending',
                paid_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
            )`);

            // Seed settings if empty
            db.get("SELECT COUNT(*) AS count FROM settings", (err, row) => {
                if (row.count === 0) {
                    db.run(`INSERT INTO settings (upi_id, telegram_channel_url) VALUES ('example@upi', 'https://t.me/example')`);
                    db.run(`INSERT INTO offers (original_price, discounted_price, timer_end_date) VALUES (899, 199, datetime('now', '+1 day'))`);
                }
            });
        });
    }
});

module.exports = db;
