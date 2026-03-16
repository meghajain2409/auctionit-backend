const axios = require('axios');

const sendOTPviaSMS = async (mobile, otp) => {
  try {
    console.log(`  📱 OTP for ${mobile}: ${otp}`);

    if (process.env.NODE_ENV === 'development') {
      console.log('  📱 Dev mode — skipping real SMS');
      return { success: true, dev: true };
    }

    const payload = {
      template_id: process.env.MSG91_TEMPLATE_ID,
      mobile:      `91${mobile}`,
      authkey:     process.env.MSG91_AUTH_KEY,
      otp:         String(otp)
    };

    console.log('  📱 Sending SMS with payload:', JSON.stringify(payload));

    const response = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      payload,
      {
        headers: { 
          'Content-Type': 'application/json',
          'authkey': process.env.MSG91_AUTH_KEY
        }
      }
    );

    console.log('  📱 SMS response:', JSON.stringify(response.data));
    return { success: true, data: response.data };

  } catch (err) {
    console.error('  📱 SMS error status:', err.response?.status);
    console.error('  📱 SMS error data:', JSON.stringify(err.response?.data));
    console.error('  📱 SMS error message:', err.message);
    return { success: false, error: err.message };
  }
};

module.exports = { sendOTPviaSMS };
