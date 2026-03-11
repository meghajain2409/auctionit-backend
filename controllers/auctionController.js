const db = require('../config/db');

// ─── CREATE AUCTION ───────────────────────────────────────────────────────────

const createAuction = async (req, res) => {
  const client = await db.getClient();
  try {
    const {
      title,
      description,
      auctionType = 'forward_timed',
      sellerId,
      registrationOpenAt,
      registrationCloseAt,
      startTime,
      endTime,
      emdAmount = 0,
      autoExtendEnabled = true,
      autoExtendTriggerMins = 5,
      autoExtendDurationMins = 5,
      maxExtensions = 10,
      materialLocation,
      inspectionDetails,
      termsAndConditions
    } = req.body;

    if (!title || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Title, start time and end time are required'
      });
    }

    if (new Date(startTime) >= new Date(endTime)) {
      return res.status(400).json({
        success: false,
        message: 'End time must be after start time'
      });
    }

    const effectiveSellerId = sellerId || req.user.id;

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO auctions (
        title, description, auction_type, seller_id,
        registration_open_at, registration_close_at,
        start_time, end_time, emd_amount,
        auto_extend_enabled, auto_extend_trigger_mins,
        auto_extend_duration_mins, max_extensions,
        material_location, inspection_details,
        terms_and_conditions, created_by, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, 'draft'
      ) RETURNING *`,
      [
        title, description, auctionType, effectiveSellerId,
        registrationOpenAt, registrationCloseAt,
        startTime, endTime, emdAmount,
        autoExtendEnabled, autoExtendTriggerMins,
        autoExtendDurationMins, maxExtensions,
        materialLocation, inspectionDetails,
        termsAndConditions, req.user.id
      ]
    );

    const auction = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description)
       VALUES ($1, $2, 'auction.created', 'auction', $3, $4)`,
      [req.user.id, req.user.role, auction.id, `Auction created: ${title}`]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Auction created successfully',
      data: auction
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create auction'
    });
  } finally {
    client.release();
  }
};

// ─── GET ALL AUCTIONS (PUBLIC) ────────────────────────────────────────────────

