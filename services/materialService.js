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

// CATEGORIES
exports.getAllCategories = async () => {
  const query = `
    SELECT 
      mc.*,
      COUNT(DISTINCT m.id) as total_materials
    FROM material_categories mc
    LEFT JOIN materials m ON mc.id = m.category_id AND m.is_active = true
    WHERE mc.is_active = true
    GROUP BY mc.id
    ORDER BY mc.category_name
  `;
  const result = await pool.query(query);
  return result.rows;
};

exports.getCategoryById = async (categoryId) => {
  const query = `
    SELECT mc.*, COUNT(DISTINCT m.id) as total_materials
    FROM material_categories mc
    LEFT JOIN materials m ON mc.id = m.category_id
    WHERE mc.id = $1
    GROUP BY mc.id
  `;
  const result = await pool.query(query, [categoryId]);
  return result.rows[0];
};

// MATERIALS
const generateMaterialCode = async () => {
  const result = await pool.query(
    `SELECT material_code FROM materials 
     WHERE material_code LIKE 'MAT-%' 
     ORDER BY created_at DESC 
     LIMIT 1`
  );

  if (result.rows.length === 0) return 'MAT-001';

  const lastCode = result.rows[0].material_code;
  const lastNumber = parseInt(lastCode.split('-')[1]);
  const newNumber = (lastNumber + 1).toString().padStart(3, '0');
  return `MAT-${newNumber}`;
};

exports.getAllMaterials = async (filters) => {
  const { category_id, search, is_active, page = 1, limit = 20 } = filters;

  let whereClause = 'WHERE 1=1';
  const values = [];
  let paramCount = 1;

  if (category_id) {
    whereClause += ` AND m.category_id = $${paramCount}`;
    values.push(category_id);
    paramCount++;
  }

  if (search) {
    whereClause += ` AND (m.material_name ILIKE $${paramCount} OR m.material_code ILIKE $${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }

  if (is_active !== undefined) {
    whereClause += ` AND m.is_active = $${paramCount}`;
    values.push(is_active === 'true');
    paramCount++;
  }

  const countQuery = `SELECT COUNT(*) as total FROM materials m ${whereClause}`;
  const countResult = await pool.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total);

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const query = `
    SELECT 
      m.*,
      mc.category_name,
      mc.category_code
    FROM materials m
    LEFT JOIN material_categories mc ON m.category_id = mc.id
    ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `;

  const result = await pool.query(query, values);
  return { materials: result.rows, total };
};

exports.getMaterialById = async (materialId) => {
  const query = `
    SELECT m.*, mc.category_name, mc.category_code
    FROM materials m
    LEFT JOIN material_categories mc ON m.category_id = mc.id
    WHERE m.id = $1
  `;
  const result = await pool.query(query, [materialId]);
  return result.rows[0];
};

exports.createMaterial = async (materialData) => {
  const {
    material_code,
    material_name,
    category_id,
    description,
    unit_of_measurement
  } = materialData;

  const finalMaterialCode = material_code || await generateMaterialCode();

  const query = `
    INSERT INTO materials (
      material_code, material_name, category_id, description, unit_of_measurement
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;

  const values = [finalMaterialCode, material_name, category_id, description, unit_of_measurement];
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.updateMaterial = async (materialId, updates) => {
  const allowedFields = ['material_name', 'category_id', 'description', 'unit_of_measurement', 'is_active'];

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

  values.push(materialId);
  const query = `UPDATE materials SET ${setClause.join(', ')} WHERE id = $${paramCount} RETURNING *`;
  const result = await pool.query(query, values);
  return result.rows[0];
};

exports.deleteMaterial = async (materialId) => {
  const query = 'DELETE FROM materials WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [materialId]);
  return result.rows.length > 0;
};

module.exports = exports;
