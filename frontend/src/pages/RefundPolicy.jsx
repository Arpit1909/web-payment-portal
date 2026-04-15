import React from 'react';

export default function RefundPolicy() {
  return (
    <div style={{ minHeight: '100vh', background: '#0b1020', color: '#e6edf7', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', lineHeight: 1.7 }}>
        <h1 style={{ marginTop: 0 }}>Refund Policy</h1>
        <p><strong>Effective Date:</strong> 09 April 2026</p>
        <p>
          This Refund Policy applies to digital products and subscription-based content sold via Prachi VIP.
        </p>

        <h2>1. Digital Product Nature</h2>
        <p>
          Since our products are delivered digitally and access is granted instantly, all purchases are generally
          non-refundable after successful delivery/access.
        </p>

        <h2>2. Eligible Refund Cases</h2>
        <p>
          Refund requests may be considered only in these situations:
        </p>
        <ul>
          <li>Duplicate payment for the same order</li>
          <li>Payment successful but access not delivered within 24 hours</li>
          <li>Technical failure confirmed from our side</li>
        </ul>

        <h2>3. Refund Window</h2>
        <p>
          Eligible refund requests must be submitted within <strong>48 hours</strong> of payment.
        </p>

        <h2>4. Processing Time</h2>
        <p>
          Approved refunds are processed within <strong>5-7 business days</strong> to the original payment method.
        </p>

        <h2>5. Contact for Refund Requests</h2>
        <p>
          Email us at <strong>support@prachivip.in</strong> with your transaction ID and registered phone/email.
        </p>
      </div>
    </div>
  );
}