const getAuctions = async (req, res) => {
  try {
    const {
      status,
      type,
      page = 1,
      limit = 10,
      search
    } = req.query;

    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`a.status = $${paramCount++}`);
      params.push(status);
    } else {
      conditions.push(`a.status IN ('published', 'emd_collection', 'live', 'ended', 'awarded')`);
    }

    if (type) {
      conditions.push(`a.auction_type = $${paramCount++}`);
      params.push(type);
    }

    if (search) {
      conditions.push(`(a.title ILIKE $${paramCount} OR a.description ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM auctions a ${whereClause}`,
      params
    );

    const totalCount = parseInt(countResult.rows[0].count);

    params.push(limit, offset);

    const result = await db.query(
      `SELECT
        a.id, a.auction_number, a.title, a.description,
        a.auction_type, a.status, a.start_time, a.end_time,
        a.emd_amount, a.material_location,
        u.full_name AS seller_name,
        sp.company_name AS seller_company,
        COUNT(DISTINCT l.id) AS total_lots,
        COUNT(DISTINCT ar.id) FILTER (WHERE ar.status = 'active') AS registered_bidders
       FROM auctions a
       LEFT JOIN users u ON u.id = a.seller_id
       LEFT JOIN seller_profiles sp ON sp.user_id = a.seller_id
       LEFT JOIN lots l ON l.auction_id = a.id
       LEFT JOIN auction_registrations ar ON ar.auction_id = a.id
       ${whereClause}
       GROUP BY a.id, u.full_name, sp.company_name
       ORDER BY a.start_time ASC
       LIMIT $${paramCount++} OFFSET $${paramCount++}`,
      params
    );

    res.json({
      success: true,
      data: {
        auctions: result.rows,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (err) {
    console.error('getAuctions error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get auctions'
    });
  }
};

// ─── GET SINGLE AUCTION ───────────────────────────────────────────────────────

const getAuction = async (req, res) => {
  try {
    const { id } = req.params;

    const auctionResult = await db.query(
      `SELECT
        a.*,
        u.full_name AS seller_name,
        sp.company_name AS seller_company,
        sp.contact_person_name, sp.contact_phone,
        COUNT(DISTINCT ar.id) FILTER (WHERE ar.status = 'active') AS registered_bidders
       FROM auctions a
       LEFT JOIN users u ON u.id = a.seller_id
       LEFT JOIN seller_profiles sp ON sp.user_id = a.seller_id
       LEFT JOIN auction_registrations ar ON ar.auction_id = a.id
       WHERE a.id = $1
       GROUP BY a.id, u.full_name, sp.company_name,
                sp.contact_person_name, sp.contact_phone`,
      [id]
    );

    if (auctionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    const auction = auctionResult.rows[0];

    const lotsResult = await db.query(
      `SELECT
        l.*,
        mc.name AS category_name,
        COUNT(b.id) AS total_bids,
        li.url AS primary_image
       FROM lots l
       LEFT JOIN material_categories mc ON mc.id = l.category_id
       LEFT JOIN bids b ON b.lot_id = l.id
       LEFT JOIN LATERAL (
         SELECT url FROM lot_images
         WHERE lot_id = l.id
         ORDER BY sort_order ASC
         LIMIT 1
       ) li ON TRUE
       WHERE l.auction_id = $1
       GROUP BY l.id, mc.name, li.url
       ORDER BY l.sort_order ASC`,
      [id]
    );

    // Hide reserve price from non-admin users
    const isAdmin = req.user &&
      ['super_admin', 'auction_manager'].includes(req.user.role);

    const lots = lotsResult.rows.map(lot => ({
      ...lot,
      reserve_price: isAdmin ? lot.reserve_price : undefined
    }));

    res.json({
      success: true,
      data: {
        ...auction,
        lots
      }
    });

  } catch (err) {
    console.error('getAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get auction'
    });
  }
};

// ─── UPDATE AUCTION ───────────────────────────────────────────────────────────

const updateAuction = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      'SELECT * FROM auctions WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    if (!['draft', 'published'].includes(existing.rows[0].status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit auction that is live or completed'
      });
    }

    const {
      title, description, startTime, endTime,
      emdAmount, materialLocation, inspectionDetails,
      termsAndConditions, registrationOpenAt, registrationCloseAt,
      autoExtendEnabled, autoExtendTriggerMins, autoExtendDurationMins
    } = req.body;

    const result = await db.query(
      `UPDATE auctions SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        start_time = COALESCE($3, start_time),
        end_time = COALESCE($4, end_time),
        emd_amount = COALESCE($5, emd_amount),
        material_location = COALESCE($6, material_location),
        inspection_details = COALESCE($7, inspection_details),
        terms_and_conditions = COALESCE($8, terms_and_conditions),
        registration_open_at = COALESCE($9, registration_open_at),
        registration_close_at = COALESCE($10, registration_close_at),
        auto_extend_enabled = COALESCE($11, auto_extend_enabled),
        auto_extend_trigger_mins = COALESCE($12, auto_extend_trigger_mins),
        auto_extend_duration_mins = COALESCE($13, auto_extend_duration_mins),
        updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        title, description, startTime, endTime,
        emdAmount, materialLocation, inspectionDetails,
        termsAndConditions, registrationOpenAt, registrationCloseAt,
        autoExtendEnabled, autoExtendTriggerMins, autoExtendDurationMins,
        id
      ]
    );

    res.json({
      success: true,
      message: 'Auction updated successfully',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('updateAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update auction'
    });
  }
};

// ─── PUBLISH AUCTION ──────────────────────────────────────────────────────────

const publishAuction = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      `SELECT a.*, COUNT(l.id) AS lot_count
       FROM auctions a
       LEFT JOIN lots l ON l.auction_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    const auction = existing.rows[0];

    if (auction.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: `Auction is already ${auction.status}`
      });
    }

    if (parseInt(auction.lot_count) === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish auction with no lots'
      });
    }

    if (!auction.start_time || !auction.end_time) {
      return res.status(400).json({
        success: false,
        message: 'Auction must have start and end time before publishing'
      });
    }

    const result = await db.query(
      `UPDATE auctions
       SET status = 'published', published_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description)
       VALUES ($1, $2, 'auction.published', 'auction', $3, $4)`,
      [req.user.id, req.user.role, id, `Auction published: ${auction.title}`]
    );

    res.json({
      success: true,
      message: 'Auction published successfully',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('publishAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to publish auction'
    });
  }
};

