const db = require('../config/db');
const axios = require('axios');

const INSTAMOJO_BASE_URL = process.env.INSTAMOJO_BASE_URL || 'https://www.instamojo.com/api/1.1';
const INSTAMOJO_HEADERS = {
  'X-Api-Key':    process.env.INSTAMOJO_API_KEY,
  'X-Auth-Token': process.env.INSTAMOJO_AUTH_TOKEN,
  'Content-Type': 'application/x-www-form-urlencoded'
};

// ─── CREATE EMD PAYMENT REQUEST ───────────────────────────────────────────────

const createEmdPayment = async (req, res) => {
  try {
    const { auctionId } = req.params;
    const userId = req.user.id;

    // Get auction details
    const auction = await db.query(
      'SELECT * FROM auctions WHERE id = $1',
      [auctionId]
    );

    if (auction.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Auction not found' });
    }

    const auctionData = auction.rows[0];

    // Check if already registered
    const registration = await db.query(
      'SELECT * FROM auction_registrations WHERE auction_id = $1 AND user_id = $2',
      [auctionId, userId]
    );

    // Get user details
    const user = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    const userData = user.rows[0];
    const emdAmount = parseFloat(auctionData.emd_amount);

    // Create Instamojo payment request
    const params = new URLSearchParams();
    params.append('purpose', `EMD for ${auctionData.title}`);
    params.append('amount', emdAmount.toString());
    params.append('buyer_name', userData.full_name || 'Bidder');
    params.append('email', userData.email || 'bidder@auctionit.in');
    params.append('phone', userData.mobile);
    params.append('redirect_url', `${process.env.FRONTEND_URL}/payment/success?auctionId=${auctionId}`);
    params.append('webhook', `${process.env.BACKEND_URL}/api/payments/webhook`);
    params.append('allow_repeated_payments', 'false');

    const response = await axios.post(
      `${INSTAMOJO_BASE_URL}/payment-requests/`,
      params,
      { headers: INSTAMOJO_HEADERS }
    );

    if (!response.data.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create payment request',
        error: response.data
      });
    }

    const paymentRequest = response.data.payment_request;

    // Save payment record in DB
    await db.query(
      `INSERT INTO payments
       (user_id, auction_id, payment_type, amount, status, gateway, gateway_payment_id, gateway_response)
       VALUES ($1, $2, 'emd', $3, 'pending', 'instamojo', $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        userId, auctionId, emdAmount,
        paymentRequest.id,
        JSON.stringify(paymentRequest)
      ]
    );

    res.json({
      success: true,
      message: 'Payment request created',
      data: {
        paymentUrl: paymentRequest.longurl,
        paymentRequestId: paymentRequest.id,
        amount: emdAmount
      }
    });

  } catch (err) {
    console.error('createEmdPayment error:', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment request'
    });
  }
};

// ─── PAYMENT WEBHOOK ──────────────────────────────────────────────────────────

const paymentWebhook = async (req, res) => {
  try {
    const {
      payment_id, payment_request_id, status,
      amount, buyer, buyer_name, buyer_phone
    } = req.body;

    console.log('  💰  Webhook     :', { payment_id, status, amount });

    if (status !== 'Credit') {
      return res.status(200).json({ success: true });
    }

    // Find payment record
    const payment = await db.query(
      'SELECT * FROM payments WHERE gateway_payment_id = $1',
      [payment_request_id]
    );

    if (payment.rows.length === 0) {
      return res.status(200).json({ success: true });
    }

    const paymentData = payment.rows[0];

    // Update payment status
    await db.query(
      `UPDATE payments SET
        status = 'completed',
        gateway_transaction_id = $1,
        updated_at = NOW()
       WHERE gateway_payment_id = $2`,
      [payment_id, payment_request_id]
    );

    // Activate auction registration
    await db.query(
      `UPDATE auction_registrations SET
        status = 'active',
        emd_paid_at = NOW(),
        updated_at = NOW()
       WHERE auction_id = $1 AND user_id = $2`,
      [paymentData.auction_id, paymentData.user_id]
    );

    console.log(`  💰  EMD paid    : User ${paymentData.user_id} for auction ${paymentData.auction_id}`);

    res.status(200).json({ success: true });

  } catch (err) {
    console.error('paymentWebhook error:', err);
    res.status(500).json({ success: false });
  }
};

// ─── PAYMENT SUCCESS PAGE DATA ────────────────────────────────────────────────

const paymentSuccess = async (req, res) => {
  try {
    const { payment_id, payment_request_id } = req.query;

    // Verify payment with Instamojo
    const response = await axios.get(
      `${INSTAMOJO_BASE_URL}/payment-requests/${payment_request_id}/`,
      { headers: INSTAMOJO_HEADERS }
    );

    const paymentRequest = response.data.payment_request;
    const payment = paymentRequest.payments?.[0];

    if (payment?.status === 'Credit') {
      // Update payment status
      await db.query(
        `UPDATE payments SET
          status = 'completed',
          gateway_transaction_id = $1,
          updated_at = NOW()
         WHERE gateway_payment_id = $2`,
        [payment.payment_id, payment_request_id]
      );

      // Activate registration
      const paymentRecord = await db.query(
        'SELECT * FROM payments WHERE gateway_payment_id = $1',
        [payment_request_id]
      );

      if (paymentRecord.rows.length > 0) {
        await db.query(
          `UPDATE auction_registrations SET
            status = 'active',
            emd_paid_at = NOW(),
            updated_at = NOW()
           WHERE auction_id = $1 AND user_id = $2`,
          [paymentRecord.rows[0].auction_id, paymentRecord.rows[0].user_id]
        );
      }

      return res.json({
        success: true,
        message: 'Payment successful! You are now registered for the auction.',
        data: { paymentId: payment.payment_id, amount: payment.amount }
      });
    }

    res.json({
      success: false,
      message: 'Payment not completed yet'
    });

  } catch (err) {
    console.error('paymentSuccess error:', err);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

// ─── GET MY PAYMENTS ──────────────────────────────────────────────────────────

const getMyPayments = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, a.title AS auction_title, a.auction_number
       FROM payments p
       JOIN auctions a ON a.id = p.auction_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });

  } catch (err) {
    console.error('getMyPayments error:', err);
    res.status(500).json({ success: false, message: 'Failed to get payments' });
  }
};

module.exports = {
  createEmdPayment,
  paymentWebhook,
  paymentSuccess,
  getMyPayments
};