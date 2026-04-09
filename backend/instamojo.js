const https = require('https');
const { URL } = require('url');
require('dotenv').config();

const API_KEY = process.env.INSTAMOJO_API_KEY;
const AUTH_TOKEN = process.env.INSTAMOJO_AUTH_TOKEN;
const BASE_URL = process.env.INSTAMOJO_BASE_URL || 'https://test.instamojo.com/api/1.1';

function apiRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
        if (!API_KEY || !AUTH_TOKEN) {
            return reject(new Error('INSTAMOJO_API_KEY and INSTAMOJO_AUTH_TOKEN must be set'));
        }

        const url = new URL(`${BASE_URL}${endpoint}`);
        const isPost = method === 'POST';

        const postData = isPost && data ? new URLSearchParams(data).toString() : '';

        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method,
            headers: {
                'X-Api-Key': API_KEY,
                'X-Auth-Token': AUTH_TOKEN
            }
        };

        if (isPost) {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
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
    const data = {
        amount: String(amount),
        purpose: purpose || 'Monthly Subscription',
        buyer_name: buyerName || '',
        phone: phone || '',
        email: email || '',
        redirect_url: redirectUrl || '',
        webhook: webhookUrl || '',
        allow_repeated_payments: 'false',
        send_email: 'false',
        send_sms: 'false'
    };

    const result = await apiRequest('POST', '/payment-requests/', data);

    if (!result.success) {
        const errMsg = result.message ? JSON.stringify(result.message) : 'Unknown Instamojo error';
        throw new Error(`Instamojo createPaymentRequest failed: ${errMsg}`);
    }

    return result.payment_request;
}

async function getPaymentRequestStatus(paymentRequestId) {
    const result = await apiRequest('GET', `/payment-requests/${paymentRequestId}/`);

    if (!result.success) {
        throw new Error('Failed to fetch payment request status');
    }

    return result.payment_request;
}

async function verifyPayment(paymentRequestId, paymentId) {
    const paymentRequest = await getPaymentRequestStatus(paymentRequestId);

    const payment = paymentRequest.payments.find(p => p.payment_id === paymentId);

    if (!payment) {
        return { verified: false, reason: 'Payment not found in request' };
    }

    if (payment.status !== 'Credit') {
        return { verified: false, reason: `Payment status is "${payment.status}", not "Credit"` };
    }

    return {
        verified: true,
        payment,
        amount: payment.amount,
        buyerName: payment.buyer_name,
        buyerPhone: payment.buyer_phone,
        buyerEmail: payment.buyer_email
    };
}

module.exports = {
    createPaymentRequest,
    getPaymentRequestStatus,
    verifyPayment
};
