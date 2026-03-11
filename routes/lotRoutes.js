const express = require('express');
const router = express.Router({ mergeParams: true });
const {
  addLot,
  getLots,
  getLot,
  updateLot,
  deleteLot,
  declareWinner
} = require('../controllers/lotController');
const { protect, authorize } = require('../middleware/auth');

router.get('/', getLots);
router.get('/:lotId', getLot);

router.post('/',
  protect,
  authorize('super_admin', 'auction_manager'),
  addLot
);

router.patch('/:lotId',
  protect,
  authorize('super_admin', 'auction_manager'),
  updateLot
);

router.delete('/:lotId',
  protect,
  authorize('super_admin', 'auction_manager'),
  deleteLot
);

router.post('/:lotId/declare-winner',
  protect,
  authorize('super_admin', 'auction_manager'),
  declareWinner
);

module.exports = router;