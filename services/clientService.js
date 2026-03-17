// services/clientService.js
// Fixed version - works with different database import patterns

// Try to import database pool - adjust based on your project structure
let pool;
try {
  pool = require('../config/database');
} catch (e) {
  try {
    pool = require('../db');
  } catch (e) {
    try {
      pool = require('../database');
    } catch (e) {
      // If none work, we'll use pg directly
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
    }
  }
}

// ============================================
// CLIENT SERVICES
// ============================================

const generateClientCode = async () => {
  const result = await pool.query(
    `SELECT client_code FROM clients 
     WHERE client_code LIKE 'CLT-%' 
     ORDER BY created_at DESC 
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return 'CLT-001';
  }

  const lastCode = result.rows[0].client_code;
  const lastNumber = parseInt(lastCode.split('-')[1]);
  const newNumber = (lastNumber + 1).toString().padStart(3, '0');
  return `CLT-${newNumber}`;
};

exports.createClient = async (clientData) => {
  const {
    client_code,
    company_name,
    parent_group,
    registered_address,
    city,
    state,
    pincode,
    primary_account_manager_id,
    default_payment_terms,
    default_lifting_terms,
    custom_terms_and_conditions,
    status = 'active'
  } = clientData;

  const finalClientCode = client_code || await generateClientCode();

  const query = `
    INSERT INTO clients (
      client_code, company_name, parent_group, registered_address, city, state, pincode,
      primary_account_manager_id,
      default_payment_terms, default_lifting_terms, custom_terms_and_conditions, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const values = [
    finalClientCode, company_name, parent_group, registered_address, city, state, pincode,
    primary_account_manager_id,
    default_payment_terms, default_lifting_terms, custom_terms_and_conditions, status
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.getAllClients = async (filters) => {
  const { status, parent_group, city, state, account_manager_id, search, page = 1, limit = 10 } = filters;

  let whereClause = 'WHERE 1=1';
  const values = [];
  let paramCount = 1;

  if (status) {
    whereClause += ` AND c.status = $${paramCount}`;
    values.push(status);
    paramCount++;
  }

  if (parent_group) {
    whereClause += ` AND c.parent_group = $${paramCount}`;
    values.push(parent_group);
    paramCount++;
  }

  if (city) {
    whereClause += ` AND c.city ILIKE $${paramCount}`;
    values.push(`%${city}%`);
    paramCount++;
  }

  if (state) {
    whereClause += ` AND c.state = $${paramCount}`;
    values.push(state);
    paramCount++;
  }

  if (account_manager_id) {
    whereClause += ` AND c.primary_account_manager_id = $${paramCount}`;
    values.push(account_manager_id);
    paramCount++;
  }

  if (search) {
    whereClause += ` AND (c.company_name ILIKE $${paramCount} OR c.client_code ILIKE $${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }

  const countQuery = `SELECT COUNT(*) as total FROM clients c ${whereClause}`;
  const countResult = await pool.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const query = `
    SELECT 
      c.*, u.name as account_manager_name, u.phone as account_manager_phone,
      COUNT(DISTINCT cl.id) as total_locations, COUNT(DISTINCT a.id) as total_auctions
    FROM clients c
    LEFT JOIN users u ON c.primary_account_manager_id = u.id
    LEFT JOIN client_locations cl ON c.id = cl.client_id
    LEFT JOIN auctions a ON c.id = a.client_id
    ${whereClause}
    GROUP BY c.id, u.name, u.phone
    ORDER BY c.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  const result = await pool.query(query, values);
  return { clients: result.rows, total };
};

exports.getClientById = async (clientId, options = {}) => {
  const { includeLocations = true, includeContacts = true } = options;

  const clientQuery = `
    SELECT c.*, u.name as account_manager_name, u.phone as account_manager_phone, u.email as account_manager_email
    FROM clients c
    LEFT JOIN users u ON c.primary_account_manager_id = u.id
    WHERE c.id = $1
  `;

  const clientResult = await pool.query(clientQuery, [clientId]);
  if (clientResult.rows.length === 0) return null;

  const client = clientResult.rows[0];

  if (includeLocations) {
    const locationsQuery = `
      SELECT cl.*, u.name as field_support_name, u.phone as field_support_phone
      FROM client_locations cl
      LEFT JOIN users u ON cl.field_support_person_id = u.id
      WHERE cl.client_id = $1 AND cl.is_active = true
      ORDER BY cl.created_at DESC
    `;
    const locationsResult = await pool.query(locationsQuery, [clientId]);
    client.locations = locationsResult.rows;
  }

  if (includeContacts) {
    const contactsQuery = `
      SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY is_primary DESC, created_at DESC
    `;
    const contactsResult = await pool.query(contactsQuery, [clientId]);
    client.contacts = contactsResult.rows;
  }

  return client;
};

exports.updateClient = async (clientId, updates) => {
  const allowedFields = [
    'company_name', 'parent_group', 'registered_address', 'city', 'state', 'pincode',
    'primary_account_manager_id',
    'default_payment_terms', 'default_lifting_terms', 'custom_terms_and_conditions', 'status'
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

  values.push(clientId);
  const query = `UPDATE clients SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`;
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.deleteClient = async (clientId) => {
  const query = 'DELETE FROM clients WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [clientId]);
  return result.rows.length > 0;
};

// ============================================
// LOCATION SERVICES
// ============================================

const generateLocationCode = async (clientId) => {
  const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [clientId]);
  if (clientResult.rows.length === 0) throw new Error('Client not found');

  const clientCode = clientResult.rows[0].client_code;
  const result = await pool.query(
    'SELECT location_code FROM client_locations WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1',
    [clientId]
  );

  if (result.rows.length === 0) return `${clientCode}-LOC-001`;

  const lastCode = result.rows[0].location_code;
  const lastNumber = parseInt(lastCode.split('-').pop());
  const newNumber = (lastNumber + 1).toString().padStart(3, '0');
  return `${clientCode}-LOC-${newNumber}`;
};

exports.addLocation = async (locationData) => {
  const {
    client_id, location_code, plant_name, address, city, state, pincode,
    plant_manager_name, plant_manager_phone, plant_manager_email,
    lifting_contact_name, lifting_contact_phone, lifting_contact_email, field_support_person_id
  } = locationData;

  const finalLocationCode = location_code || await generateLocationCode(client_id);

  const query = `
    INSERT INTO client_locations (
      client_id, location_code, plant_name, address, city, state, pincode,
      plant_manager_name, plant_manager_phone, plant_manager_email,
      lifting_contact_name, lifting_contact_phone, lifting_contact_email, field_support_person_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
  `;

  const values = [
    client_id, finalLocationCode, plant_name, address, city, state, pincode,
    plant_manager_name, plant_manager_phone, plant_manager_email,
    lifting_contact_name, lifting_contact_phone, lifting_contact_email, field_support_person_id
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.getClientLocations = async (clientId) => {
  const query = `
    SELECT cl.*, u.name as field_support_name, u.phone as field_support_phone
    FROM client_locations cl
    LEFT JOIN users u ON cl.field_support_person_id = u.id
    WHERE cl.client_id = $1 ORDER BY cl.created_at DESC
  `;
  const result = await pool.query(query, [clientId]);
  return result.rows;
};

exports.updateLocation = async (locationId, updates) => {
  const allowedFields = [
    'plant_name', 'address', 'city', 'state', 'pincode',
    'plant_manager_name', 'plant_manager_phone', 'plant_manager_email',
    'lifting_contact_name', 'lifting_contact_phone', 'lifting_contact_email',
    'field_support_person_id', 'is_active'
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

  values.push(locationId);
  const query = `UPDATE client_locations SET ${setClause.join(', ')} WHERE id = $${paramCount} RETURNING *`;
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.deleteLocation = async (locationId) => {
  const query = 'DELETE FROM client_locations WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [locationId]);
  return result.rows.length > 0;
};

// ============================================
// CONTACT SERVICES
// ============================================

exports.addContact = async (contactData) => {
  const { client_id, contact_type, name, designation, phone, email, is_primary = false } = contactData;

  if (is_primary) {
    await pool.query('UPDATE client_contacts SET is_primary = false WHERE client_id = $1', [client_id]);
  }

  const query = `
    INSERT INTO client_contacts (client_id, contact_type, name, designation, phone, email, is_primary)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
  `;

  const values = [client_id, contact_type, name, designation, phone, email, is_primary];
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.getClientContacts = async (clientId) => {
  const query = 'SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY is_primary DESC, created_at DESC';
  const result = await pool.query(query, [clientId]);
  return result.rows;
};

exports.updateContact = async (contactId, updates) => {
  const allowedFields = ['contact_type', 'name', 'designation', 'phone', 'email', 'is_primary'];

  if (updates.is_primary) {
    const getClientQuery = 'SELECT client_id FROM client_contacts WHERE id = $1';
    const clientResult = await pool.query(getClientQuery, [contactId]);
    if (clientResult.rows.length > 0) {
      await pool.query('UPDATE client_contacts SET is_primary = false WHERE client_id = $1', [clientResult.rows[0].client_id]);
    }
  }

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

  values.push(contactId);
  const query = `UPDATE client_contacts SET ${setClause.join(', ')} WHERE id = $${paramCount} RETURNING *`;
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.deleteContact = async (contactId) => {
  const query = 'DELETE FROM client_contacts WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [contactId]);
  return result.rows.length > 0;
};

// ============================================
// STATISTICS SERVICES
// ============================================

exports.getClientStats = async (clientId) => {
  const query = `
    SELECT 
      COUNT(DISTINCT a.id) as total_auctions,
      COUNT(DISTINCT CASE WHEN a.status = 'completed' THEN a.id END) as completed_auctions,
      COUNT(DISTINCT CASE WHEN a.status = 'live' THEN a.id END) as live_auctions,
      COUNT(DISTINCT CASE WHEN a.is_reauction = true THEN a.id END) as reauctions,
      COUNT(DISTINCT al.id) as total_lots,
      COUNT(DISTINCT CASE WHEN al.status = 'sold' THEN al.id END) as sold_lots,
      COALESCE(SUM(al.winning_bid), 0) as total_revenue,
      COALESCE(AVG(al.winning_bid), 0) as avg_lot_value,
      COUNT(DISTINCT cl.id) as total_locations,
      COUNT(DISTINCT cc.id) as total_contacts
    FROM clients c
    LEFT JOIN auctions a ON c.id = a.client_id
    LEFT JOIN auction_lots al ON a.id = al.auction_id
    LEFT JOIN client_locations cl ON c.id = cl.client_id
    LEFT JOIN client_contacts cc ON c.id = cc.client_id
    WHERE c.id = $1
    GROUP BY c.id
  `;

  const result = await pool.query(query, [clientId]);
  return result.rows[0] || {};
};

exports.getClientAuctions = async (clientId, filters) => {
  const { status, page = 1, limit = 10 } = filters;

  let whereClause = 'WHERE a.client_id = $1';
  const values = [clientId];
  let paramCount = 2;

  if (status) {
    whereClause += ` AND a.status = $${paramCount}`;
    values.push(status);
    paramCount++;
  }

  const countQuery = `SELECT COUNT(*) as total FROM auctions a ${whereClause}`;
  const countResult = await pool.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const query = `
    SELECT 
      a.*, m.material_name, cl.plant_name as location_name,
      COUNT(DISTINCT al.id) as total_lots,
      COUNT(DISTINCT CASE WHEN al.status = 'sold' THEN al.id END) as sold_lots,
      COALESCE(SUM(al.winning_bid), 0) as total_value
    FROM auctions a
    LEFT JOIN materials m ON a.material_id = m.id
    LEFT JOIN client_locations cl ON a.location_id = cl.id
    LEFT JOIN auction_lots al ON a.id = al.auction_id
    ${whereClause}
    GROUP BY a.id, m.material_name, cl.plant_name
    ORDER BY a.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  const result = await pool.query(query, values);
  return { auctions: result.rows, total };
};

module.exports = exports;