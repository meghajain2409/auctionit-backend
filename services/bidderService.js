const db = require('../config/db');

// ============================================
// BIDDER PROFILE SERVICES
// ============================================

exports.getAllBidders = async (filters) => {
  const { kyc_status, is_active, search, page = 1, limit = 20 } = filters;

  let whereClause = 'WHERE 1=1';
  const values = [];
  let paramCount = 1;

  if (kyc_status) {
    whereClause += ` AND u.kyc_status = $${paramCount}`;
    values.push(kyc_status);
    paramCount++;
  }

  if (is_active !== undefined && is_active !== '') {
    whereClause += ` AND b.is_active = $${paramCount}`;
    values.push(is_active === 'true');
    paramCount++;
  }

  if (search) {
    whereClause += ` AND (b.company_name ILIKE $${paramCount} OR b.contact_person ILIKE $${paramCount} OR u.phone ILIKE $${paramCount} OR b.bidder_code ILIKE $${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }

  const countQuery = `
    SELECT COUNT(*) as total 
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    ${whereClause}
  `;
  const countResult = await db.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const query = `
    SELECT 
      b.*,
      u.name, u.phone, u.email, u.is_active AS user_active, u.kyc_status
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    ${whereClause}
    ORDER BY b.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  const result = await db.query(query, values);
  return { bidders: result.rows, total };
};

exports.getBidderById = async (bidderId, options = {}) => {
  const { includeMaterialInterests = false, includeLocationPreferences = false } = options;

  const query = `
    SELECT b.*, u.name, u.phone, u.email, u.is_active AS user_active, u.kyc_status
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    WHERE b.id = $1
  `;
  const result = await db.query(query, [bidderId]);
  if (result.rows.length === 0) return null;

  const bidder = result.rows[0];

  if (includeMaterialInterests) {
    try { bidder.material_interests = await this.getMaterialInterests(bidderId); }
    catch (e) { bidder.material_interests = []; }
  }

  if (includeLocationPreferences) {
    try { bidder.location_preferences = await this.getLocationPreferences(bidderId); }
    catch (e) { bidder.location_preferences = []; }
  }

  return bidder;
};

exports.updateBidder = async (bidderId, updates) => {
  const allowedFields = [
    'company_name', 'contact_person', 'gst_number', 'pan_number',
    'business_type', 'bidder_type', 'is_active', 'blacklisted', 'blacklist_reason'
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
  const result = await db.query(query, values);
  return result.rows[0];
};

exports.deleteBidder = async (bidderId) => {
  // Get user_id first to also delete user
  const bidder = await db.query('SELECT user_id FROM bidders WHERE id = $1', [bidderId]);
  if (bidder.rows.length === 0) return false;

  await db.query('DELETE FROM bidders WHERE id = $1', [bidderId]);
  await db.query('DELETE FROM users WHERE id = $1', [bidder.rows[0].user_id]);
  return true;
};

// ============================================
// KYC MANAGEMENT SERVICES
// ============================================

exports.updateKYCStatus = async (bidderId, kycStatus, rejectionReason = null) => {
  // KYC status lives on the users table, not bidders
  const bidder = await db.query('SELECT user_id FROM bidders WHERE id = $1', [bidderId]);
  if (bidder.rows.length === 0) return null;

  await db.query(
    `UPDATE users SET kyc_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [kycStatus, bidder.rows[0].user_id]
  );

  // Return updated bidder with user info
  const result = await db.query(
    `SELECT b.*, u.name, u.phone, u.email, u.kyc_status
     FROM bidders b JOIN users u ON b.user_id = u.id
     WHERE b.id = $1`,
    [bidderId]
  );
  return result.rows[0];
};

exports.getKYCDocuments = async (bidderId) => {
  const query = `
    SELECT 
      b.pan_number, b.gst_number,
      u.kyc_status
    FROM bidders b
    JOIN users u ON b.user_id = u.id
    WHERE b.id = $1
  `;
  const result = await db.query(query, [bidderId]);
  return result.rows[0];
};

// ============================================
// MATERIAL INTERESTS SERVICES
// ============================================

exports.getMaterialInterests = async (bidderId) => {
  const query = `
    SELECT bmi.*, mc.name AS category_name
    FROM bidder_material_interests bmi
    JOIN material_categories mc ON bmi.category_id = mc.id
    WHERE bmi.bidder_id = $1
    ORDER BY bmi.created_at DESC
  `;
  const result = await db.query(query, [bidderId]);
  return result.rows;
};

exports.addMaterialInterest = async (bidderId, categoryId) => {
  const checkQuery = 'SELECT id FROM bidder_material_interests WHERE bidder_id = $1 AND category_id = $2';
  const existing = await db.query(checkQuery, [bidderId, categoryId]);
  if (existing.rows.length > 0) throw new Error('Material interest already exists');

  const query = `INSERT INTO bidder_material_interests (bidder_id, category_id) VALUES ($1, $2) RETURNING *`;
  const result = await db.query(query, [bidderId, categoryId]);
  return result.rows[0];
};

exports.removeMaterialInterest = async (interestId) => {
  const query = 'DELETE FROM bidder_material_interests WHERE id = $1 RETURNING id';
  const result = await db.query(query, [interestId]);
  return result.rows.length > 0;
};

// ============================================
// LOCATION PREFERENCES SERVICES
// ============================================

exports.getLocationPreferences = async (bidderId) => {
  const query = `SELECT * FROM bidder_location_preferences WHERE bidder_id = $1 ORDER BY created_at DESC`;
  const result = await db.query(query, [bidderId]);
  return result.rows;
};

exports.addLocationPreference = async (bidderId, preferenceData) => {
  const { city, state, max_distance_km = 100 } = preferenceData;
  const checkQuery = 'SELECT id FROM bidder_location_preferences WHERE bidder_id = $1 AND city = $2 AND state = $3';
  const existing = await db.query(checkQuery, [bidderId, city, state]);
  if (existing.rows.length > 0) throw new Error('Location preference already exists');

  const query = `INSERT INTO bidder_location_preferences (bidder_id, city, state, max_distance_km) VALUES ($1, $2, $3, $4) RETURNING *`;
  const result = await db.query(query, [bidderId, city, state, max_distance_km]);
  return result.rows[0];
};

exports.removeLocationPreference = async (preferenceId) => {
  const query = 'DELETE FROM bidder_location_preferences WHERE id = $1 RETURNING id';
  const result = await db.query(query, [preferenceId]);
  return result.rows.length > 0;
};

// ============================================
// PURCHASE HISTORY & STATS SERVICES
// ============================================

exports.getPurchaseHistory = async (bidderId, filters) => {
  const { page = 1, limit = 10 } = filters;

  const countQuery = 'SELECT COUNT(*) as total FROM bidder_purchase_history WHERE bidder_id = $1';
  const countResult = await db.query(countQuery, [bidderId]);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;

  const query = `
    SELECT bph.*,
      a.title AS auction_title,
      al.lot_number
    FROM bidder_purchase_history bph
    LEFT JOIN auction_lots al ON bph.lot_id = al.id
    LEFT JOIN auctions a ON al.auction_id = a.id
    WHERE bph.bidder_id = $1
    ORDER BY bph.purchase_date DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await db.query(query, [bidderId, limit, offset]);
  return { purchases: result.rows, total };
};

exports.getBidderStats = async (bidderId) => {
  const query = `
    SELECT 
      b.total_bids_placed,
      b.total_auctions_won,
      b.total_purchase_value,
      b.win_rate
    FROM bidders b
    WHERE b.id = $1
  `;
  const result = await db.query(query, [bidderId]);
  return result.rows[0] || {};
};

module.exports = exports;
