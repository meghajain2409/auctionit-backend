const clientService = require('../services/clientService');

exports.createClient = async (req, res) => {
  try {
    const clientData = { ...req.body, primary_account_manager_id: req.body.primary_account_manager_id || req.user.id };
    const client = await clientService.createClient(clientData);
    res.status(201).json({ success: true, message: 'Client created successfully', data: client });
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating client' });
  }
};

exports.getAllClients = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      parent_group: req.query.parent_group,
      city: req.query.city,
      state: req.query.state,
      account_manager_id: req.query.account_manager_id,
      search: req.query.search,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10
    };
    const result = await clientService.getAllClients(filters);
    res.status(200).json({
      success: true,
      data: result.clients,
      pagination: { total: result.total, page: filters.page, limit: filters.limit, pages: Math.ceil(result.total / filters.limit) }
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching clients' });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await clientService.getClientById(id, {
      includeLocations: req.query.include_locations !== 'false',
      includeContacts: req.query.include_contacts !== 'false'
    });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.status(200).json({ success: true, data: client });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching client' });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const client = await clientService.updateClient(req.params.id, req.body);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.status(200).json({ success: true, message: 'Client updated successfully', data: client });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating client' });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const deleted = await clientService.deleteClient(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Client not found' });
    res.status(200).json({ success: true, message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting client' });
  }
};

exports.addLocation = async (req, res) => {
  try {
    const location = await clientService.addLocation({ ...req.body, client_id: req.params.id });
    res.status(201).json({ success: true, message: 'Location added successfully', data: location });
  } catch (error) {
    console.error('Add location error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error adding location' });
  }
};

exports.getClientLocations = async (req, res) => {
  try {
    const locations = await clientService.getClientLocations(req.params.id);
    res.status(200).json({ success: true, data: locations });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching locations' });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const location = await clientService.updateLocation(req.params.locationId, req.body);
    if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
    res.status(200).json({ success: true, message: 'Location updated successfully', data: location });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating location' });
  }
};

exports.deleteLocation = async (req, res) => {
  try {
    const deleted = await clientService.deleteLocation(req.params.locationId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Location not found' });
    res.status(200).json({ success: true, message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Delete location error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting location' });
  }
};

exports.addContact = async (req, res) => {
  try {
    const contact = await clientService.addContact({ ...req.body, client_id: req.params.id });
    res.status(201).json({ success: true, message: 'Contact added successfully', data: contact });
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error adding contact' });
  }
};

exports.getClientContacts = async (req, res) => {
  try {
    const contacts = await clientService.getClientContacts(req.params.id);
    res.status(200).json({ success: true, data: contacts });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching contacts' });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const contact = await clientService.updateContact(req.params.contactId, req.body);
    if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });
    res.status(200).json({ success: true, message: 'Contact updated successfully', data: contact });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating contact' });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const deleted = await clientService.deleteContact(req.params.contactId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Contact not found' });
    res.status(200).json({ success: true, message: 'Contact deleted successfully' });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting contact' });
  }
};

exports.getClientStats = async (req, res) => {
  try {
    const stats = await clientService.getClientStats(req.params.id);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Get client stats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching client statistics' });
  }
};

exports.getClientAuctions = async (req, res) => {
  try {
    const filters = { status: req.query.status, page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 10 };
    const result = await clientService.getClientAuctions(req.params.id, filters);
    res.status(200).json({
      success: true,
      data: result.auctions,
      pagination: { total: result.total, page: filters.page, limit: filters.limit, pages: Math.ceil(result.total / filters.limit) }
    });
  } catch (error) {
    console.error('Get client auctions error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching client auctions' });
  }
};
