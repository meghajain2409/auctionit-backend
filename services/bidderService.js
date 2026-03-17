let pool;
try {
  pool = require('../config/database');
} catch (e) {
  try {
    pool = require('../db');
  } catch (e) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
}

// ============================================
// BIDDER PROFILE SERVICES
// ============================================

exports.getAllBidders = async (filters) => {
  const { kyc_status, is_active, city, state, search, page = 1, limit = 20 } = filters;

  let whereClause = 'WHERE 1=1';
  const values = [];
  let paramCount = 1;

  if (kyc_status) {
    whereClause += ` AND b.kyc_status = $${paramCount}`;
    values.push(kyc_status);
    paramCount++;
  }

  if (is_active !== undefined) {
    whereClause += ` AND u.is_active = $${paramCount}`;
    values.push(is_active === 'true');
    paramCount++;
  }

  if (city) {
    whereClause += ` AND b.city ILIKE $${paramCount}`;
    values.push(`%${city}%`);
    paramCount++;
  }

  if (state) {
    whereClause += ` AND b.state = $${paramCount}`;
    values.push(state);
    paramCount++;
  }

  if (search) {
    whereClause += ` AND (b.company_name ILIKE $${paramCount} OR u.name ILIKE $${paramCount} OR u.phone ILIKE $${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }

  const countQuery = `
    SELECT COUNT(*) as total 
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    ${whereClause}
  `;
  const countResult = await pool.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const query = `
    SELECT 
      b.*,
      u.name, u.phone, u.email, u.is_active,
      COUNT(DISTINCT bmi.id) as material_interests_count,
      COUNT(DISTINCT blp.id) as location_preferences_count,
      COUNT(DISTINCT bph.id) as total_purchases,
      COALESCE(SUM(bph.purchase_amount), 0) as total_purchase_value
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    LEFT JOIN bidder_material_interests bmi ON b.id = bmi.bidder_id
    LEFT JOIN bidder_location_preferences blp ON b.id = blp.bidder_id
    LEFT JOIN bidder_purchase_history bph ON b.id = bph.bidder_id
    ${whereClause}
    GROUP BY b.id, u.name, u.phone, u.email, u.is_active
    ORDER BY b.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  const result = await pool.query(query, values);
  return { bidders: result.rows, total };
};

exports.getBidderById = async (bidderId, options = {}) => {
  const { includeMaterialInterests = false, includeLocationPreferences = false, includePurchaseHistory = false } = options;

  const query = `
    SELECT b.*, u.name, u.phone, u.email, u.is_active
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    WHERE b.id = $1
  `;
  const result = await pool.query(query, [bidderId]);
  if (result.rows.length === 0) return null;

  const bidder = result.rows[0];

  if (includeMaterialInterests) {
    bidder.material_interests = await this.getMaterialInterests(bidderId);
  }

  if (includeLocationPreferences) {
    bidder.location_preferences = await this.getLocationPreferences(bidderId);
  }

  if (includePurchaseHistory) {
    const history = await this.getPurchaseHistory(bidderId, { page: 1, limit: 5 });
    bidder.recent_purchases = history.purchases;
  }

  return bidder;
};

exports.updateBidder = async (bidderId, updates) => {
  const allowedFields = [
    'company_name', 'gst_number', 'pan_number', 'address', 'city', 'state', 
    'pincode', 'bank_name', 'account_number', 'ifsc_code', 'account_holder_name'
  ];

  const setClause = [];
  const values = [];
  let paramCount = 1;

  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      setClause.push(`${key} = $${paramCount}`);
      values.push(updates[key]);
      paramCount++;
    }
  });

  if (setClause.length === 0) throw new Error('No valid fields to update');

  values.push(bidderId);
  const query = `UPDATE bidders SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`;
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.deleteBidder = async (bidderId) => {
  const query = 'DELETE FROM bidders WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [bidderId]);
  return result.rows.length > 0;
};

// ============================================
// KYC MANAGEMENT SERVICES
// ============================================

exports.updateKYCStatus = async (bidderId, kycStatus, rejectionReason = null) => {
  const query = `
    UPDATE bidders 
    SET kyc_status = $1, 
        kyc_rejection_reason = $2,
        kyc_approved_at = CASE WHEN $1 = 'approved' THEN CURRENT_TIMESTAMP ELSE kyc_approved_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *
  `;
  const result = await pool.query(query, [kycStatus, rejectionReason, bidderId]);
  return result.rows[0];
};

exports.getKYCDocuments = async (bidderId) => {
  const query = `
    SELECT 
      pan_number, gst_number, 
      aadhar_front_url, aadhar_back_url,
      pan_card_url, gst_certificate_url,
      cancelled_cheque_url,
      kyc_status, kyc_rejection_reason, kyc_approved_at
    FROM bidders
    WHERE id = $1
  `;
  const result = await pool.query(query, [bidderId]);
  return result.rows[0];
};

