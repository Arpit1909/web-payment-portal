import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../apiConfig';
import {
    Settings, LogOut, LayoutDashboard, Image as ImageIcon,
    Upload, Trash2, Tag, Type, Lock, CheckCircle2,
    AlertCircle, Crown, Users, Video, DollarSign,
    Globe, MessageSquare, User, Camera, Clock, Send, BarChart2, Wrench, Calendar, Plus, X
} from 'lucide-react';

/* ===========================
   REUSABLE SUB-COMPONENTS
=========================== */

const Spinner = ({ light = false }) => (
    <span className={`spinner ${light ? 'spinner-light' : ''}`}></span>
);

const Toast = ({ notification }) => {
    if (!notification) return null;
    return (
        <div
            className="notification-toast"
            style={{ background: notification.type === 'error' ? '#b91c1c' : '#15803d' }}
        >
            {notification.type === 'error'
                ? <AlertCircle size={16} />
                : <CheckCircle2 size={16} />
            }
            {notification.msg}
        </div>
    );
};

const Field = ({ label, value, field, placeholder, type = 'text', rows, hint, onChange }) => (
    <div className="form-group">
        <label className="form-label">{label}</label>
        {rows ? (
            <textarea
                className="input-elegant"
                rows={rows}
                value={value}
                onChange={e => onChange(field, e.target.value)}
                placeholder={placeholder}
            />
        ) : (
            <input
                className="input-elegant"
                type={type}
                value={value}
                onChange={e => onChange(field, e.target.value)}
                placeholder={placeholder}
            />
        )}
        {hint && <p className="input-hint">{hint}</p>}
    </div>
);

const SectionCard = ({ title, icon, children, action }) => (
    <div className="admin-section-card">
        <div className="admin-section-header">
            <div className="admin-section-title">
                {icon}
                {title}
            </div>
            {action}
        </div>
        <div className="admin-section-body">
            {children}
        </div>
    </div>
);

/* ===========================
   MAIN ADMIN COMPONENT
=========================== */

