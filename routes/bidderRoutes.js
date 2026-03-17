const express = require('express');
const router = express.Router();
const bidderController = require('../controllers/bidderController');
const { protect, authorize } = require('../middleware/auth');

// BIDDER PROFILE
router.get('/', protect, authorize('super_admin', 'account_manager', 'operations'), bidderController.getAllBidders);
router.get('/:id', protect, bidderController.getBidderById);
router.put('/:id', protect, bidderController.updateBidder);
router.delete('/:id', protect, authorize('super_admin'), bidderController.deleteBidder);

// KYC MANAGEMENT
router.put('/:id/kyc-status', protect, authorize('super_admin', 'operations'), bidderController.updateKYCStatus);
router.get('/:id/kyc-documents', protect, bidderController.getKYCDocuments);

// MATERIAL INTERESTS
router.get('/:id/material-interests', protect, bidderController.getMaterialInterests);
router.post('/:id/material-interests', protect, bidderController.addMaterialInterest);
router.delete('/:bidderId/material-interests/:interestId', protect, bidderController.removeMaterialInterest);

// LOCATION PREFERENCES
router.get('/:id/location-preferences', protect, bidderController.getLocationPreferences);
router.post('/:id/location-preferences', protect, bidderController.addLocationPreference);
router.delete('/:bidderId/location-preferences/:preferenceId', protect, bidderController.removeLocationPreference);

// PURCHASE HISTORY
router.get('/:id/purchase-history', protect, bidderController.getPurchaseHistory);
router.get('/:id/stats', protect, bidderController.getBidderStats);

module.exports = router;