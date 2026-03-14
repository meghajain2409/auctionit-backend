const express = require('express');
const router = express.Router();
const {
  getAllBidders,
  getBidder,
  approveKyc,
  rejectKyc,
  updateAccountStatus
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

const isAdmin = authorize('super_admin', 'auction_manager');

router.get('/bidders', protect, isAdmin, getAllBidders);
router.get('/bidders/:id', protect, isAdmin, getBidder);
router.post('/bidders/:id/approve-kyc', protect, isAdmin, approveKyc);
router.post('/bidders/:id/reject-kyc', protect, isAdmin, rejectKyc);
router.patch('/bidders/:id/status', protect, isAdmin, updateAccountStatus);

module.exports = router;