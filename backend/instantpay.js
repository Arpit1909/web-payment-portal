const https = require('https');
const { URL } = require('url');
require('dotenv').config();

const CLIENT_ID = process.env.INSTANTPAY_CLIENT_ID;
const CLIENT_SECRET = process.env.INSTANTPAY_CLIENT_SECRET;
const BASE_URL = process.env.INSTANTPAY_BASE_URL || 'https://api.instantpay.in';

/*
 * NOTE: This is a robust framework for InstantPay.
 * You will need to replace the exact endpoints ('/payments/initiate') and payload structures
 * according to the specific InstantPay API documentation provided in your dashboard.
 */

function apiRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
        if (!CLIENT_ID || !CLIENT_SECRET) {
            return reject(new Error('INSTANTPAY_CLIENT_ID and INSTANTPAY_CLIENT_SECRET must be set in .env'));
        }

        const url = new URL(`${BASE_URL}${endpoint}`);
        const isPost = method === 'POST';
        const postData = isPost && data ? JSON.stringify(data) : '';

        // Example headers — you may need to adjust these based on InstantPay's required authentication headers
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method,
            headers: {
                'X-Ipay-Client-Id': CLIENT_ID,
                'X-Ipay-Client-Secret': CLIENT_SECRET,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (isPost) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Invalid JSON response: ${body.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        if (isPost) req.write(postData);
        req.end();
    });
}

async function createPaymentRequest({ amount, purpose, buyerName, phone, email, redirectUrl, webhookUrl }) {
    // Adjust the payload below to match InstantPay's "Create Order" or "Create Payment Link" API
    const data = {
        payer: {
            name: buyerName || 'Subscriber',
            email: email || 'subscriber@example.com',
            mobile: phone || ''
        },
        amount: String(amount),
        currency: 'INR',
        purpose: purpose || 'Monthly Subscription',
        redirectUrl: redirectUrl,
        callbackUrl: webhookUrl
    };

    // Replace with actual InstantPay endpoint
    const result = await apiRequest('POST', '/v1/payments/initiate', data);

    // This condition should match InstantPay's success response structure
    if (result.status !== 'success' && result.status !== 'SUCCESS') {
        const errMsg = result.message ? JSON.stringify(result.message) : 'Unknown InstantPay error';
        throw new Error(`InstantPay createPaymentRequest failed: ${errMsg}`);
    }

    return {
        id: result.data.orderId || result.data.txnId,   // Payment Request ID
        longurl: result.data.paymentUrl || result.data.checkoutUrl // URL to redirect user to
    };
}

async function verifyPayment(paymentRequestId, paymentId) {
    // Adjust this to match InstantPay's "Check Payment Status" API
    const result = await apiRequest('GET', `/v1/payments/status?orderId=${paymentRequestId}`);

    // If API call fails entirely
    if (result.status !== 'success' && result.status !== 'SUCCESS') {
        throw new Error('Failed to fetch payment request status from InstantPay');
    }

    // Check if the payment status indicates a successful payment
    const paymentData = result.data;
    const isPaid = paymentData.status === 'PAID' || paymentData.status === 'SUCCESS';

    if (!isPaid) {
        return { verified: false, reason: `Payment status is "${paymentData.status}"` };
    }

    return {
        verified: true,
        payment: paymentData,
        amount: paymentData.amount,
        buyerName: paymentData.payer?.name || '',
        buyerPhone: paymentData.payer?.mobile || '',
        buyerEmail: paymentData.payer?.email || ''
    };
}

module.exports = {
    createPaymentRequest,
    verifyPayment
};
