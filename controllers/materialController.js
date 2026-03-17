const materialService = require('../services/materialService');

exports.getAllCategories = async (req, res) => {
  try {
    const categories = await materialService.getAllCategories();
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching categories' });
  }
};

exports.getCategoryById = async (req, res) => {
  try {
    const category = await materialService.getCategoryById(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching category' });
  }
};

exports.getAllMaterials = async (req, res) => {
  try {
    const filters = {
      category_id: req.query.category_id,
      search: req.query.search,
      is_active: req.query.is_active,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    };
    const result = await materialService.getAllMaterials(filters);
    res.status(200).json({
      success: true,
      data: result.materials,
      pagination: { total: result.total, page: filters.page, limit: filters.limit, pages: Math.ceil(result.total / filters.limit) }
    });
  } catch (error) {
    console.error('Get materials error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching materials' });
  }
};

exports.getMaterialById = async (req, res) => {
  try {
    const material = await materialService.getMaterialById(req.params.id);
    if (!material) return res.status(404).json({ success: false, message: 'Material not found' });
    res.status(200).json({ success: true, data: material });
  } catch (error) {
    console.error('Get material error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching material' });
  }
};

exports.createMaterial = async (req, res) => {
  try {
    const material = await materialService.createMaterial(req.body);
    res.status(201).json({ success: true, message: 'Material created successfully', data: material });
  } catch (error) {
    console.error('Create material error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating material' });
  }
};

exports.updateMaterial = async (req, res) => {
  try {
    const material = await materialService.updateMaterial(req.params.id, req.body);
    if (!material) return res.status(404).json({ success: false, message: 'Material not found' });
    res.status(200).json({ success: true, message: 'Material updated successfully', data: material });
  } catch (error) {
    console.error('Update material error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating material' });
  }
};

exports.deleteMaterial = async (req, res) => {
  try {
    const deleted = await materialService.deleteMaterial(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Material not found' });
    res.status(200).json({ success: true, message: 'Material deleted successfully' });
  } catch (error) {
    console.error('Delete material error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting material' });
  }
};
