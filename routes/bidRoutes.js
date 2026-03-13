const express = require('express');
const router = express.Router();
const {
  getLotBids,
  getMyBids,
  getMyWins,
  registerForAuction
} = require('../controllers/bidController');
const { protect, authorize } = require('../middleware/auth');

router.get('/lot/:lotId',   getLotBids);
router.get('/my',           protect, getMyBids);
router.get('/my-wins',      protect, getMyWins);
router.post('/auctions/:auctionId/register',
  protect,
  authorize('bidder'),
  registerForAuction
);

module.exports = router;
