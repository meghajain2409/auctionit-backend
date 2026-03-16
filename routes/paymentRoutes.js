const express = require('express');
const router = express.Router();
const {
  createEmdPayment,
  paymentWebhook,
  paymentSuccess,
  getMyPayments
} = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/auth');

router.post('/emd/:auctionId',  protect, authorize('bidder'), createEmdPayment);
router.post('/webhook',         paymentWebhook);
router.get('/verify',           paymentSuccess);
router.get('/my',               protect, getMyPayments);

module.exports = router;