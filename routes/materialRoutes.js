const express = require('express');
const router = express.Router();
const materialController = require('../controllers/materialController');
const { protect, authorize } = require('../middleware/auth');

// CATEGORIES
router.get('/categories', materialController.getAllCategories);
router.get('/categories/:id', materialController.getCategoryById);

// MATERIALS
router.get('/', materialController.getAllMaterials);
router.get('/:id', materialController.getMaterialById);
router.post('/', protect, authorize('super_admin'), materialController.createMaterial);
router.put('/:id', protect, authorize('super_admin'), materialController.updateMaterial);
router.delete('/:id', protect, authorize('super_admin'), materialController.deleteMaterial);

module.exports = router;