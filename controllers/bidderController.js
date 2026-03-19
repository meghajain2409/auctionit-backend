const bidderService = require('../services/bidderService');
const db = require('../config/db');

// ─── MY PROFILE (for bidders to get/update their own profile) ────────────────

exports.getMyProfile = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, u.name, u.phone, u.email, u.kyc_status, u.is_active AS user_active
       FROM bidders b
       JOIN users u ON b.user_id = u.id
       WHERE b.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bidder profile not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('getMyProfile error:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    // Find bidder ID for this user
    const bidder = await db.query('SELECT id FROM bidders WHERE user_id = $1', [req.user.id]);
    if (bidder.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bidder profile not found' });
    }

    const updated = await bidderService.updateBidder(bidder.rows[0].id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Update failed' });

    res.json({ success: true, message: 'Profile updated successfully', data: updated });
  } catch (error) {
    console.error('updateMyProfile error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating profile' });
  }
};

// ─── ADMIN: BIDDER MANAGEMENT ────────────────────────────────────────────────

exports.getAllBidders = async (req, res) => {
  try {
    const filters = {
      kyc_status: req.query.kyc_status,
      is_active: req.query.is_active,
      search: req.query.search,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    };
    const result = await bidderService.getAllBidders(filters);
    res.status(200).json({
      success: true,
      data: result.bidders,
      pagination: { 
        total: result.total, 
        page: filters.page, 
        limit: filters.limit, 
        pages: Math.ceil(result.total / filters.limit) 
      }
    });
  } catch (error) {
    console.error('Get bidders error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching bidders' });
  }
};

exports.getBidderById = async (req, res) => {
  try {
    const bidder = await bidderService.getBidderById(req.params.id, {
      includeMaterialInterests: true,
      includeLocationPreferences: true,
      includePurchaseHistory: false
    });
    if (!bidder) return res.status(404).json({ success: false, message: 'Bidder not found' });
    res.status(200).json({ success: true, data: bidder });
  } catch (error) {
    console.error('Get bidder error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching bidder' });
  }
};

exports.updateBidder = async (req, res) => {
  try {
    const bidder = await bidderService.updateBidder(req.params.id, req.body);
    if (!bidder) return res.status(404).json({ success: false, message: 'Bidder not found' });
    res.status(200).json({ success: true, message: 'Bidder updated successfully', data: bidder });
  } catch (error) {
    console.error('Update bidder error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating bidder' });
  }
};

exports.deleteBidder = async (req, res) => {
  try {
    const deleted = await bidderService.deleteBidder(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Bidder not found' });
    res.status(200).json({ success: true, message: 'Bidder deleted successfully' });
  } catch (error) {
    console.error('Delete bidder error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting bidder' });
  }
};

// KYC MANAGEMENT
exports.updateKYCStatus = async (req, res) => {
  try {
    const { kyc_status, rejection_reason } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(kyc_status)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC status' });
    }
    const bidder = await bidderService.updateKYCStatus(req.params.id, kyc_status, rejection_reason);
    if (!bidder) return res.status(404).json({ success: false, message: 'Bidder not found' });
    res.status(200).json({ success: true, message: 'KYC status updated successfully', data: bidder });
  } catch (error) {
    console.error('Update KYC status error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating KYC status' });
  }
};

exports.getKYCDocuments = async (req, res) => {
  try {
    const documents = await bidderService.getKYCDocuments(req.params.id);
    res.status(200).json({ success: true, data: documents });
  } catch (error) {
    console.error('Get KYC documents error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching KYC documents' });
  }
};

// MATERIAL INTERESTS
exports.getMaterialInterests = async (req, res) => {
  try {
    const interests = await bidderService.getMaterialInterests(req.params.id);
    res.status(200).json({ success: true, data: interests });
  } catch (error) {
    console.error('Get material interests error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching material interests' });
  }
};

exports.addMaterialInterest = async (req, res) => {
  try {
    const { category_id } = req.body;
    if (!category_id) {
      return res.status(400).json({ success: false, message: 'category_id is required' });
    }
    const interest = await bidderService.addMaterialInterest(req.params.id, category_id);
    res.status(201).json({ success: true, message: 'Material interest added successfully', data: interest });
  } catch (error) {
    console.error('Add material interest error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error adding material interest' });
  }
};

exports.removeMaterialInterest = async (req, res) => {
  try {
    const deleted = await bidderService.removeMaterialInterest(req.params.interestId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Material interest not found' });
    res.status(200).json({ success: true, message: 'Material interest removed successfully' });
  } catch (error) {
    console.error('Remove material interest error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error removing material interest' });
  }
};

// LOCATION PREFERENCES
exports.getLocationPreferences = async (req, res) => {
  try {
    const preferences = await bidderService.getLocationPreferences(req.params.id);
    res.status(200).json({ success: true, data: preferences });
  } catch (error) {
    console.error('Get location preferences error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching location preferences' });
  }
};

exports.addLocationPreference = async (req, res) => {
  try {
    const { city, state, max_distance_km } = req.body;
    if (!city || !state) {
      return res.status(400).json({ success: false, message: 'city and state are required' });
    }
    const preference = await bidderService.addLocationPreference(req.params.id, { city, state, max_distance_km });
    res.status(201).json({ success: true, message: 'Location preference added successfully', data: preference });
  } catch (error) {
    console.error('Add location preference error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error adding location preference' });
  }
};

exports.removeLocationPreference = async (req, res) => {
  try {
    const deleted = await bidderService.removeLocationPreference(req.params.preferenceId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Location preference not found' });
    res.status(200).json({ success: true, message: 'Location preference removed successfully' });
  } catch (error) {
    console.error('Remove location preference error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error removing location preference' });
  }
};

// PURCHASE HISTORY & STATS
exports.getPurchaseHistory = async (req, res) => {
  try {
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10
    };
    const result = await bidderService.getPurchaseHistory(req.params.id, filters);
    res.status(200).json({
      success: true,
      data: result.purchases,
      pagination: { 
        total: result.total, 
        page: filters.page, 
        limit: filters.limit, 
        pages: Math.ceil(result.total / filters.limit) 
      }
    });
  } catch (error) {
    console.error('Get purchase history error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching purchase history' });
  }
};

exports.getBidderStats = async (req, res) => {
  try {
    const stats = await bidderService.getBidderStats(req.params.id);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Get bidder stats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching bidder stats' });
  }
};
