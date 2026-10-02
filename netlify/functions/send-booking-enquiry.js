/**
 * Netlify Function: send-booking-enquiry.js
 * Allows direct API trigger or fallback for sending booking enquiry emails via Resend.
 */

const submissionHandler = require('./submission-created.js');

exports.handler = async (event, context) => {
  return submissionHandler.handler(event, context);
};
