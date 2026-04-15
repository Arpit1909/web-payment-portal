import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl, API_BASE } from '../apiConfig';
import {
    ShieldCheck, Lock, ChevronRight, Video, Sparkles, X,
    CheckCircle2, Crown, BadgeCheck, Star, MessageCircle,
    Camera, Zap, Heart, Play, ArrowRight, Clock, Users
} from 'lucide-react';

export default function Home() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [payPhone, setPayPhone] = useState('');
    const [payTgUsername, setPayTgUsername] = useState('');
    const [payStep, setPayStep] = useState('form'); // 'form' | 'qr' | 'done'
    const [qrData, setQrData] = useState(null);
    const [telegramLink, setTelegramLink] = useState('');
    const [payTimer, setPayTimer] = useState(300);
    const payTimerRef = useRef(null);
    const pollRef = useRef(null);
    const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
    const [btnTextIndex, setBtnTextIndex] = useState(0);
    const slideRef = useRef(null);
    const slideTimer = useRef(null);
    const userTouched = useRef(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setBtnTextIndex(prev => (prev + 1) % 3);
        }, 2500);
        return () => clearInterval(interval);
    }, []);

    const startSlideshow = useCallback(() => {
        if (slideTimer.current) clearInterval(slideTimer.current);
        slideTimer.current = setInterval(() => {
            const el = slideRef.current;
            if (!el || userTouched.current) return;
            const maxScroll = el.scrollWidth - el.clientWidth;
            if (el.scrollLeft >= maxScroll - 2) {
                el.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                const card = el.querySelector('.sp-prev-card');
                const step = card ? card.offsetWidth + 10 : el.clientWidth * 0.45;
                el.scrollBy({ left: step, behavior: 'smooth' });
            }
        }, 3000);
    }, []);

    useEffect(() => {
        startSlideshow();
        return () => { if (slideTimer.current) clearInterval(slideTimer.current); };
    }, [startSlideshow]);

    const handleSlideTouch = () => {
        userTouched.current = true;
        if (slideTimer.current) clearInterval(slideTimer.current);
        setTimeout(() => {
            userTouched.current = false;
            startSlideshow();
        }, 5000);
    };

    useEffect(() => {
        if (showModal) {
            setPayTimer(300);
            if (payTimerRef.current) clearInterval(payTimerRef.current);
            payTimerRef.current = setInterval(() => {
                setPayTimer(prev => {
                    if (prev <= 1) {
                        clearInterval(payTimerRef.current);
                        setShowModal(false);
                        setPaySuccess(false);
                        setTelegramLink('');
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            if (payTimerRef.current) clearInterval(payTimerRef.current);
        }
        return () => { if (payTimerRef.current) clearInterval(payTimerRef.current); };
    }, [showModal]);

    const payMins = Math.floor(payTimer / 60);
    const paySecs = payTimer % 60;
    const payTimerUrgent = payTimer <= 60;

    useEffect(() => {
        fetch(apiUrl('/api/public/data'))
            .then(res => res.json())
            .then(json => { setData(json); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!data?.offer?.timer_end_date) return;
        const target = new Date(data.offer.timer_end_date).getTime();
        const interval = setInterval(() => {
            const distance = target - Date.now();
            if (distance < 0) {
                clearInterval(interval);
                setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
                return;
            }
            setTimeLeft({
                hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
                minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
                seconds: Math.floor((distance % (1000 * 60)) / 1000)
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [data]);

    const closeModal = () => {
        setShowModal(false);
        setPayStep('form');
        setQrData(null);
        setTelegramLink('');
        if (pollRef.current) clearInterval(pollRef.current);
    };

    const handlePayNow = () => {
        if (!payPhone || payPhone.length < 10) {
            alert('Please enter your phone number');
            return;
        }
        setVerifying(true);
        fetch(apiUrl('/api/payment/create'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: payPhone, telegramUsername: payTgUsername })
        })
        .then(res => res.json())
        .then(result => {
            setVerifying(false);
            if (result.success) {
                setQrData({
                    qrCode: result.qr_code || '',
                    upiString: result.upi_string || '',
                    orderId: result.order_id,
                    amount: result.amount
                });
                setPayStep('qr');
            } else {
                alert(result.error || 'Failed to create payment. Please try again.');
            }
        })
        .catch(() => {
            setVerifying(false);
            alert('Network error. Please try again.');
        });
    };

    // Poll for payment confirmation every 3s when QR is showing
    useEffect(() => {
        if (payStep !== 'qr' || !qrData?.orderId) return;
        pollRef.current = setInterval(() => {
            fetch(apiUrl(`/api/payment/status/${qrData.orderId}`))
                .then(r => r.json())
                .then(result => {
                    if (result.success && result.telegram_url) {
                        clearInterval(pollRef.current);
                        setTelegramLink(result.telegram_url);
                        setPayStep('done');
                    }
                })
                .catch(() => {});
        }, 3000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [payStep, qrData]);

    if (loading) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
            <div style={{ textAlign: 'center' }}>
                <div className="spinner spinner-light" style={{ width: '40px', height: '40px', borderWidth: '3px', margin: '0 auto 1rem' }}></div>
                <p style={{ color: '#555570', fontSize: '0.85rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Loading...</p>
            </div>
        </div>
    );

    const offer = data?.offer || {};
    const s = data?.settings || {};

    const profileName = s.profile_name || 'Prachi Sharma';
    const profileHandle = s.profile_handle || '@prachi_vip';
    const profileAvatar = s.profile_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400&h=400';
    const fansCount = data?.active_members_count !== undefined ? data.active_members_count : '...';
    const videosCount = s.videos_count || '840+';
    const offerTag = s.offer_tag || 'SPECIAL PRICE ENDS IN';
    const sectionTitle = s.section_title || 'Previews';
    const ctaButtonText = s.cta_button_text || 'JOIN PRIVATE TELEGRAM GROUP';
    const checkoutTitle = s.checkout_title || 'Unlock VIP Access';
    const checkoutSubtitle = s.checkout_subtitle || 'Pay securely via UPI, Card, or Net Banking';

    const btnTexts = [
        s.rotating_text_1 || '🔓 Unlimited Fun',
        s.rotating_text_2 || '✨ Exclusive Content Daily',
        s.rotating_text_3 || '🎬 200+ Photos & Videos'
    ];

    const defaultPreviews = [
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&q=80&w=400",
        "https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&q=80&w=400",
        "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=400",
        "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&q=80&w=400",
        "https://images.unsplash.com/photo-1488716820095-cbe80883c496?auto=format&fit=crop&q=80&w=400",
        "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&q=80&w=400",
    ];

    const previewList = data?.previews && data.previews.length > 0 ? data.previews : null;
    const coverBg = s.cover_image_url || 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=2000';

    const savePct = offer.original_price && offer.discounted_price
        ? Math.round((1 - offer.discounted_price / offer.original_price) * 100) : 0;

    return (
        <div className="sp-page">

            {/* ===== COVER IMAGE ===== */}
            <div className="sp-cover" style={{ backgroundImage: `url(${coverBg})` }}>
                <div className="sp-cover-overlay"></div>
                <div className="sp-cover-badges">
                    <div className="sp-badge-online">
                        <span className="online-dot"></span>
                        ONLINE
                    </div>
                </div>
            </div>

            {/* ===== BODY ===== */}
            <div className="sp-body">

                {/* Profile Section */}
                <div className="sp-profile">
                    <div className="sp-avatar-wrap">
                        <img src={profileAvatar} alt={profileName} className="sp-avatar" />
                        <div className="verified-badge">
                            <CheckCircle2 size={10} strokeWidth={3} />
                        </div>
                    </div>
                    <div className="sp-profile-left">
                        <div className="sp-name-line">
                            <h1 className="sp-name">{profileName}</h1>
                            <BadgeCheck size={18} fill="#3B82F6" color="#fff" />
                        </div>
                        <span key={btnTextIndex} className="sp-tag-pill">
                            {btnTexts[btnTextIndex]}
                        </span>
                    </div>
                    <div className="sp-profile-right">
                        <div className="sp-joined">
                            <Users size={13} />
                            <span className="sp-joined-num">{fansCount}</span>
                            <span>JOINED</span>
                        </div>
                        <span className="sp-joined-sub">Private Group</span>
                    </div>
                </div>

                {/* Timer / Offer Banner */}
                <div className="sp-timer-bar">
                    <div className="sp-timer-left">
                        <Clock size={16} className="sp-timer-icon" />
                        <div>
                            <div className="sp-timer-label">{offerTag}</div>
                            <div className="sp-timer-save">
                                Save {savePct}% • <s>₹{offer.original_price || '899'}</s>
                            </div>
                        </div>
                    </div>
                    <div className="sp-timer-nums">
                        <div className="sp-t-block">
                            <span className="sp-t-val">{String(timeLeft.hours).padStart(2, '0')}</span>
                            <span className="sp-t-lbl">HRS</span>
                        </div>
                        <span className="sp-t-sep">:</span>
                        <div className="sp-t-block">
                            <span className="sp-t-val">{String(timeLeft.minutes).padStart(2, '0')}</span>
                            <span className="sp-t-lbl">MIN</span>
                        </div>
                        <span className="sp-t-sep">:</span>
                        <div className="sp-t-block">
                            <span className="sp-t-val">{String(timeLeft.seconds).padStart(2, '0')}</span>
                            <span className="sp-t-lbl">SEC</span>
                        </div>
                    </div>
                </div>

                {/* Previews */}
                <div className="sp-previews">
                    <div className="sp-prev-head">
                        <span className="sp-prev-title">
                            <Play size={14} fill="var(--gold)" color="var(--gold)" />
                            {sectionTitle.toUpperCase()}
                        </span>
                    </div>
                    <div className="sp-prev-scroll" ref={slideRef} onTouchStart={handleSlideTouch} onMouseDown={handleSlideTouch}>
                        {(previewList || defaultPreviews.map((url, i) => ({ url, type: 'image', id: i }))).map((item, i) => {
                            const imgSrc = typeof item === 'string'
                                ? item
                                : (item.url?.startsWith('http') ? item.url : `${API_BASE}${item.url}`);
                            const isVisible = i < 2;

                            return (
                                <div key={i} className={`sp-prev-card ${!isVisible ? 'sp-prev-blurred' : 'sp-prev-clear'}`} onClick={() => setShowModal(true)}>
                                    {item.type === 'video' ? (
                                        <video src={imgSrc} className="sp-prev-img" autoPlay muted loop playsInline />
                                    ) : (
                                        <img src={imgSrc} alt="" className="sp-prev-img" />
                                    )}
                                    {isVisible ? (
                                        <div className="sp-prev-overlay">
                                            <span className="sp-hd-badge">HD</span>
                                            <div className="sp-prev-bottom">
                                                <span className="sp-prev-bottom-title">Full Video in Group</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="sp-prev-overlay sp-prev-lock-overlay">
                                            <div className="sp-prev-join">
                                                <div className="sp-prev-lock-icon"><Lock size={20} /></div>
                                                <span>Unlock Now</span>
                                                <span className="sp-prev-watch">PAY TO WATCH</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Bottom CTA */}
                <div className="sp-bottom-cta" onClick={() => setShowModal(true)}>
                    <div className="sp-cta-info">
                        <div className="sp-cta-title">{ctaButtonText}</div>
                        <div className="sp-cta-price">
                            <s className="sp-cta-old">₹{offer.original_price || '899'}</s>
                            <span className="sp-cta-new">₹{offer.discounted_price || '199'}</span>
                            {savePct > 0 && <span className="sp-cta-off">{savePct}% OFF</span>}
                        </div>
                    </div>
                    <div className="sp-cta-arrow">
                        <ArrowRight size={22} />
                    </div>
                </div>

                {/* Payment Icons */}
                <div className="sp-pay-icons">
                    <span className="sp-pay-chip"><strong>G</strong> Pay</span>
                    <span className="sp-pay-chip"><span style={{color:'#6739b7', fontWeight:800}}>₱</span> PhonePe</span>
                    <span className="sp-pay-chip">Pay<strong style={{color:'#00BAF2'}}>tm</strong></span>
                    <span className="sp-pay-chip">UPI<span style={{color:'#10B981', fontWeight:800}}>▶</span></span>
                </div>

            </div>

            {/* ===== PAYMENT MODAL ===== */}
            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <button className="modal-close" onClick={closeModal}>
                            <X size={20} strokeWidth={2.5} />
                        </button>

                        {payStep === 'done' ? (
                            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                                <div style={{
                                    width: '80px', height: '80px', borderRadius: '50%',
                                    background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    marginBottom: '1.5rem',
                                    animation: 'pulse 2s ease-in-out infinite'
                                }}>
                                    <CheckCircle2 size={40} color="var(--green)" />
                                </div>

                                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--green)' }}>
                                    Payment Successful!
                                </h2>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
                                    Your access has been activated for <strong style={{ color: 'var(--text-primary)' }}>30 days</strong>. Click the button below to join the private Telegram channel.
                                </p>

                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '0.85rem',
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '1rem 1.25rem',
                                    marginBottom: '1.5rem',
                                    textAlign: 'left'
                                }}>
                                    <div style={{
                                        width: '48px', height: '48px', borderRadius: '50%',
                                        background: 'linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        flexShrink: 0
                                    }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                                            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                                        </svg>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.15rem' }}>
                                            After payment, a Telegram Join button will appear — click it to enter my
                                        </p>
                                        <p style={{ fontSize: '0.9rem', color: 'var(--gold)', fontWeight: 700 }}>
                                            Private Group
                                        </p>
                                    </div>
                                </div>

                                <a
                                    href={telegramLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-gold"
                                    style={{
                                        marginBottom: '0.75rem', fontSize: '1.05rem', padding: '1.1rem',
                                        textDecoration: 'none', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '0.5rem'
                                    }}
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                                    </svg>
                                    Join Private Telegram Group
                                </a>

                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                    Access valid for 30 days from today
                                </p>
                            </div>
                        ) : payStep === 'qr' ? (
                            /* ── QR PAYMENT SCREEN ── */
                            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>Scan to Pay</p>
                                <div style={{
                                    background: '#fff', borderRadius: '16px', padding: '12px',
                                    display: 'inline-block', marginBottom: '1rem',
                                    boxShadow: '0 0 30px rgba(229,165,75,0.2)'
                                }}>
                                    {(qrData?.qrCode || qrData?.upiString) ? (
                                        <img
                                            src={qrData.qrCode || `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrData.upiString)}`}
                                            alt="UPI QR Code"
                                            width={220} height={220}
                                            style={{ display: 'block', borderRadius: '8px' }}
                                        />
                                    ) : (
                                        <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '0.85rem' }}>
                                            Loading QR...
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    <span>Order: <b style={{ color: 'var(--text-secondary)' }}>{qrData?.orderId?.split('_').pop()}</b></span>
                                    <span>Amount: <b style={{ color: 'var(--gold)' }}>₹{qrData?.amount}</b></span>
                                </div>

                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center',
                                    background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                                    borderRadius: '9999px', padding: '0.5rem 1.2rem', marginBottom: '1.25rem',
                                    fontSize: '0.82rem', color: 'var(--green)'
                                }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                                    Waiting for payment...
                                </div>

                                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
                                    Open any UPI app (GPay, PhonePe, Paytm) → Scan QR → Pay<br />
                                    <b style={{ color: 'var(--text-secondary)' }}>The Telegram join link will appear here automatically after payment.</b>
                                </p>

                                {/* Payment logos */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', flexWrap: 'wrap', opacity: 0.6 }}>
                                    {['GPay', 'PhonePe', 'Paytm', 'UPI', 'BHIM'].map(app => (
                                        <span key={app} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', padding: '0.25rem 0.6rem', border: '1px solid rgba(255,255,255,0.08)' }}>{app}</span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                width: '64px', height: '64px', borderRadius: '50%',
                                background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.2)',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                marginBottom: '1.25rem'
                            }}>
                                <Lock size={28} color="var(--gold)" />
                            </div>

                            <h2 className="checkout-title-shimmer" style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                <Crown size={22} /> {checkoutTitle}
                            </h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                                {checkoutSubtitle}
                            </p>

                            <div style={{ marginBottom: '0.75rem' }}>
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                    background: 'var(--gold-gradient)', color: '#000',
                                    fontSize: '1.25rem', fontWeight: 900,
                                    padding: '0.5rem 1.5rem', borderRadius: '9999px'
                                }}>
                                    ₹{offer.discounted_price || '199'} / month
                                </span>
                                {savePct > 0 && (
                                    <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                        <s>₹{offer.original_price || '899'}</s>
                                        <span style={{ color: 'var(--green)', fontWeight: 700, marginLeft: '0.4rem' }}>{savePct}% OFF</span>
                                    </div>
                                )}
                            </div>

                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                background: payTimerUrgent ? 'rgba(244,63,94,0.15)' : 'rgba(236,72,153,0.1)',
                                border: `1px solid ${payTimerUrgent ? 'rgba(244,63,94,0.35)' : 'rgba(236,72,153,0.2)'}`,
                                borderRadius: '9999px',
                                padding: '0.4rem 1rem',
                                margin: '0 0 1.25rem',
                                transition: 'all 0.3s ease'
                            }}>
                                <Clock size={14} color={payTimerUrgent ? 'var(--rose)' : 'var(--gold)'} />
                                <span style={{
                                    fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                                    color: payTimerUrgent ? 'var(--rose)' : 'var(--gold-light)',
                                    animation: payTimerUrgent ? 'pulse 1s ease-in-out infinite' : 'none'
                                }}>
                                    {payMins}:{paySecs.toString().padStart(2, '0')}
                                </span>
                                <span style={{ fontSize: '0.7rem', color: payTimerUrgent ? 'rgba(244,63,94,0.8)' : 'var(--text-muted)' }}>
                                    {payTimerUrgent ? 'Hurry up!' : 'to complete payment'}
                                </span>
                            </div>

                            <div style={{ textAlign: 'left', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                                {[
                                    'Enter your phone number below',
                                    'Click "Make Payment" to get a QR code',
                                    'Complete payment via UPI, Card, or Net Banking',
                                    'After payment, you\'ll get the Telegram join link'
                                ].map((step, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: i < 3 ? '0.7rem' : 0 }}>
                                        <span style={{
                                            minWidth: '22px', height: '22px', borderRadius: '50%',
                                            background: 'var(--gold-gradient)', color: '#000',
                                            fontSize: '0.72rem', fontWeight: 800,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                        }}>{i + 1}</span>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, paddingTop: '2px' }}>{step}</span>
                                    </div>
                                ))}
                            </div>

                            <div style={{
                                display: 'flex', flexDirection: 'column', gap: '0.6rem',
                                marginBottom: '1rem', textAlign: 'left'
                            }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>
                                        Phone Number *
                                    </label>
                                    <input
                                        type="tel"
                                        placeholder="Enter your phone number"
                                        value={payPhone}
                                        onChange={e => setPayPhone(e.target.value)}
                                        style={{
                                            width: '100%', padding: '0.7rem 0.9rem',
                                            borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
                                            background: 'rgba(0,0,0,0.3)', color: '#fff',
                                            fontSize: '0.9rem', outline: 'none',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' }}>
                                        Telegram Username (optional)
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="@your_username"
                                        value={payTgUsername}
                                        onChange={e => setPayTgUsername(e.target.value)}
                                        style={{
                                            width: '100%', padding: '0.7rem 0.9rem',
                                            borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
                                            background: 'rgba(0,0,0,0.3)', color: '#fff',
                                            fontSize: '0.9rem', outline: 'none',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            </div>

                            <button
                                className="btn-gold"
                                style={{ marginBottom: '0.75rem', fontSize: '1rem', padding: '1.1rem' }}
                                onClick={handlePayNow}
                                disabled={verifying}
                            >
                                {verifying ? (
                                    <>
                                        <span className="spinner" style={{ borderColor: 'rgba(0,0,0,0.2)', borderTopColor: '#000' }}></span>
                                        Redirecting to Payment...
                                    </>
                                ) : (
                                    <>
                                        <ShieldCheck size={18} />
                                        Pay Now — ₹{offer.discounted_price || '199'}
                                    </>
                                )}
                            </button>

                            <p className="security-note">
                                <ShieldCheck size={13} color="#22D47A" />
                                Secured by IMB Pay • 100% safe payment
                            </p>
                        </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