// ============================================
// MATERIAL INTERESTS SERVICES
// ============================================

exports.getMaterialInterests = async (bidderId) => {
  const query = `
    SELECT bmi.*, mc.category_name, mc.category_code
    FROM bidder_material_interests bmi
    JOIN material_categories mc ON bmi.category_id = mc.id
    WHERE bmi.bidder_id = $1
    ORDER BY bmi.created_at DESC
  `;
  const result = await pool.query(query, [bidderId]);
  return result.rows;
};

exports.addMaterialInterest = async (bidderId, categoryId) => {
  // Check if already exists
  const checkQuery = 'SELECT id FROM bidder_material_interests WHERE bidder_id = $1 AND category_id = $2';
  const existing = await pool.query(checkQuery, [bidderId, categoryId]);
  
  if (existing.rows.length > 0) {
    throw new Error('Material interest already exists');
  }

  const query = `
    INSERT INTO bidder_material_interests (bidder_id, category_id)
    VALUES ($1, $2)
    RETURNING *
  `;
  const result = await pool.query(query, [bidderId, categoryId]);
  return result.rows[0];
};

exports.removeMaterialInterest = async (interestId) => {
  const query = 'DELETE FROM bidder_material_interests WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [interestId]);
  return result.rows.length > 0;
};

// ============================================
// LOCATION PREFERENCES SERVICES
// ============================================

exports.getLocationPreferences = async (bidderId) => {
  const query = `
    SELECT * FROM bidder_location_preferences
    WHERE bidder_id = $1
    ORDER BY created_at DESC
  `;
  const result = await pool.query(query, [bidderId]);
  return result.rows;
};

exports.addLocationPreference = async (bidderId, preferenceData) => {
  const { city, state, max_distance_km = 100 } = preferenceData;

  // Check if already exists
  const checkQuery = 'SELECT id FROM bidder_location_preferences WHERE bidder_id = $1 AND city = $2 AND state = $3';
  const existing = await pool.query(checkQuery, [bidderId, city, state]);
  
  if (existing.rows.length > 0) {
    throw new Error('Location preference already exists');
  }

  const query = `
    INSERT INTO bidder_location_preferences (bidder_id, city, state, max_distance_km)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const result = await pool.query(query, [bidderId, city, state, max_distance_km]);
  return result.rows[0];
};

exports.removeLocationPreference = async (preferenceId) => {
  const query = 'DELETE FROM bidder_location_preferences WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [preferenceId]);
  return result.rows.length > 0;
};

// ============================================
// PURCHASE HISTORY & STATS SERVICES
// ============================================

exports.getPurchaseHistory = async (bidderId, filters) => {
  const { page = 1, limit = 10 } = filters;

  const countQuery = 'SELECT COUNT(*) as total FROM bidder_purchase_history WHERE bidder_id = $1';
  const countResult = await pool.query(countQuery, [bidderId]);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;

  const query = `
    SELECT 
      bph.*,
      a.auction_title,
      al.lot_number,
      m.material_name,
      c.company_name as client_name
    FROM bidder_purchase_history bph
    JOIN auction_lots al ON bph.lot_id = al.id
    JOIN auctions a ON al.auction_id = a.id
    JOIN materials m ON al.material_id = m.id
    JOIN clients c ON a.client_id = c.id
    WHERE bph.bidder_id = $1
    ORDER BY bph.purchase_date DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await pool.query(query, [bidderId, limit, offset]);
  return { purchases: result.rows, total };
};

exports.getBidderStats = async (bidderId) => {
  const query = `
    SELECT 
      COUNT(DISTINCT bph.id) as total_purchases,
      COALESCE(SUM(bph.purchase_amount), 0) as total_spent,
      COALESCE(AVG(bph.purchase_amount), 0) as avg_purchase_value,
      COUNT(DISTINCT bph.lot_id) as lots_won,
      COUNT(DISTINCT a.id) as auctions_participated,
      COUNT(DISTINCT bmi.category_id) as material_interests_count,
      COUNT(DISTINCT blp.id) as location_preferences_count
    FROM bidders b
    LEFT JOIN bidder_purchase_history bph ON b.id = bph.bidder_id
    LEFT JOIN auction_lots al ON bph.lot_id = al.id
    LEFT JOIN auctions a ON al.auction_id = a.id
    LEFT JOIN bidder_material_interests bmi ON b.id = bmi.bidder_id
    LEFT JOIN bidder_location_preferences blp ON b.id = blp.bidder_id
    WHERE b.id = $1
    GROUP BY b.id
  `;

  const result = await pool.query(query, [bidderId]);
  return result.rows[0] || {};
};

module.exports = exports;