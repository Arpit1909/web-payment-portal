import React from 'react';

export default function CancellationPolicy() {
  return (
    <div style={{ minHeight: '100vh', background: '#0b1020', color: '#e6edf7', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', lineHeight: 1.7 }}>
        <h1 style={{ marginTop: 0 }}>Cancellation Policy</h1>
        <p><strong>Effective Date:</strong> 09 April 2026</p>
        <p>
          This Cancellation Policy explains how users can cancel subscriptions or recurring plans at Prachi VIP.
        </p>

        <h2>1. One-Time Purchases</h2>
        <p>
          One-time digital purchases cannot be cancelled after successful payment and content delivery.
        </p>

        <h2>2. Subscription Cancellations</h2>
        <p>
          For recurring subscriptions, you may request cancellation anytime. Cancellation stops future renewals.
          Access remains active until the end of the current billing period.
        </p>

        <h2>3. Immediate Access Revocation</h2>
        <p>
          If payment is reversed/failed or fraudulent usage is detected, access may be suspended immediately.
        </p>

        <h2>4. How to Request Cancellation</h2>
        <p>
          Send your request to <strong>support@prachivip.in</strong> with transaction ID and registered contact.
        </p>

        <h2>5. Support SLA</h2>
        <p>
          Cancellation requests are usually processed within <strong>24 business hours</strong>.
        </p>
      </div>
    </div>
  );
}