// ─── GO LIVE ──────────────────────────────────────────────────────────────────

const goLive = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      'SELECT * FROM auctions WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    if (!['published', 'emd_collection'].includes(existing.rows[0].status)) {
      return res.status(400).json({
        success: false,
        message: 'Auction must be published before going live'
      });
    }

    // Set all lots to active
    await db.query(
      `UPDATE lots SET status = 'active', updated_at = NOW()
       WHERE auction_id = $1 AND status = 'draft'`,
      [id]
    );

    const result = await db.query(
      `UPDATE auctions
       SET status = 'live', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description)
       VALUES ($1, $2, 'auction.live', 'auction', $3, $4)`,
      [req.user.id, req.user.role, id, `Auction went live: ${existing.rows[0].title}`]
    );

    res.json({
      success: true,
      message: 'Auction is now LIVE!',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('goLive error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to start auction'
    });
  }
};

// ─── END AUCTION ──────────────────────────────────────────────────────────────

const endAuction = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      'SELECT * FROM auctions WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    if (existing.rows[0].status !== 'live') {
      return res.status(400).json({
        success: false,
        message: 'Only live auctions can be ended'
      });
    }

    // Mark unsold lots
    await db.query(
      `UPDATE lots
       SET status = 'unsold', updated_at = NOW()
       WHERE auction_id = $1 AND status = 'active'`,
      [id]
    );

    const result = await db.query(
      `UPDATE auctions
       SET status = 'ended', actual_end_time = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description)
       VALUES ($1, $2, 'auction.ended', 'auction', $3, $4)`,
      [req.user.id, req.user.role, id, `Auction ended: ${existing.rows[0].title}`]
    );

    res.json({
      success: true,
      message: 'Auction ended successfully',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('endAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to end auction'
    });
  }
};

// ─── CANCEL AUCTION ───────────────────────────────────────────────────────────

const cancelAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required'
      });
    }

    const existing = await db.query(
      'SELECT * FROM auctions WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    if (['completed', 'cancelled'].includes(existing.rows[0].status)) {
      return res.status(400).json({
        success: false,
        message: 'Auction is already completed or cancelled'
      });
    }

    const result = await db.query(
      `UPDATE auctions
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason, id]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description, metadata)
       VALUES ($1, $2, 'auction.cancelled', 'auction', $3, $4, $5)`,
      [req.user.id, req.user.role, id,
       `Auction cancelled: ${existing.rows[0].title}`,
       JSON.stringify({ reason })]
    );

    res.json({
      success: true,
      message: 'Auction cancelled',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('cancelAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel auction'
    });
  }
};

// ─── GET MY AUCTIONS (SELLER) ─────────────────────────────────────────────────

const getMyAuctions = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;
    const params = [req.user.id];
    let statusClause = '';

    if (status) {
      statusClause = 'AND a.status = $2';
      params.push(status);
    }

    params.push(limit, offset);

    const result = await db.query(
      `SELECT
        a.id, a.auction_number, a.title, a.auction_type,
        a.status, a.start_time, a.end_time, a.emd_amount,
        COUNT(DISTINCT l.id) AS total_lots,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'sold') AS lots_sold,
        COUNT(DISTINCT ar.id) FILTER (WHERE ar.status = 'active') AS registered_bidders
       FROM auctions a
       LEFT JOIN lots l ON l.auction_id = a.id
       LEFT JOIN auction_registrations ar ON ar.auction_id = a.id
       WHERE a.seller_id = $1 ${statusClause}
       GROUP BY a.id
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error('getMyAuctions error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get auctions'
    });
  }
};

module.exports = {
  createAuction,
  getAuctions,
  getAuction,
  updateAuction,
  publishAuction,
  goLive,
  endAuction,
  cancelAuction,
  getMyAuctions
};