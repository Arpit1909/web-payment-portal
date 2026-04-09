import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function PaymentCallback() {
    const [status, setStatus] = useState('verifying');
    const [telegramUrl, setTelegramUrl] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const paymentRequestId = params.get('payment_request_id');
        const paymentId = params.get('payment_id');

        if (!paymentRequestId || !paymentId) {
            setStatus('error');
            setErrorMsg('Missing payment details. Please try again.');
            return;
        }

        fetch(`${import.meta.env.VITE_API_URL}/api/payment/verify/${paymentRequestId}/${paymentId}`)
            .then(res => res.json())
            .then(result => {
                if (result.success && result.telegram_url) {
                    setTelegramUrl(result.telegram_url);
                    setExpiresAt(result.expires_at);
                    setStatus('success');
                } else {
                    setStatus('error');
                    setErrorMsg(result.reason || 'Payment verification failed. If you paid, please contact support.');
                }
            })
            .catch(() => {
                setStatus('error');
                setErrorMsg('Network error. Please refresh the page to retry.');
            });
    }, []);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-primary, #0d0d0d)',
            padding: '1.5rem'
        }}>
            <div style={{
                maxWidth: '440px',
                width: '100%',
                background: 'var(--bg-card, rgba(20,20,20,0.85))',
                border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
                borderRadius: '20px',
                padding: '2.5rem 2rem',
                textAlign: 'center'
            }}>
                {status === 'verifying' && (
                    <>
                        <Loader2
                            size={56}
                            color="var(--gold, #EC4899)"
                            style={{ animation: 'spin 1s linear infinite', marginBottom: '1.5rem' }}
                        />
                        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.5rem', color: '#fff' }}>
                            Verifying Payment...
                        </h2>
                        <p style={{ color: 'var(--text-secondary, #9CA3AF)', fontSize: '0.9rem' }}>
                            Please wait while we confirm your payment.
                        </p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div style={{
                            width: '80px', height: '80px', borderRadius: '50%',
                            background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: '1.5rem'
                        }}>
                            <CheckCircle2 size={40} color="#10B981" />
                        </div>

                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', color: '#10B981' }}>
                            Payment Successful!
                        </h2>
                        <p style={{ color: 'var(--text-secondary, #9CA3AF)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
                            Your access has been activated for <strong style={{ color: '#fff' }}>30 days</strong>.
                            Click the button below to join the private Telegram channel.
                        </p>

                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.85rem',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '14px',
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
                                <p style={{ fontSize: '0.88rem', color: '#fff', fontWeight: 600, marginBottom: '0.15rem' }}>
                                    Tap below to join the exclusive
                                </p>
                                <p style={{ fontSize: '0.9rem', color: 'var(--gold, #EC4899)', fontWeight: 700 }}>
                                    Private Telegram Group
                                </p>
                            </div>
                        </div>

                        <a
                            href={telegramUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-gold"
                            style={{
                                marginBottom: '1rem', fontSize: '1.05rem', padding: '1.1rem',
                                textDecoration: 'none', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', gap: '0.5rem', width: '100%', boxSizing: 'border-box'
                            }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                            </svg>
                            Join Private Telegram Group
                        </a>

                        {expiresAt && (
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #6B7280)' }}>
                                Access valid until {new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                        )}
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div style={{
                            width: '80px', height: '80px', borderRadius: '50%',
                            background: 'rgba(244,63,94,0.12)', border: '2px solid rgba(244,63,94,0.3)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: '1.5rem'
                        }}>
                            <XCircle size={40} color="#F43F5E" />
                        </div>

                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', color: '#F43F5E' }}>
                            Payment Failed
                        </h2>
                        <p style={{ color: 'var(--text-secondary, #9CA3AF)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
                            {errorMsg}
                        </p>

                        <a
                            href="/"
                            className="btn-gold"
                            style={{
                                textDecoration: 'none', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', gap: '0.5rem', padding: '1rem',
                                fontSize: '1rem', width: '100%', boxSizing: 'border-box'
                            }}
                        >
                            Try Again
                        </a>
                    </>
                )}
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
