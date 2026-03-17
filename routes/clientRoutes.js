const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { protect, authorize } = require('../middleware/auth');

// CLIENTS
router.post('/', protect, authorize('super_admin', 'account_manager'), clientController.createClient);
router.get('/', protect, authorize('super_admin', 'account_manager', 'field_support', 'finance', 'operations'), clientController.getAllClients);
router.get('/:id', protect, authorize('super_admin', 'account_manager', 'field_support', 'finance', 'operations'), clientController.getClientById);
router.put('/:id', protect, authorize('super_admin', 'account_manager'), clientController.updateClient);
router.delete('/:id', protect, authorize('super_admin'), clientController.deleteClient);

// LOCATIONS
router.post('/:id/locations', protect, authorize('super_admin', 'account_manager'), clientController.addLocation);
router.get('/:id/locations', protect, authorize('super_admin', 'account_manager', 'field_support', 'operations'), clientController.getClientLocations);
router.put('/:clientId/locations/:locationId', protect, authorize('super_admin', 'account_manager'), clientController.updateLocation);
router.delete('/:clientId/locations/:locationId', protect, authorize('super_admin'), clientController.deleteLocation);

// CONTACTS
router.post('/:id/contacts', protect, authorize('super_admin', 'account_manager'), clientController.addContact);
router.get('/:id/contacts', protect, authorize('super_admin', 'account_manager', 'field_support'), clientController.getClientContacts);
router.put('/:clientId/contacts/:contactId', protect, authorize('super_admin', 'account_manager'), clientController.updateContact);
router.delete('/:clientId/contacts/:contactId', protect, authorize('super_admin', 'account_manager'), clientController.deleteContact);

// STATISTICS
router.get('/:id/stats', protect, authorize('super_admin', 'account_manager'), clientController.getClientStats);
router.get('/:id/auctions', protect, authorize('super_admin', 'account_manager'), clientController.getClientAuctions);

module.exports = router;