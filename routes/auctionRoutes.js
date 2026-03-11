const express = require('express');
const router = express.Router();
const {
  createAuction,
  getAuctions,
  getAuction,
  updateAuction,
  publishAuction,
  goLive,
  endAuction,
  cancelAuction,
  getMyAuctions
} = require('../controllers/auctionController');
const { protect, authorize } = require('../middleware/auth');

router.get('/', getAuctions);
router.get('/seller/my-auctions', protect, authorize('super_admin', 'auction_manager', 'seller'), getMyAuctions);
router.get('/:id', getAuction);
router.post('/', protect, authorize('super_admin', 'auction_manager'), createAuction);
router.patch('/:id', protect, authorize('super_admin', 'auction_manager'), updateAuction);
router.post('/:id/publish', protect, authorize('super_admin', 'auction_manager'), publishAuction);
router.post('/:id/go-live', protect, authorize('super_admin', 'auction_manager'), goLive);
router.post('/:id/end', protect, authorize('super_admin', 'auction_manager'), endAuction);
router.post('/:id/cancel', protect, authorize('super_admin', 'auction_manager'), cancelAuction);

module.exports = router;