export default function Admin() {
    const [token, setToken] = useState(localStorage.getItem('adminToken') || null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [notification, setNotification] = useState(null);
    const [activeTab, setActiveTab] = useState('dashboard');
    
    // Broadcast State
    const [broadcastMsg, setBroadcastMsg] = useState('');
    const [broadcastLoading, setBroadcastLoading] = useState(false);

    // Public Channel Promo
    const DEFAULT_PROMO = `🔥 New exclusive content just dropped in the VIP channel!\n\n💎 Photos, videos & more — all locked for VIP members only.\n\n👇 Grab your access before the price goes up!`;
    const [promoMsg, setPromoMsg] = useState(DEFAULT_PROMO);
    const [promoLoading, setPromoLoading] = useState(false);

    const [offerData, setOfferData] = useState({
        original_price: 899,
        discounted_price: 399,
        timer_end_date: ''
    });

    const [maintenanceLoading, setMaintenanceLoading] = useState(false);

    const [settingsData, setSettingsData] = useState({
        upi_id: '',
        telegram_channel_url: '',
        profile_name: '',
        profile_handle: '',
        profile_avatar: '',
        maintenance_mode: 0,
        maintenance_title: '',
        maintenance_end_time: '',
        fans_count: '',
        videos_count: '',
        bio_text: '',
        offer_title: '',
        offer_subtitle: '',
        offer_tag: '',
        section_title: '',
        cta_button_text: '',
        rotating_text_1: '',
        rotating_text_2: '',
        rotating_text_3: '',
        cover_image_url: '',
        checkout_title: '',
        checkout_subtitle: ''
    });

    const [previews, setPreviews] = useState([]);
    const [postDestination, setPostDestination] = useState('none');
    const [mediaCaptions, setMediaCaptions] = useState({ vip: '', public: '', none: '' });
    const [captionPreviewMode, setCaptionPreviewMode] = useState('auto');
    const selectedCaptionKey = postDestination === 'vip' || postDestination === 'public' ? postDestination : 'none';
    const captionEditorKey = captionPreviewMode === 'auto' ? selectedCaptionKey : captionPreviewMode;
    const activeCaption = (mediaCaptions[selectedCaptionKey] || '').trim();
    const editorCaption = mediaCaptions[captionEditorKey] || '';
    const previewCaptionKey = captionPreviewMode === 'auto' ? selectedCaptionKey : captionPreviewMode;
    const previewTypedCaption = (mediaCaptions[previewCaptionKey] || '').trim();

    // Telegram Tools state
    const [pollQuestion, setPollQuestion] = useState('');
    const [pollOptions, setPollOptions] = useState(['', '']);
    const [pollChannel, setPollChannel] = useState('vip');
    const [pollLoading, setPollLoading] = useState(false);

    const [countdownHours, setCountdownHours] = useState('24');
    const [countdownMessage, setCountdownMessage] = useState('');
    const [countdownLoading, setCountdownLoading] = useState(false);

    const [scheduleMsg, setScheduleMsg] = useState('');
    const [scheduleChannel, setScheduleChannel] = useState('vip');
    const [scheduleAt, setScheduleAt] = useState('');
    const [scheduleCountdownHours, setScheduleCountdownHours] = useState('');
    const [scheduleCountdownMsg, setScheduleCountdownMsg] = useState('');
    const [schedulePhotoUrl, setSchedulePhotoUrl] = useState('');
    const [schedulePhotoLoading, setSchedulePhotoLoading] = useState(false);
    const [scheduledPosts, setScheduledPosts] = useState([]);
    const [scheduleLoading, setScheduleLoading] = useState(false);
    const [postedPolls, setPostedPolls] = useState([]);
    const [postedMessages, setPostedMessages] = useState([]);
    const [inviteUserId, setInviteUserId] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);
    const schedulePhotoRef = useRef(null);
    const [subscriptions, setSubscriptions] = useState([]);
    const [subStats, setSubStats] = useState({ total: 0, active: 0, cancelled: 0, expired: 0 });
    const [channelStats, setChannelStats] = useState({ vip: null, vipOnly: null, public: null });
    const [channelPostMsg, setChannelPostMsg] = useState({ vip: '', vipplus: '', public: '' });
    const [channelPostLoading, setChannelPostLoading] = useState({ vip: false, vipplus: false, public: false });
    const fileInputRef = useRef(null);
    const avatarInputRef = useRef(null);
    const coverInputRef = useRef(null);

    const showNotify = (msg, type = 'success') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 3500);
    };

    const updateField = (field, value) => {
        setSettingsData(prev => ({ ...prev, [field]: value }));
    };

    useEffect(() => {
        let interval;
        if (token) {
            fetchSettings();
            fetchPreviews();
            fetchSubscriptions();
            fetchScheduledPosts();
            fetchPostedPolls();
            fetchPostedMessages();
            fetchChannelStats();
            interval = setInterval(() => {
                fetchPreviews();
                fetchSubscriptions();
                fetchScheduledPosts();
                fetchPostedPolls();
                fetchPostedMessages();
                fetchChannelStats();
            }, 30000); // channel stats refresh every 30s (Telegram rate limits)
        }
        return () => { if (interval) clearInterval(interval); };
    }, [token]);

    const handleAuthError = (data) => {
        if (data && data.error && (data.error === 'Invalid token' || data.error === 'Access denied')) {
            setToken('');
            localStorage.removeItem('prachi_admin_token');
            showNotify('Session expired. Please login again.', 'error');
            return true;
        }
        return false;
    };

    const fetchChannelStats = () => {
        fetch(`${API_BASE}/api/admin/channel-stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).then(data => {
            if (data && !data.error) setChannelStats(data);
        }).catch(console.error);
    };

    const fetchSettings = () => {
        fetch(`${API_BASE}/api/admin/settings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).then(data => {
            if (handleAuthError(data)) return;
            if (data && typeof data === 'object') setSettingsData(prev => ({ ...prev, ...data }));
        }).catch(console.error);

        fetch(`${API_BASE}/api/public/data`)
            .then(r => r.json()).then(data => {
                let timerDate = '';
                if (data.offer && data.offer.timer_end_date) {
                    try {
                        const d = new Date(data.offer.timer_end_date);
                        if (!isNaN(d)) {
                            // Extract exact local YYYY-MM-DDThh:mm from Date object
                            // e.g. "2026-04-10T12:48"
                            const y = d.getFullYear();
                            const m = String(d.getMonth() + 1).padStart(2, '0');
                            const day = String(d.getDate()).padStart(2, '0');
                            const h = String(d.getHours()).padStart(2, '0');
                            const min = String(d.getMinutes()).padStart(2, '0');
                            timerDate = `${y}-${m}-${day}T${h}:${min}`;
                        }
                    } catch(e) {}
                }
                if (data.offer) setOfferData({
                    original_price: data.offer.original_price || 899,
                    discounted_price: data.offer.discounted_price || 399,
                    timer_end_date: timerDate
                });
            }).catch(console.error);
    };

    const fetchPreviews = () => {
        fetch(`${API_BASE}/api/admin/previews`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).then(data => {
            if (handleAuthError(data)) return;
            setPreviews(Array.isArray(data) ? data : []);
        }).catch(console.error);
    };

    const fetchSubscriptions = () => {
        fetch(`${API_BASE}/api/admin/subscriptions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).then(data => {
            if (handleAuthError(data)) return;
            setSubscriptions(Array.isArray(data) ? data : []);
        }).catch(console.error);

        fetch(`${API_BASE}/api/admin/subscriptions/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()).then(data => {
            if (handleAuthError(data)) return;
            setSubStats(data);
        }).catch(console.error);
    };

    const handleCancelSub = async (id) => {
        if (!confirm('Cancel this subscription? The user will be kicked from the channel.')) return;
        setLoading(true);
        try {
            await fetch(`${API_BASE}/api/admin/subscriptions/${id}/cancel`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            showNotify('Subscription cancelled & user kicked');
            fetchSubscriptions();
        } catch {
            showNotify('Failed to cancel', 'error');
        }
        setLoading(false);
    };

    const handleBroadcast = async () => {
        if (!broadcastMsg.trim()) return showNotify('Message cannot be empty', 'error');
        if (!window.confirm('Are you absolutely sure? This will instantly DM ALL active subscribers.')) return;
        
        setBroadcastLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/broadcast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ messageText: broadcastMsg })
            });
            const data = await res.json();
            if (data.success) {
                showNotify(`Broadcast sent successfully to ${data.sentCount} users!`);
                setBroadcastMsg('');
            } else {
                showNotify(data.error || 'Broadcast failed', 'error');
            }
        } catch {
            showNotify('Network error during broadcast', 'error');
        }
        setBroadcastLoading(false);
    };

    const handleToggleMaintenance = async () => {
        const newVal = settingsData.maintenance_mode == 1 ? 0 : 1;
        // Auto-set end_time to 24h from now if enabling and no future time set
        let updatedSettings = { ...settingsData, maintenance_mode: newVal };
        if (newVal == 1) {
            const existingEnd = settingsData.maintenance_end_time ? new Date(settingsData.maintenance_end_time) : null;
            if (!existingEnd || existingEnd <= new Date()) {
                const defaultEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
                const iso = defaultEnd.toISOString().slice(0, 16);
                updatedSettings.maintenance_end_time = iso;
                setSettingsData(prev => ({ ...prev, maintenance_mode: newVal, maintenance_end_time: iso }));
            } else {
                setSettingsData(prev => ({ ...prev, maintenance_mode: newVal }));
            }
        } else {
            setSettingsData(prev => ({ ...prev, maintenance_mode: newVal }));
        }
        setMaintenanceLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(updatedSettings)
            });
            const data = await res.json();
            if (data.success) {
                showNotify(newVal == 1 ? 'Maintenance mode ENABLED — site is now offline for visitors.' : 'Maintenance mode DISABLED — site is live again!');
            } else {
                showNotify('Failed to update maintenance mode.', 'error');
            }
        } catch {
            showNotify('Network error.', 'error');
        }
        setMaintenanceLoading(false);
    };

    const handlePostToPublic = async () => {
        if (!promoMsg.trim()) return showNotify('Message cannot be empty', 'error');
        setPromoLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/post-to-public`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ message: promoMsg })
            });
            const data = await res.json();
            if (data.success) {
                showNotify('Promo posted to public channel!');
            } else {
                showNotify(data.error || 'Failed to post', 'error');
            }
        } catch {
            showNotify('Network error.', 'error');
        }
        setPromoLoading(false);
    };

    const handleReactivateSub = async (id) => {
        setLoading(true);
        try {
            await fetch(`${API_BASE}/api/admin/subscriptions/${id}/reactivate`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            showNotify('Subscription reactivated (30 days)');
            fetchSubscriptions();
        } catch {
            showNotify('Failed to reactivate', 'error');
        }
        setLoading(false);
    };

    const handlePostToChannel = async (channelKey) => {
        const msg = channelPostMsg[channelKey];
        if (!msg || !msg.trim()) return showNotify('Message cannot be empty', 'error');
        setChannelPostLoading(prev => ({ ...prev, [channelKey]: true }));
        try {
            const res = await fetch(`${API_BASE}/api/admin/post-to-channel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ message: msg, channel: channelKey })
            });
            const data = await res.json();
            if (data.success) {
                showNotify(`✅ Posted to ${data.label}`);
                setChannelPostMsg(prev => ({ ...prev, [channelKey]: '' }));
            } else {
                showNotify(data.error || 'Failed to post', 'error');
            }
        } catch {
            showNotify('Network error.', 'error');
        }
        setChannelPostLoading(prev => ({ ...prev, [channelKey]: false }));
    };

    const handleDeleteSub = async (id) => {
        if (!confirm('Permanently delete this user record? This cannot be undone. The user will also be kicked from the channel.')) return;
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                showNotify('User deleted permanently');
                fetchSubscriptions();
            } else {
                showNotify('Failed to delete user', 'error');
            }
        } catch {
            showNotify('Network error while deleting', 'error');
        }
        setLoading(false);
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.token) {
                localStorage.setItem('adminToken', data.token);
                setToken(data.token);
            } else {
                showNotify(data.error || 'Invalid credentials', 'error');
            }
        } catch {
            showNotify('Network error', 'error');
        }
        setLoading(false);
    };

    const handleUpdateOffer = async (e) => {
        if (e) e.preventDefault();
        setLoading(true);
        try {
            let payload = { ...offerData };
            if (payload.timer_end_date) {
                const d = new Date(payload.timer_end_date);
                if (!isNaN(d)) payload.timer_end_date = d.toISOString();
            }
            const res = await fetch(`${API_BASE}/api/admin/offer`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            data.success ? showNotify('Pricing updated successfully!') : showNotify('Failed to update pricing.', 'error');
        } catch {
            showNotify('Server error.', 'error');
        }
        setLoading(false);
    };

    const handleUpdateSettings = async (e) => {
        if (e) e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(settingsData)
            });
            const data = await res.json();
            data.success ? showNotify('Settings saved!') : showNotify('Failed to save.', 'error');
        } catch {
            showNotify('Server error.', 'error');
        }
        setLoading(false);
    };

    const handleAvatarUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('media', file);
        try {
            const res = await fetch(`${API_BASE}/api/admin/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (data.url) {
                setSettingsData(prev => ({ ...prev, profile_avatar: `${API_BASE}${data.url}` }));
                showNotify('Avatar uploaded! Click Save to apply.');
            }
        } catch {
            showNotify('Upload failed.', 'error');
        }
        setLoading(false);
        e.target.value = '';
    };

    const handleCoverUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('media', file);
        try {
            const res = await fetch(`${API_BASE}/api/admin/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (data.url) {
                setSettingsData(prev => ({ ...prev, cover_image_url: `${API_BASE}${data.url}` }));
                showNotify('Cover image uploaded! Click Save to apply.');
            }
        } catch {
            showNotify('Upload failed.', 'error');
        }
        setLoading(false);
        e.target.value = '';
    };

    const handleUploadMedia = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('media', file);
        try {
            const uploadRes = await fetch(`${API_BASE}/api/admin/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const uploadData = await uploadRes.json();
            if (uploadData.url) {
                const isVideo = file.type.startsWith('video');
                const addRes = await fetch(`${API_BASE}/api/admin/previews`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({
                        title: activeCaption || 'Uploaded Media',
                        caption: activeCaption,
                        vipCaption: (mediaCaptions.vip || '').trim(),
                        publicCaption: (mediaCaptions.public || '').trim(),
                        url: uploadData.url,
                        type: isVideo ? 'video' : 'image',
                        is_locked: 1,
                        order_index: previews.length,
                        postDestination
                    })
                });
                if (addRes.ok) {
                    const destLabel = postDestination === 'vip' ? 'Posted to VIP + teaser to public!' : postDestination === 'public' ? 'Posted to public channel!' : 'Media added to gallery!';
                    showNotify(destLabel);
                    setMediaCaptions(prev => ({ ...prev, [selectedCaptionKey]: '' }));
                    fetchPreviews();
                }
            } else {
                showNotify('Upload failed.', 'error');
            }
        } catch {
            showNotify('Upload error.', 'error');
        }
        setLoading(false);
        e.target.value = '';
    };

    const handleDeleteMedia = async (id) => {
        if (!window.confirm('Delete this media item?')) return;
        try {
            const res = await fetch(`${API_BASE}/api/admin/previews/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) { showNotify('Media deleted.'); fetchPreviews(); }
        } catch {
            showNotify('Delete error.', 'error');
        }
    };

    const fetchPostedPolls = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/posted-polls`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) setPostedPolls(await res.json());
        } catch {}
    };

    const fetchPostedMessages = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/posted-messages`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) setPostedMessages(await res.json());
        } catch {}
    };

    const handleDeletePoll = async (id) => {
        try {
            await fetch(`${API_BASE}/api/admin/posted-polls/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            fetchPostedPolls();
            showNotify('Poll deleted from Telegram.');
        } catch { showNotify('Error deleting poll.', 'error'); }
    };

    const handleDeletePostedMessage = async (id) => {
        try {
            await fetch(`${API_BASE}/api/admin/posted-messages/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            fetchPostedMessages();
            showNotify('Message deleted from Telegram.');
        } catch { showNotify('Error deleting message.', 'error'); }
    };

    const handleSchedulePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setSchedulePhotoLoading(true);
        const formData = new FormData();
        formData.append('media', file);
        try {
            const res = await fetch(`${API_BASE}/api/admin/upload`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
            const data = await res.json();
            if (data.url) { setSchedulePhotoUrl(data.url); showNotify('Photo uploaded!'); }
            else showNotify('Upload failed.', 'error');
        } catch { showNotify('Upload error.', 'error'); }
        setSchedulePhotoLoading(false);
        e.target.value = '';
    };

    const handleInviteUser = async () => {
        if (!inviteUserId.trim()) { showNotify('Enter a Telegram User ID.', 'error'); return; }
        setInviteLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/invite-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ telegramUserId: inviteUserId.trim() })
            });
            const d = await res.json();
            if (d.success) { showNotify('Invite sent! User will receive a DM with the link.'); setInviteUserId(''); }
            else showNotify(d.error || 'Failed.', 'error');
        } catch { showNotify('Error.', 'error'); }
        setInviteLoading(false);
    };

    const fetchScheduledPosts = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/scheduled-posts`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) setScheduledPosts(await res.json());
        } catch {}
    };

    const handlePostPoll = async () => {
        const filled = pollOptions.filter(o => o.trim());
        if (!pollQuestion.trim() || filled.length < 2) { showNotify('Add a question and at least 2 options.', 'error'); return; }
        setPollLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/post-poll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ question: pollQuestion, options: filled, channel: pollChannel })
            });
            if (res.ok) { showNotify('Poll posted!'); setPollQuestion(''); setPollOptions(['', '']); }
            else { const d = await res.json(); showNotify(d.error || 'Failed', 'error'); }
        } catch { showNotify('Error posting poll.', 'error'); }
        setPollLoading(false);
    };

    const handlePostCountdown = async () => {
        if (!countdownHours) { showNotify('Enter hours.', 'error'); return; }
        setCountdownLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/post-countdown`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ hours: parseInt(countdownHours), message: countdownMessage })
            });
            if (res.ok) { showNotify('Countdown posted & pinned!'); setCountdownMessage(''); }
            else { const d = await res.json(); showNotify(d.error || 'Failed', 'error'); }
        } catch { showNotify('Error.', 'error'); }
        setCountdownLoading(false);
    };

    const handleSchedulePost = async () => {
        if (!scheduleMsg.trim() || !scheduleAt) { showNotify('Message and date/time required.', 'error'); return; }
        setScheduleLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/schedule-post`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    message: scheduleMsg, channel: scheduleChannel,
                    scheduledAt: new Date(scheduleAt).toISOString(),
                    countdownHours: scheduleCountdownHours ? parseInt(scheduleCountdownHours) : null,
                    countdownMessage: scheduleCountdownMsg,
                    photoUrl: schedulePhotoUrl || null
                })
            });
            if (res.ok) {
                showNotify('Post scheduled!');
                setScheduleMsg(''); setScheduleAt(''); setScheduleCountdownHours(''); setScheduleCountdownMsg(''); setSchedulePhotoUrl('');
                fetchScheduledPosts();
            } else { const d = await res.json(); showNotify(d.error || 'Failed', 'error'); }
        } catch { showNotify('Error.', 'error'); }
        setScheduleLoading(false);
    };

    const handleDeleteScheduled = async (id) => {
        try {
            await fetch(`${API_BASE}/api/admin/scheduled-posts/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            fetchScheduledPosts();
            showNotify('Scheduled post removed.');
        } catch { showNotify('Error.', 'error'); }
    };

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        setToken(null);
    };

    /* ===== LOGIN SCREEN ===== */
    if (!token) {
        return (
            <div className="admin-view">
                <div className="bg-mesh"></div>
                <Toast notification={notification} />

                <div className="glass-panel admin-login-card">
                    <div className="login-icon-wrap">
                        <Lock size={30} color="var(--gold)" />
                    </div>
                    <h2 className="login-title">Admin Console</h2>
                    <p className="login-subtitle">Sign in to manage your page</p>

                    {notification && (
                        <div className={`alert-box ${notification.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                            {notification.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                            {notification.msg}
                        </div>
                    )}

                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                        <div className="form-group">
                            <label className="form-label">Username</label>
                            <input
                                className="input-elegant"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="Enter username"
                                required
                                autoComplete="username"
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Password</label>
                            <input
                                className="input-elegant"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Enter password"
                                required
                                autoComplete="current-password"
                            />
                        </div>
                        <button
                            className="btn-gold"
                            type="submit"
                            disabled={loading}
                            style={{ marginTop: '0.5rem', fontSize: '1rem', padding: '1.1rem' }}
                        >
                            {loading ? <><Spinner /> Signing in...</> : <><Lock size={18} /> Sign In</>}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    /* ===== NAV CONFIG ===== */
    const navItems = [
        { id: 'dashboard', label: 'Command Center', icon: <LayoutDashboard size={17} /> },
        { id: 'profile', label: 'Profile & Setup', icon: <User size={17} /> },
        { id: 'content', label: 'Page Content', icon: <Type size={17} /> },
        { id: 'pricing', label: 'Pricing & Timer', icon: <Tag size={17} /> },
        { id: 'gallery', label: 'Media Gallery', icon: <ImageIcon size={17} /> },
        { id: 'channels', label: 'Channels', icon: <MessageSquare size={17} /> },
        { id: 'subscriptions', label: 'Subscriptions', icon: <Users size={17} /> },
        { id: 'telegram-tools', label: 'Telegram Tools', icon: <MessageSquare size={17} /> },
    ];

    // Compute Metrics safely
    const safeSubscriptions = Array.isArray(subscriptions) ? subscriptions : [];
    const activeSubs = safeSubscriptions.filter(s => s.status === 'active' && new Date(s.expires_at) > new Date());
    const mrr = activeSubs.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const totalRevenue = safeSubscriptions.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    // Net Revenue = excludes cancelled subscriptions (cancellations are treated as refunds)
    const netRevenue = safeSubscriptions
        .filter(s => s.status !== 'cancelled')
        .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

    /* ===== DASHBOARD ===== */
    return (
        <div className="admin-dashboard">
            <div className="bg-mesh"></div>
            <Toast notification={notification} />

            {/* ===== SIDEBAR ===== */}
            <div className="admin-sidebar">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-title">
                        <Crown size={20} color="var(--gold)" />
                        Admin Hub
                        <span className="sidebar-logo-badge">PRO</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                        Content Management
                    </p>
                </div>

                <p className="sidebar-section-label">Management</p>
                <div className="sidebar-nav">
                    {navItems.map(item => (
                        <div
                            key={item.id}
                            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(item.id)}
                        >
                            {item.icon}
                            {item.label}
                        </div>
                    ))}
                </div>

                <p className="sidebar-section-label">Account</p>
                <div className="sidebar-footer">
                    <div
                        className="nav-item nav-item-danger"
                        onClick={handleLogout}
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <LogOut size={17} />
                        Sign Out
                    </div>
                </div>
            </div>

            {/* ===== MAIN CONTENT ===== */}
            <div className="admin-content">

                {/* ── Command Center Dashboard ── */}
                {activeTab === 'dashboard' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Command Center</h1>
                                <p className="admin-page-subtitle">Welcome back. Here is your platform overview.</p>
                            </div>
                        </div>

                        {/* Maintenance Mode Toggle */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem',
                            background: settingsData.maintenance_mode == 1
                                ? 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)'
                                : 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%)',
                            border: settingsData.maintenance_mode == 1
                                ? '1px solid rgba(245,158,11,0.35)'
                                : '1px solid rgba(16,185,129,0.2)',
                            borderRadius: '16px', padding: '1.25rem 1.5rem', marginBottom: '2rem',
                            transition: 'all 0.4s ease',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{
                                    width: 40, height: 40, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: settingsData.maintenance_mode == 1 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
                                }}>
                                    <Wrench size={18} color={settingsData.maintenance_mode == 1 ? '#F59E0B' : 'var(--green)'} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        Maintenance Mode
                                        <span style={{
                                            fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '9999px',
                                            background: settingsData.maintenance_mode == 1 ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.15)',
                                            color: settingsData.maintenance_mode == 1 ? '#F59E0B' : 'var(--green)',
                                            letterSpacing: '0.05em', textTransform: 'uppercase',
                                        }}>
                                            {settingsData.maintenance_mode == 1 ? 'ACTIVE' : 'OFF'}
                                        </span>
                                    </div>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                                        {settingsData.maintenance_mode == 1
                                            ? 'Site is offline for visitors. Admin panel still accessible.'
                                            : 'Site is live and accessible to all visitors.'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={handleToggleMaintenance}
                                disabled={maintenanceLoading}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.65rem 1.4rem', borderRadius: '9999px', border: 'none',
                                    fontWeight: 700, fontSize: '0.85rem', cursor: maintenanceLoading ? 'not-allowed' : 'pointer',
                                    background: settingsData.maintenance_mode == 1
                                        ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
                                        : 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                                    color: '#fff', transition: 'all 0.3s ease',
                                    boxShadow: settingsData.maintenance_mode == 1
                                        ? '0 0 16px rgba(16,185,129,0.3)'
                                        : '0 0 16px rgba(245,158,11,0.3)',
                                    opacity: maintenanceLoading ? 0.6 : 1,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {maintenanceLoading ? <><Spinner light /> Updating...</> : settingsData.maintenance_mode == 1 ? 'Disable — Go Live' : 'Enable Maintenance'}
                            </button>
                        </div>

                        {/* Maintenance Countdown Settings — visible only when enabled */}
                        {settingsData.maintenance_mode == 1 && (
                            <div style={{
                                background: 'rgba(245,158,11,0.06)',
                                border: '1px solid rgba(245,158,11,0.2)',
                                borderRadius: '16px', padding: '1.25rem 1.5rem',
                                marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                            }}>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#F59E0B', marginBottom: '0.25rem' }}>
                                    ✨ Countdown Page Settings
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Page Headline</label>
                                    <input
                                        type="text"
                                        placeholder="✨ Something special is coming for you!"
                                        value={settingsData.maintenance_title}
                                        onChange={e => setSettingsData(prev => ({ ...prev, maintenance_title: e.target.value }))}
                                        style={{
                                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                                            borderRadius: '10px', padding: '0.65rem 1rem', color: '#fff', fontSize: '0.9rem', outline: 'none',
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Countdown End Date &amp; Time</label>
                                    <input
                                        type="datetime-local"
                                        value={settingsData.maintenance_end_time}
                                        onChange={e => setSettingsData(prev => ({ ...prev, maintenance_end_time: e.target.value }))}
                                        style={{
                                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                                            borderRadius: '10px', padding: '0.65rem 1rem', color: '#fff', fontSize: '0.9rem', outline: 'none',
                                            colorScheme: 'dark',
                                        }}
                                    />
                                </div>
                                <button
                                    onClick={async () => {
                                        setMaintenanceLoading(true);
                                        try {
                                            const res = await fetch(`${API_BASE}/api/admin/settings`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                body: JSON.stringify(settingsData)
                                            });
                                            const data = await res.json();
                                            if (data.success) showNotify('Countdown settings saved!');
                                            else showNotify('Failed to save settings.', 'error');
                                        } catch { showNotify('Network error.', 'error'); }
                                        setMaintenanceLoading(false);
                                    }}
                                    disabled={maintenanceLoading}
                                    style={{
                                        alignSelf: 'flex-start', padding: '0.6rem 1.4rem', borderRadius: '9999px',
                                        background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                                        border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                                        cursor: maintenanceLoading ? 'not-allowed' : 'pointer',
                                        opacity: maintenanceLoading ? 0.6 : 1,
                                    }}
                                >
                                    {maintenanceLoading ? 'Saving...' : 'Save Countdown Settings'}
                                </button>
                            </div>
                        )}

                        {/* Revenue Metrics */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                            <div style={{ background: 'linear-gradient(145deg, rgba(34,212,122,0.1) 0%, rgba(34,212,122,0.02) 100%)', border: '1px solid rgba(34,212,122,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
                                <div style={{ color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                                    <BarChart2 size={18} /> MRR (Monthly)
                                </div>
                                <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', margin: 0 }}>₹{mrr.toLocaleString()}</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>From {activeSubs.length} active subscribers</p>
                            </div>
                            
                            <div style={{ background: 'linear-gradient(145deg, rgba(245,200,66,0.1) 0%, rgba(245,200,66,0.02) 100%)', border: '1px solid rgba(245,200,66,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
                                <div style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                                    <DollarSign size={18} /> Net Revenue
                                </div>
                                <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', margin: 0 }}>₹{netRevenue.toLocaleString()}</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Excludes cancellations · Gross ₹{totalRevenue.toLocaleString()}</p>
                            </div>

                            <div style={{ background: 'linear-gradient(145deg, rgba(168,85,247,0.1) 0%, rgba(168,85,247,0.02) 100%)', border: '1px solid rgba(168,85,247,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
                                <div style={{ color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                                    <Users size={18} /> Audience Retention
                                </div>
                                <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', margin: 0 }}>{subStats.total > 0 ? Math.round((activeSubs.length / subStats.total) * 100) : 0}%</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>{subStats.cancelled} cancelled historically</p>
                            </div>

                            {channelStats.vipOnly !== null && (
                                <div style={{ background: 'linear-gradient(145deg, rgba(236,72,153,0.1) 0%, rgba(236,72,153,0.02) 100%)', border: '1px solid rgba(236,72,153,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
                                    <div style={{ color: '#EC4899', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                                        📸 VIP Members (₹299)
                                    </div>
                                    <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', margin: 0 }}>{channelStats.vipOnly.toLocaleString()}</h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Photos-only channel members</p>
                                </div>
                            )}

                            {channelStats.vip !== null && (
                                <div style={{ background: 'linear-gradient(145deg, rgba(229,165,75,0.1) 0%, rgba(229,165,75,0.02) 100%)', border: '1px solid rgba(229,165,75,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
                                    <div style={{ color: '#E5A54B', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                                        🔥 VIP+ Members (₹399)
                                    </div>
                                    <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', margin: 0 }}>{channelStats.vip.toLocaleString()}</h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Photos + Videos channel members</p>
                                </div>
                            )}

                            {channelStats.public !== null && (
                                <div style={{ background: 'linear-gradient(145deg, rgba(56,189,248,0.1) 0%, rgba(56,189,248,0.02) 100%)', border: '1px solid rgba(56,189,248,0.2)', padding: '1.5rem', borderRadius: '16px' }}>
                                    <div style={{ color: '#38BDF8', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
                                        <Users size={18} /> Public Channel
                                    </div>
                                    <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', margin: 0 }}>{channelStats.public.toLocaleString()}</h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Total followers (free audience)</p>
                                </div>
                            )}
                        </div>

                        {/* God-Mode Broadcast Tool */}
                        <SectionCard
                            title={<span style={{ color: 'var(--rose)' }}>GOD MODE: Mass Telegram Broadcast</span>}
                            icon={<Send size={18} color="var(--rose)" />}
                        >
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                                Type a message below to instantly DM all <b>{activeSubs.length} active subscribers</b> via your Telegram bot. Ideal for high-urgency upsells, exclusive drops, and announcements.
                            </p>
                            <textarea
                                className="input-elegant"
                                rows={4}
                                value={broadcastMsg}
                                onChange={e => setBroadcastMsg(e.target.value)}
                                placeholder="Hey everyone! I just dropped a highly requested video in the channel..."
                                style={{ border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.02)' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button 
                                    className="btn-gold" 
                                    onClick={handleBroadcast} 
                                    disabled={broadcastLoading || !broadcastMsg.trim() || activeSubs.length === 0}
                                    style={{ background: 'var(--rose)', color: '#fff', padding: '0.75rem 1.5rem', boxShadow: '0 0 15px rgba(244,63,94,0.3)' }}
                                >
                                    {broadcastLoading ? <><Spinner light /> Transmitting...</> : <><Send size={16} /> Broadcast to {activeSubs.length} Users</>}
                                </button>
                            </div>
                        </SectionCard>

                        {/* Public Channel Promo */}
                        <SectionCard
                            title={<span style={{ color: 'var(--purple)' }}>Post to Public Channel</span>}
                            icon={<Globe size={18} color="var(--purple)" />}
                        >
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                                Post a promo message to your <b>public channel</b> with a "Join VIP" button automatically attached. A weekly subscriber count post goes out every Monday automatically.
                            </p>
                            <textarea
                                className="input-elegant"
                                rows={5}
                                value={promoMsg}
                                onChange={e => setPromoMsg(e.target.value)}
                                placeholder="Write your promo message..."
                                style={{ border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.02)' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    A <b style={{ color: 'var(--purple)' }}>Join VIP Now</b> button is auto-appended to every post.
                                </p>
                                <button
                                    className="btn-gold"
                                    onClick={handlePostToPublic}
                                    disabled={promoLoading || !promoMsg.trim()}
                                    style={{ background: 'var(--purple-gradient)', color: '#fff', padding: '0.75rem 1.5rem', boxShadow: '0 0 15px rgba(168,85,247,0.3)' }}
                                >
                                    {promoLoading ? <><Spinner light /> Posting...</> : <><Globe size={16} /> Post to Public Channel</>}
                                </button>
                            </div>
                        </SectionCard>
                    </>
                )}

                {/* ── Profile & Setup ── */}
                {activeTab === 'profile' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Profile & Setup</h1>
                                <p className="admin-page-subtitle">Configure your public profile and payment details</p>
                            </div>
                            <button onClick={handleUpdateSettings} className="btn-save" disabled={loading}>
                                {loading ? <><Spinner /> Saving...</> : <><CheckCircle2 size={16} /> Save Changes</>}
                            </button>
                        </div>

                        <SectionCard
                            title="Payment & Channel"
                            icon={<DollarSign size={16} color="var(--gold)" />}
                        >
                            <div className="form-grid form-grid-2">
                                <Field
                                    label="UPI ID"
                                    value={settingsData.upi_id}
                                    field="upi_id"
                                    placeholder="yourname@bank"
                                    hint="Users will pay to this UPI ID"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Telegram Channel URL"
                                    value={settingsData.telegram_channel_url}
                                    field="telegram_channel_url"
                                    placeholder="https://t.me/yourchannel"
                                    hint="Redirect after payment verification"
                                    onChange={updateField}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard
                            title="Public Profile"
                            icon={<User size={16} color="var(--purple)" />}
                        >
                            <div className="form-grid">
                                <div className="form-grid form-grid-2">
                                    <Field
                                        label="Display Name"
                                        value={settingsData.profile_name}
                                        field="profile_name"
                                        placeholder="Your Name"
                                        onChange={updateField}
                                    />
                                    <Field
                                        label="Handle / Username"
                                        value={settingsData.profile_handle}
                                        field="profile_handle"
                                        placeholder="@yourhandle"
                                        onChange={updateField}
                                    />
                                </div>
                                <div className="form-grid form-grid-2">
                                    <Field
                                        label="Members / Fans Count"
                                        value={settingsData.fans_count}
                                        field="fans_count"
                                        placeholder="25.4K"
                                        onChange={updateField}
                                    />
                                    <Field
                                        label="Content Count"
                                        value={settingsData.videos_count}
                                        field="videos_count"
                                        placeholder="840+"
                                        onChange={updateField}
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Profile Avatar</label>
                                    <div className="avatar-upload-row" style={{ marginBottom: '0.75rem' }}>
                                        {settingsData.profile_avatar && (
                                            <img
                                                src={settingsData.profile_avatar}
                                                alt="Avatar"
                                                className="avatar-preview-sm"
                                            />
                                        )}
                                        <button
                                            type="button"
                                            className="btn-upload"
                                            onClick={() => avatarInputRef.current?.click()}
                                        >
                                            <Camera size={15} /> Upload Photo
                                        </button>
                                        <input
                                            type="file"
                                            ref={avatarInputRef}
                                            style={{ display: 'none' }}
                                            accept="image/*"
                                            onChange={handleAvatarUpload}
                                        />
                                    </div>
                                    <input
                                        className="input-elegant"
                                        value={settingsData.profile_avatar}
                                        onChange={e => updateField('profile_avatar', e.target.value)}
                                        placeholder="Or paste image URL directly"
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Cover / Background Image</label>
                                    <div style={{
                                        marginBottom: '0.75rem',
                                        borderRadius: '12px',
                                        overflow: 'hidden',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        background: 'rgba(0,0,0,0.25)',
                                        position: 'relative'
                                    }}>
                                        <img
                                            src={settingsData.cover_image_url || 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=2000'}
                                            alt="Cover preview"
                                            style={{
                                                width: '100%',
                                                height: '140px',
                                                objectFit: 'cover',
                                                display: 'block',
                                                opacity: settingsData.cover_image_url ? 1 : 0.5
                                            }}
                                        />
                                        {!settingsData.cover_image_url && (
                                            <span style={{
                                                position: 'absolute', top: '50%', left: '50%',
                                                transform: 'translate(-50%,-50%)',
                                                fontSize: '0.75rem', color: 'var(--text-muted)',
                                                background: 'rgba(0,0,0,0.6)', padding: '0.3rem 0.8rem',
                                                borderRadius: '6px', pointerEvents: 'none'
                                            }}>Using default</span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                        <button
                                            type="button"
                                            className="btn-upload"
                                            onClick={() => coverInputRef.current?.click()}
                                        >
                                            <Upload size={15} /> Upload Cover Image
                                        </button>
                                        {settingsData.cover_image_url && (
                                            <button
                                                type="button"
                                                className="btn-upload"
                                                style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.25)' }}
                                                onClick={() => updateField('cover_image_url', '')}
                                            >
                                                <Trash2 size={14} /> Remove
                                            </button>
                                        )}
                                        <input
                                            type="file"
                                            ref={coverInputRef}
                                            style={{ display: 'none' }}
                                            accept="image/*"
                                            onChange={handleCoverUpload}
                                        />
                                    </div>
                                    <input
                                        className="input-elegant"
                                        value={settingsData.cover_image_url || ''}
                                        onChange={e => updateField('cover_image_url', e.target.value)}
                                        placeholder="Or paste image URL directly"
                                    />
                                    <p className="input-hint">Wide banner shown at the top of your page. Leave empty for default.</p>
                                </div>

                                <Field
                                    label="Bio / About"
                                    value={settingsData.bio_text}
                                    field="bio_text"
                                    rows={3}
                                    placeholder="Write something about yourself..."
                                    onChange={updateField}
                                />
                            </div>
                        </SectionCard>
                    </>
                )}

                {/* ── Page Content ── */}
                {activeTab === 'content' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Page Content</h1>
                                <p className="admin-page-subtitle">Edit all text shown on your public page</p>
                            </div>
                            <button onClick={handleUpdateSettings} className="btn-save" disabled={loading}>
                                {loading ? <><Spinner /> Saving...</> : <><CheckCircle2 size={16} /> Save Content</>}
                            </button>
                        </div>

                        <SectionCard
                            title="Offer Section"
                            icon={<Crown size={16} color="var(--gold)" />}
                        >
                            <div className="form-grid">
                                <Field
                                    label="Offer Badge / Tag"
                                    value={settingsData.offer_tag || ''}
                                    field="offer_tag"
                                    placeholder="FLASH SALE ACTIVE"
                                    hint="Small badge shown above the offer title"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Offer Title"
                                    value={settingsData.offer_title || ''}
                                    field="offer_title"
                                    placeholder="Lifetime VIP Access Pass"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Offer Description"
                                    value={settingsData.offer_subtitle || ''}
                                    field="offer_subtitle"
                                    rows={2}
                                    placeholder="One-time payment. Zero monthly rebills..."
                                    onChange={updateField}
                                />
                                <Field
                                    label="CTA Button Text"
                                    value={settingsData.cta_button_text || ''}
                                    field="cta_button_text"
                                    placeholder="Unlock VIP Access Now"
                                    onChange={updateField}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard
                            title="Gallery & Rotating Texts"
                            icon={<Video size={16} color="var(--green)" />}
                        >
                            <div className="form-grid">
                                <Field
                                    label="Gallery Section Title"
                                    value={settingsData.section_title || ''}
                                    field="section_title"
                                    placeholder="Exclusive Previews"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Rotating Text 1"
                                    value={settingsData.rotating_text_1 || ''}
                                    field="rotating_text_1"
                                    placeholder="🔒 PRIVATE CHAT & VIDEO CALL"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Rotating Text 2"
                                    value={settingsData.rotating_text_2 || ''}
                                    field="rotating_text_2"
                                    placeholder="✨ Exclusive Content & Private Access"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Rotating Text 3"
                                    value={settingsData.rotating_text_3 || ''}
                                    field="rotating_text_3"
                                    placeholder="🎬 200+ Photos/Videos Inside"
                                    onChange={updateField}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard
                            title="Checkout Modal"
                            icon={<MessageSquare size={16} color="var(--purple)" />}
                        >
                            <div className="form-grid">
                                <Field
                                    label="Checkout Title"
                                    value={settingsData.checkout_title || ''}
                                    field="checkout_title"
                                    placeholder="Unlock One Month Exclusive Content"
                                    onChange={updateField}
                                />
                                <Field
                                    label="Checkout Subtitle"
                                    value={settingsData.checkout_subtitle || ''}
                                    field="checkout_subtitle"
                                    placeholder="Pay securely via any UPI app..."
                                    onChange={updateField}
                                />
                            </div>
                        </SectionCard>
                    </>
                )}

                {/* ── Pricing & Timer ── */}
                {activeTab === 'pricing' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Pricing & Timer</h1>
                                <p className="admin-page-subtitle">Set your offer price and countdown timer</p>
                            </div>
                            <button onClick={handleUpdateOffer} className="btn-save" disabled={loading}>
                                {loading ? <><Spinner /> Saving...</> : <><CheckCircle2 size={16} /> Deploy Pricing</>}
                            </button>
                        </div>

                        <SectionCard
                            title="Offer Pricing"
                            icon={<DollarSign size={16} color="var(--gold)" />}
                        >
                            <div className="form-grid form-grid-2">
                                <div className="form-group">
                                    <label className="form-label">Original Price (₹)</label>
                                    <input
                                        className="input-elegant"
                                        type="number"
                                        value={offerData.original_price}
                                        onChange={e => setOfferData({ ...offerData, original_price: e.target.value })}
                                        placeholder="899"
                                    />
                                    <p className="input-hint">Shown with strikethrough to indicate savings</p>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Sale Price (₹)</label>
                                    <input
                                        className="input-elegant"
                                        type="number"
                                        value={offerData.discounted_price}
                                        onChange={e => setOfferData({ ...offerData, discounted_price: e.target.value })}
                                        placeholder="399"
                                    />
                                    <p className="input-hint">This is the actual amount users pay</p>
                                </div>
                            </div>

                            {/* Live preview */}
                            {offerData.original_price && offerData.discounted_price && (
                                <div style={{
                                    marginTop: '1.25rem', padding: '1rem 1.25rem',
                                    background: 'rgba(245,200,66,0.06)',
                                    border: '1px solid rgba(245,200,66,0.15)',
                                    borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'
                                }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview:</span>
                                    <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: '1rem' }}>₹{offerData.original_price}</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--gold)' }}>₹{offerData.discounted_price}</span>
                                    <span style={{
                                        background: 'rgba(34,212,122,0.1)', border: '1px solid rgba(34,212,122,0.2)',
                                        color: '#22D47A', fontSize: '0.78rem', fontWeight: 700,
                                        padding: '0.2rem 0.6rem', borderRadius: '9999px'
                                    }}>
                                        {Math.round((1 - offerData.discounted_price / offerData.original_price) * 100)}% OFF
                                    </span>
                                </div>
                            )}
                        </SectionCard>

                        <SectionCard
                            title="Countdown Timer"
                            icon={<Clock size={16} color="var(--rose)" />}
                        >
                            <div className="form-group">
                                <label className="form-label">Timer End Date & Time</label>
                                <input
                                    className="input-elegant"
                                    type="datetime-local"
                                    value={offerData.timer_end_date}
                                    onChange={e => setOfferData({ ...offerData, timer_end_date: e.target.value })}
                                />
                                <p className="input-hint">Leave empty to hide the countdown timer</p>
                            </div>
                        </SectionCard>
                    </>
                )}

                {/* ── Media Gallery ── */}
                {activeTab === 'gallery' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Media Gallery</h1>
                                <p className="admin-page-subtitle">Upload images & videos shown as blurred previews</p>
                            </div>
                        </div>

                        <div className="admin-section-card">
                            <div className="admin-section-header">
                                <div className="admin-section-title">
                                    <Upload size={16} color="var(--gold)" />
                                    Upload Media
                                </div>
                            </div>
                            <div className="admin-section-body">
                                <div style={{ marginBottom: '1rem' }}>
                                    <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Post to Telegram</p>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        {[
                                            { value: 'none', label: '🚫 Don\'t Post' },
                                            { value: 'vip', label: '🎯 Smart Route (VIP + VIP+ + Public blur)' },
                                            { value: 'public', label: '📢 Public Only' },
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => setPostDestination(opt.value)}
                                                style={{
                                                    padding: '0.4rem 0.9rem',
                                                    borderRadius: '8px',
                                                    border: postDestination === opt.value ? '2px solid var(--gold)' : '2px solid var(--border)',
                                                    background: postDestination === opt.value ? 'rgba(229,165,75,0.15)' : 'var(--surface)',
                                                    color: postDestination === opt.value ? 'var(--gold)' : 'var(--text-secondary)',
                                                    fontWeight: 600,
                                                    fontSize: '0.82rem',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s'
                                                }}
                                            >{opt.label}</button>
                                        ))}
                                    </div>
                                    {postDestination === 'vip' && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.5 }}>
                                            📸 <b>Photo:</b> Full to VIP (₹299) + VIP+ (₹399) · Blurred teaser to Public<br/>
                                            🎬 <b>Video:</b> Full to VIP+ only · Blurred teaser to Public · VIP (₹299) skipped
                                        </p>
                                    )}
                                    {postDestination === 'public' && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                                            Posts content to public channel only (no blur)
                                        </p>
                                    )}
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Post Caption</label>
                                    <textarea
                                        className="input-elegant"
                                        rows={3}
                                        value={editorCaption}
                                        onChange={(e) => setMediaCaptions(prev => ({ ...prev, [captionEditorKey]: e.target.value }))}
                                        placeholder={`Write ${captionEditorKey.toUpperCase()} caption (optional)`}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
                                    {[
                                        { value: 'auto', label: 'Auto' },
                                        { value: 'vip', label: 'VIP Preview' },
                                        { value: 'public', label: 'Public Preview' }
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setCaptionPreviewMode(opt.value)}
                                            style={{
                                                padding: '0.35rem 0.75rem',
                                                borderRadius: '999px',
                                                border: captionPreviewMode === opt.value ? '1px solid var(--gold)' : '1px solid var(--border)',
                                                background: captionPreviewMode === opt.value ? 'rgba(229,165,75,0.16)' : 'var(--surface)',
                                                color: captionPreviewMode === opt.value ? 'var(--gold)' : 'var(--text-secondary)',
                                                fontSize: '0.76rem',
                                                fontWeight: 700,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <div
                                    style={{
                                        marginBottom: '1rem',
                                        border: '1px solid var(--border)',
                                        borderRadius: '12px',
                                        background: 'var(--surface)',
                                        overflow: 'hidden'
                                    }}
                                >
                                    <div
                                        style={{
                                            padding: '0.55rem 0.85rem',
                                            borderBottom: '1px solid var(--border)',
                                            fontSize: '0.74rem',
                                            letterSpacing: '0.06em',
                                            textTransform: 'uppercase',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)'
                                        }}
                                    >
                                        Caption Preview
                                    </div>
                                    <div style={{ padding: '0.8rem 0.85rem', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                                        {previewTypedCaption
                                            ? previewTypedCaption
                                            : (previewCaptionKey === 'vip')
                                                ? '📸/🎬 New media just dropped! 🔥\n\nEnjoy the exclusive content!'
                                                : (previewCaptionKey === 'public')
                                                    ? '📸/🎬 New media just posted! 🎉'
                                                    : 'Upload only mode selected (no Telegram post).'}
                                    </div>
                                </div>
                                <div
                                    className="upload-box"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        style={{ display: 'none' }}
                                        onChange={handleUploadMedia}
                                        accept="image/*,video/*"
                                    />
                                    <div className="upload-icon">
                                        <Upload size={24} color="var(--gold)" />
                                    </div>
                                    <p className="upload-title">Click to upload media</p>
                                    <p className="upload-subtitle">Supports JPG, PNG, MP4, MOV • Max 50MB</p>
                                </div>
                            </div>
                        </div>

                        <div className="admin-section-card">
                            <div className="admin-section-header">
                                <div className="admin-section-title">
                                    <ImageIcon size={16} color="var(--text-secondary)" />
                                    Gallery ({previews.length} items)
                                </div>
                            </div>
                            <div className="admin-section-body">
                                {previews.length === 0 ? (
                                    <div className="empty-gallery">
                                        <ImageIcon size={32} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
                                        <p>No media uploaded yet.</p>
                                        <p style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}>Use the upload area above to add content.</p>
                                    </div>
                                ) : (
                                    <div className="admin-gallery">
                                        {previews.map(p => (
                                            <div key={p.id} className="admin-gallery-item">
                                                <button
                                                    className="delete-media"
                                                    onClick={() => handleDeleteMedia(p.id)}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                                {p.type === 'video' ? (
                                                    <video src={`${API_BASE}${p.url}`} muted loop />
                                                ) : (
                                                    <img
                                                        src={p.url.startsWith('http') ? p.url : `${API_BASE}${p.url}`}
                                                        alt="Preview"
                                                    />
                                                )}
                                                <div className="gallery-item-label">
                                                    {p.type === 'video' ? '▶ Video' : '⬛ Image'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* ── Subscriptions ── */}
                {activeTab === 'subscriptions' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Subscriptions</h1>
                                <p className="admin-page-subtitle">Manage monthly subscriber access & payments</p>
                            </div>
                            <button className="btn-primary" onClick={fetchSubscriptions} style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                                Refresh
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            {[
                                { label: 'Total', value: subStats.total, color: 'var(--blue)' },
                                { label: 'Active', value: subStats.active, color: 'var(--green)' },
                                { label: 'Expired', value: subStats.expired, color: 'var(--gold)' },
                                { label: 'Cancelled', value: subStats.cancelled, color: 'var(--rose)' },
                            ].map(s => (
                                <div key={s.label} style={{
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--card-border)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '1rem',
                                    textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: s.color }}>{s.value || 0}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{s.label}</div>
                                </div>
                            ))}
                        </div>

                        <div className="admin-section-card">
                            <div className="admin-section-header">
                                <div className="admin-section-title">
                                    <Crown size={16} color="var(--gold)" />
                                    All Subscriptions ({subscriptions.length})
                                </div>
                            </div>
                            <div className="admin-section-body" style={{ padding: 0 }}>
                                {subscriptions.length === 0 ? (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        <Crown size={32} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
                                        <p>No subscriptions yet.</p>
                                        <p style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}>Subscriptions will appear here after payments.</p>
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{
                                            width: '100%',
                                            borderCollapse: 'collapse',
                                            fontSize: '0.82rem'
                                        }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                                                    {['#', 'User', 'Phone', 'Amount', 'Status', 'Expires', 'Actions'].map(h => (
                                                        <th key={h} style={{
                                                            padding: '0.75rem 0.6rem',
                                                            textAlign: 'left',
                                                            fontWeight: 600,
                                                            color: 'var(--text-secondary)',
                                                            whiteSpace: 'nowrap'
                                                        }}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {subscriptions.map((sub, idx) => {
                                                    const isActive = sub.status === 'active' && new Date(sub.expires_at) > new Date();
                                                    const isExpired = sub.status === 'expired' || (sub.status === 'active' && new Date(sub.expires_at) <= new Date());
                                                    const statusColor = isActive ? 'var(--green)' : sub.status === 'cancelled' ? 'var(--rose)' : 'var(--gold)';
                                                    const statusText = isActive ? 'Active' : isExpired ? 'Expired' : 'Cancelled';

                                                    return (
                                                        <tr key={sub.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                                                            <td style={{ padding: '0.6rem', color: 'var(--text-muted)' }}>{idx + 1}</td>
                                                            <td style={{ padding: '0.6rem' }}>
                                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                    {sub.telegram_username || 'N/A'}
                                                                </div>
                                                                {sub.telegram_user_id && (
                                                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                                        ID: {sub.telegram_user_id}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td style={{ padding: '0.6rem', color: 'var(--text-secondary)' }}>{sub.phone || '—'}</td>
                                                            <td style={{ padding: '0.6rem', color: 'var(--text-primary)', fontWeight: 600 }}>₹{sub.amount}</td>
                                                            <td style={{ padding: '0.6rem' }}>
                                                                <span style={{
                                                                    display: 'inline-block',
                                                                    padding: '0.2rem 0.6rem',
                                                                    borderRadius: '9999px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 700,
                                                                    background: `${statusColor}22`,
                                                                    color: statusColor,
                                                                    border: `1px solid ${statusColor}44`
                                                                }}>
                                                                    {statusText}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '0.6rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                                {sub.expires_at ? new Date(sub.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                                            </td>
                                                            <td style={{ padding: '0.6rem' }}>
                                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                                    {isActive ? (
                                                                        <button
                                                                            onClick={() => handleCancelSub(sub.id)}
                                                                            style={{
                                                                                padding: '0.3rem 0.6rem',
                                                                                borderRadius: '6px',
                                                                                border: '1px solid rgba(244,63,94,0.3)',
                                                                                background: 'rgba(244,63,94,0.1)',
                                                                                color: 'var(--rose)',
                                                                                cursor: 'pointer',
                                                                                fontSize: '0.72rem',
                                                                                fontWeight: 600
                                                                            }}
                                                                        >Cancel</button>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => handleReactivateSub(sub.id)}
                                                                            style={{
                                                                                padding: '0.3rem 0.6rem',
                                                                                borderRadius: '6px',
                                                                                border: '1px solid rgba(16,185,129,0.3)',
                                                                                background: 'rgba(16,185,129,0.1)',
                                                                                color: 'var(--green)',
                                                                                cursor: 'pointer',
                                                                                fontSize: '0.72rem',
                                                                                fontWeight: 600
                                                                            }}
                                                                        >Reactivate</button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleDeleteSub(sub.id)}
                                                                        title="Permanently delete this user record"
                                                                        style={{
                                                                            padding: '0.3rem 0.6rem',
                                                                            borderRadius: '6px',
                                                                            border: '1px solid rgba(124,124,124,0.3)',
                                                                            background: 'rgba(124,124,124,0.1)',
                                                                            color: 'var(--text-muted)',
                                                                            cursor: 'pointer',
                                                                            fontSize: '0.72rem',
                                                                            fontWeight: 600
                                                                        }}
                                                                    >🗑 Delete</button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="admin-section-card" style={{ marginTop: '1rem' }}>
                            <div className="admin-section-header">
                                <div className="admin-section-title">
                                    <Type size={16} color="var(--text-secondary)" />
                                    How It Works
                                </div>
                            </div>
                            <div className="admin-section-body" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                <p><strong style={{ color: 'var(--text-primary)' }}>Auto-expiry:</strong> Subscriptions auto-expire after 30 days. The system checks every hour and kicks expired users from the Telegram channel.</p>
                                <p style={{ marginTop: '0.5rem' }}><strong style={{ color: 'var(--text-primary)' }}>Manual control:</strong> Use Cancel to immediately revoke access, or Reactivate to grant 30 more days.</p>
                                <p style={{ marginTop: '0.5rem' }}><strong style={{ color: 'var(--text-primary)' }}>Renewal:</strong> Users must pay again each month to rejoin. They receive a notification when access is removed.</p>
                            </div>
                        </div>
                    </>
                )}

                {/* ── Channels ── */}
                {activeTab === 'channels' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Channels</h1>
                                <p className="admin-page-subtitle">Manage and post to your VIP, VIP+, and Public channels</p>
                            </div>
                        </div>

                        {/* Channel Overview */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                            {/* Public Channel Card */}
                            <div style={{ background: 'linear-gradient(145deg, rgba(56,189,248,0.08) 0%, rgba(56,189,248,0.02) 100%)', border: '1px solid rgba(56,189,248,0.25)', padding: '1.5rem', borderRadius: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                    <div>
                                        <div style={{ color: '#38BDF8', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.3rem' }}>📣 PUBLIC CHANNEL</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Free · Teaser content</div>
                                    </div>
                                    <div style={{ fontSize: '2rem', fontWeight: 900, color: '#fff' }}>{channelStats.public !== null ? channelStats.public.toLocaleString() : '—'}</div>
                                </div>
                                <textarea
                                    value={channelPostMsg.public}
                                    onChange={(e) => setChannelPostMsg(prev => ({ ...prev, public: e.target.value }))}
                                    placeholder="Write a message to post to Public channel... (HTML supported: <b>bold</b>, <i>italic</i>)"
                                    rows={4}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(56,189,248,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem', marginBottom: '0.7rem', resize: 'vertical', fontFamily: 'inherit' }}
                                />
                                <button
                                    onClick={() => handlePostToChannel('public')}
                                    disabled={channelPostLoading.public}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: 'none', background: '#38BDF8', color: '#000', fontWeight: 700, cursor: channelPostLoading.public ? 'not-allowed' : 'pointer', opacity: channelPostLoading.public ? 0.6 : 1 }}
                                >{channelPostLoading.public ? 'Posting...' : '📣 Post to Public'}</button>
                            </div>

                            {/* VIP Channel Card (₹299) */}
                            <div style={{ background: 'linear-gradient(145deg, rgba(236,72,153,0.08) 0%, rgba(236,72,153,0.02) 100%)', border: '1px solid rgba(236,72,153,0.25)', padding: '1.5rem', borderRadius: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                    <div>
                                        <div style={{ color: '#EC4899', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.3rem' }}>📸 VIP CHANNEL</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>₹299/mo · Photos only</div>
                                    </div>
                                    <div style={{ fontSize: '2rem', fontWeight: 900, color: '#fff' }}>{channelStats.vipOnly !== null ? channelStats.vipOnly.toLocaleString() : '—'}</div>
                                </div>
                                <textarea
                                    value={channelPostMsg.vip}
                                    onChange={(e) => setChannelPostMsg(prev => ({ ...prev, vip: e.target.value }))}
                                    placeholder="Write a message to post to VIP channel (₹299)..."
                                    rows={4}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(236,72,153,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem', marginBottom: '0.7rem', resize: 'vertical', fontFamily: 'inherit' }}
                                />
                                <button
                                    onClick={() => handlePostToChannel('vip')}
                                    disabled={channelPostLoading.vip}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: 'none', background: '#EC4899', color: '#fff', fontWeight: 700, cursor: channelPostLoading.vip ? 'not-allowed' : 'pointer', opacity: channelPostLoading.vip ? 0.6 : 1 }}
                                >{channelPostLoading.vip ? 'Posting...' : '📸 Post to VIP'}</button>
                            </div>

                            {/* VIP+ Channel Card (₹399) */}
                            <div style={{ background: 'linear-gradient(145deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)', border: '1px solid rgba(245,158,11,0.25)', padding: '1.5rem', borderRadius: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                    <div>
                                        <div style={{ color: '#F59E0B', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.3rem' }}>🔥 VIP+ CHANNEL</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>₹399/mo · Photos + Videos</div>
                                    </div>
                                    <div style={{ fontSize: '2rem', fontWeight: 900, color: '#fff' }}>{channelStats.vip !== null ? channelStats.vip.toLocaleString() : '—'}</div>
                                </div>
                                <textarea
                                    value={channelPostMsg.vipplus}
                                    onChange={(e) => setChannelPostMsg(prev => ({ ...prev, vipplus: e.target.value }))}
                                    placeholder="Write a message to post to VIP+ channel (₹399)..."
                                    rows={4}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem', marginBottom: '0.7rem', resize: 'vertical', fontFamily: 'inherit' }}
                                />
                                <button
                                    onClick={() => handlePostToChannel('vipplus')}
                                    disabled={channelPostLoading.vipplus}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: 'none', background: '#F59E0B', color: '#000', fontWeight: 700, cursor: channelPostLoading.vipplus ? 'not-allowed' : 'pointer', opacity: channelPostLoading.vipplus ? 0.6 : 1 }}
                                >{channelPostLoading.vipplus ? 'Posting...' : '🔥 Post to VIP+'}</button>
                            </div>
                        </div>

                        {/* Smart Routing Info */}
                        <div className="admin-section-card" style={{ marginTop: '1rem' }}>
                            <div className="admin-section-header">
                                <div className="admin-section-title">
                                    <MessageSquare size={16} color="var(--text-secondary)" />
                                    📤 Smart Content Routing (Photos & Videos)
                                </div>
                            </div>
                            <div className="admin-section-body" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                <p><strong style={{ color: 'var(--text-primary)' }}>For media with smart routing</strong>, use the Telegram bot DM:</p>
                                <ul style={{ marginTop: '0.6rem', paddingLeft: '1.2rem' }}>
                                    <li><strong style={{ color: '#EC4899' }}>📸 Photo</strong> → Full to VIP + VIP+, blurred to Public</li>
                                    <li><strong style={{ color: '#F59E0B' }}>🎬 Video</strong> → Full to VIP+ only, blurred thumbnail to Public (VIP skipped — photos only)</li>
                                    <li><strong style={{ color: 'var(--gold)' }}>🖼 Album / Carousel (up to 10)</strong> → Send multiple as one group, bot asks routing</li>
                                </ul>
                                <p style={{ marginTop: '0.8rem' }}>Just DM the bot with your photo/video/album and it will ask you how to distribute it.</p>
                            </div>
                        </div>
                    </>
                )}

                {/* ── Telegram Tools ── */}
                {activeTab === 'telegram-tools' && (
                    <>
                        <div className="admin-page-header">
                            <div>
                                <h1 className="admin-page-title">Telegram Tools</h1>
                                <p className="admin-page-subtitle">Polls, countdowns, and scheduled posts</p>
                            </div>
                        </div>

                        {/* Poll Creator */}
                        <SectionCard title="Post a Poll" icon={<BarChart2 size={16} color="var(--gold)" />}>
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                {['vip', 'public'].map(ch => (
                                    <button key={ch} onClick={() => setPollChannel(ch)} style={{
                                        padding: '0.4rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                                        border: pollChannel === ch ? '2px solid var(--gold)' : '2px solid var(--border)',
                                        background: pollChannel === ch ? 'rgba(229,165,75,0.15)' : 'var(--surface)',
                                        color: pollChannel === ch ? 'var(--gold)' : 'var(--text-secondary)'
                                    }}>{ch === 'vip' ? '💎 VIP Channel' : '📢 Public Channel'}</button>
                                ))}
                            </div>
                            <input className="input-elegant" placeholder="Poll question..." value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} style={{ marginBottom: '0.75rem' }} />
                            {pollOptions.map((opt, i) => (
                                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                                    <input className="input-elegant" placeholder={`Option ${i + 1}`} value={opt} onChange={e => { const o = [...pollOptions]; o[i] = e.target.value; setPollOptions(o); }} style={{ flex: 1 }} />
                                    {pollOptions.length > 2 && (
                                        <button onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)' }}><X size={16} /></button>
                                    )}
                                </div>
                            ))}
                            {pollOptions.length < 10 && (
                                <button onClick={() => setPollOptions([...pollOptions, ''])} style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: '8px', padding: '0.4rem 0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem', marginBottom: '1rem' }}>
                                    <Plus size={14} style={{ marginRight: '0.3rem' }} /> Add Option
                                </button>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="btn-gold" onClick={handlePostPoll} disabled={pollLoading}>
                                    {pollLoading ? <><Spinner light /> Posting...</> : <><BarChart2 size={15} /> Post Poll</>}
                                </button>
                            </div>
                        </SectionCard>

                        {/* Countdown Teaser */}
                        <SectionCard title="Countdown Teaser (to Public Channel)" icon={<Clock size={16} color="var(--gold)" />}>
                            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                Posts a countdown message to the public channel and <b>pins it</b> so everyone sees it.
                            </p>
                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                <div style={{ flex: '0 0 120px' }}>
                                    <label className="form-label">Hours from now</label>
                                    <input className="input-elegant" type="number" min="1" value={countdownHours} onChange={e => setCountdownHours(e.target.value)} placeholder="24" />
                                </div>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <label className="form-label">Teaser message (optional)</label>
                                    <input className="input-elegant" value={countdownMessage} onChange={e => setCountdownMessage(e.target.value)} placeholder="Something special is coming 👀" />
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="btn-gold" onClick={handlePostCountdown} disabled={countdownLoading}>
                                    {countdownLoading ? <><Spinner light /> Posting...</> : <><Clock size={15} /> Post & Pin Countdown</>}
                                </button>
                            </div>
                        </SectionCard>

                        {/* Poll History */}
                        {postedPolls.length > 0 && (
                            <SectionCard title={`Poll History (${postedPolls.length})`} icon={<BarChart2 size={16} color="var(--text-secondary)" />}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {postedPolls.map(p => (
                                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', borderRadius: '10px', padding: '0.65rem 1rem', border: '1px solid var(--border)' }}>
                                            <div>
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: '4px', marginRight: '0.5rem', background: p.channel === 'vip' ? 'rgba(229,165,75,0.15)' : 'rgba(168,85,247,0.15)', color: p.channel === 'vip' ? 'var(--gold)' : 'var(--purple)' }}>{p.channel === 'vip' ? '💎 VIP' : '📢 Public'}</span>
                                                <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{p.question}</span>
                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{new Date(p.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <button onClick={() => handleDeletePoll(p.id)} title="Delete from Telegram" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', padding: '0.2rem' }}><Trash2 size={15} /></button>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        )}

                        {/* Posted Messages History */}
                        {postedMessages.length > 0 && (
                            <SectionCard title={`Posted Messages History (${postedMessages.length})`} icon={<MessageSquare size={16} color="var(--text-secondary)" />}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {postedMessages.map(p => (
                                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface)', borderRadius: '10px', padding: '0.65rem 1rem', border: '1px solid var(--border)', gap: '0.75rem' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(p.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.2rem' }}>{p.text}</p>
                                            </div>
                                            <button onClick={() => handleDeletePostedMessage(p.id)} title="Delete from Telegram" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', padding: '0.2rem', flexShrink: 0 }}><Trash2 size={15} /></button>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        )}

                        {/* Invite User to VIP */}
                        <SectionCard title="Add User to VIP Channel" icon={<Users size={16} color="var(--gold)" />}>
                            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                Enter the user's <b>Telegram User ID</b> to send them a one-time VIP invite link via DM. They must have started the bot to receive it.
                            </p>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <label className="form-label">Telegram User ID</label>
                                    <input className="input-elegant" value={inviteUserId} onChange={e => setInviteUserId(e.target.value)} placeholder="e.g. 123456789" />
                                </div>
                                <button className="btn-gold" onClick={handleInviteUser} disabled={inviteLoading}>
                                    {inviteLoading ? <><Spinner light /> Sending...</> : <><Send size={15} /> Send Invite</>}
                                </button>
                            </div>
                        </SectionCard>

                        {/* Post Scheduler */}
                        <SectionCard title="Schedule a Post" icon={<Calendar size={16} color="var(--gold)" />}>
                            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                Schedule a post to auto-send at a specific time. Optionally add a countdown teaser that gets pinned in the public channel beforehand, then unpinned when the post goes live.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                {['vip', 'public'].map(ch => (
                                    <button key={ch} onClick={() => setScheduleChannel(ch)} style={{
                                        padding: '0.4rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                                        border: scheduleChannel === ch ? '2px solid var(--gold)' : '2px solid var(--border)',
                                        background: scheduleChannel === ch ? 'rgba(229,165,75,0.15)' : 'var(--surface)',
                                        color: scheduleChannel === ch ? 'var(--gold)' : 'var(--text-secondary)'
                                    }}>{ch === 'vip' ? '💎 VIP Channel' : '📢 Public Channel'}</button>
                                ))}
                            </div>
                            <textarea className="input-elegant" rows={3} value={scheduleMsg} onChange={e => setScheduleMsg(e.target.value)} placeholder="Write your post caption or message..." style={{ marginBottom: '0.75rem' }} />
                            <div style={{ marginBottom: '0.75rem' }}>
                                <label className="form-label">Attach Photo (optional)</label>
                                <input type="file" ref={schedulePhotoRef} style={{ display: 'none' }} accept="image/*" onChange={handleSchedulePhotoUpload} />
                                {schedulePhotoUrl ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.6rem 0.9rem' }}>
                                        <img src={`${API_BASE}${schedulePhotoUrl}`} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '6px' }} />
                                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1 }}>Photo attached</span>
                                        <button onClick={() => setSchedulePhotoUrl('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)' }}><X size={15} /></button>
                                    </div>
                                ) : (
                                    <button onClick={() => schedulePhotoRef.current?.click()} disabled={schedulePhotoLoading} style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: '10px', padding: '0.6rem 1rem', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        {schedulePhotoLoading ? <><Spinner /> Uploading...</> : <><Upload size={14} /> Upload Photo</>}
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <label className="form-label">Schedule date & time</label>
                                    <input className="input-elegant" type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
                                </div>
                            </div>
                            <div style={{ background: 'rgba(229,165,75,0.05)', border: '1px solid rgba(229,165,75,0.15)', borderRadius: '10px', padding: '0.9rem', marginBottom: '1rem' }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.5rem' }}>⏰ Auto Countdown (optional)</p>
                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '0 0 160px' }}>
                                        <label className="form-label">Hours before post to tease</label>
                                        <input className="input-elegant" type="number" min="1" value={scheduleCountdownHours} onChange={e => setScheduleCountdownHours(e.target.value)} placeholder="e.g. 24" />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '180px' }}>
                                        <label className="form-label">Countdown teaser message</label>
                                        <input className="input-elegant" value={scheduleCountdownMsg} onChange={e => setScheduleCountdownMsg(e.target.value)} placeholder="Something big drops soon 👀" />
                                    </div>
                                </div>
                                <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>Countdown gets pinned to public channel, unpinned when post goes live.</p>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="btn-gold" onClick={handleSchedulePost} disabled={scheduleLoading}>
                                    {scheduleLoading ? <><Spinner light /> Scheduling...</> : <><Calendar size={15} /> Schedule Post</>}
                                </button>
                            </div>
                        </SectionCard>

                        {/* Upcoming Scheduled Posts */}
                        <SectionCard title={`Upcoming Scheduled Posts (${scheduledPosts.length})`} icon={<Clock size={16} color="var(--text-secondary)" />}>
                            {scheduledPosts.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                                    <Calendar size={28} style={{ marginBottom: '0.5rem', opacity: 0.3 }} />
                                    <p>No scheduled posts.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {scheduledPosts.map(p => (
                                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface)', borderRadius: '10px', padding: '0.75rem 1rem', border: '1px solid var(--border)', gap: '0.75rem' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: '4px', background: p.channel === 'vip' ? 'rgba(229,165,75,0.15)' : 'rgba(168,85,247,0.15)', color: p.channel === 'vip' ? 'var(--gold)' : 'var(--purple)' }}>{p.channel === 'vip' ? '💎 VIP' : '📢 Public'}</span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>📅 {new Date(p.scheduledAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                    {p.countdownHours && <span style={{ fontSize: '0.72rem', color: 'var(--gold)' }}>⏰ Countdown {p.countdownHours}h before</span>}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                                                    {p.photoUrl && <img src={`${API_BASE}${p.photoUrl}`} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />}
                                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.message || '📷 Photo post'}</p>
                                                </div>
                                            </div>
                                            <button onClick={() => handleDeleteScheduled(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', padding: '0.2rem' }}><Trash2 size={15} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </SectionCard>
                    </>
                )}

            </div>
        </div>
    );
}
