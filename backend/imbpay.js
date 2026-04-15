const https = require('https');
const { URL } = require('url');
require('dotenv').config();

const CLIENT_ID = process.env.IMB_CLIENT_ID;
const CLIENT_SECRET = process.env.IMB_CLIENT_SECRET;
const MERCHANT_CODE = process.env.IMB_MERCHANT_CODE;
const BASE_URL = 'https://secure.imbpayment.in/api/v1';

function apiRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
        if (!CLIENT_ID || !CLIENT_SECRET) {
            return reject(new Error('IMB_CLIENT_ID and IMB_CLIENT_SECRET must be set in .env'));
        }

        const url = new URL(`${BASE_URL}${endpoint}`);
        const postData = data ? JSON.stringify(data) : '';

        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method,
            headers: {
                'x-client-id': CLIENT_ID,
                'x-client-secret': CLIENT_SECRET,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (method === 'POST' && postData) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    console.log(`[IMB] ${method} ${endpoint} →`, JSON.stringify(parsed).substring(0, 300));
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`IMB invalid JSON: ${body.substring(0, 300)}`));
                }
            });
        });

        req.on('error', reject);
        if (method === 'POST' && postData) req.write(postData);
        req.end();
    });
}

async function createOrder({ orderId, amount, phone, name, email, webhookUrl, redirectUrl }) {
    const data = {
        merchant_code: MERCHANT_CODE,
        order_id: orderId,
        amount: String(amount),
        customer_phone: phone,
        customer_name: name || 'Subscriber',
        customer_email: email || 'noreply@example.com',
        webhook_url: webhookUrl,
        redirect_url: redirectUrl
    };

    const result = await apiRequest('POST', '/create-order', data);

    const isSuccess =
        result.status === 'success' || result.status === 'SUCCESS' ||
        result.status === 1 || result.status === true || result.success === true;

    if (!isSuccess) {
        throw new Error(`IMB createOrder failed: ${result.message || result.error || JSON.stringify(result)}`);
    }

    const d = result.data || result;
    return {
        orderId: d.order_id || orderId,
        paymentUrl: d.payment_url || d.paymentUrl || d.pay_url || d.checkout_url || '',
        qrCode:    d.qr_code    || d.qrCode    || d.qr_image  || '',
        upiString: d.upi_string || d.upiString || d.upi       || ''
    };
}

async function checkOrderStatus(orderId) {
    const result = await apiRequest('GET', `/order-status?order_id=${orderId}`);

    const d = result.data || result;
    const raw = (d.status || d.payment_status || d.txn_status || d.transaction_status || '').toUpperCase();
    const paid = ['SUCCESS', 'PAID', 'COMPLETED', 'CREDIT'].includes(raw);

    return {
        paid,
        status: raw,
        transactionId: d.transaction_id || d.txn_id || d.utr || d.utr_no || '',
        amount: parseFloat(d.amount || '0')
    };
}

module.exports = { createOrder, checkOrderStatus };
