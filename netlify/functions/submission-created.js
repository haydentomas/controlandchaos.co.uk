/**
 * Netlify Background/Event Function: submission-created.js
 * Automatically triggered when a Netlify Form (e.g. 'escort-booking') is submitted.
 * Dispatches a formatted email notification directly to the escort's contact_email using Resend API.
 */

exports.handler = async (event, context) => {
  console.log('📬 [submission-created] Triggered form submission handler');

  try {
    let data = {};

    // 1. Parse payload from Netlify Event or Direct POST
    if (event.body) {
      try {
        const parsedBody = JSON.parse(event.body);
        // Netlify Forms event payload format: { payload: { data: { ... } } }
        if (parsedBody.payload && parsedBody.payload.data) {
          data = parsedBody.payload.data;
        } else if (parsedBody.data) {
          data = parsedBody.data;
        } else {
          data = parsedBody;
        }
      } catch (e) {
        // Form urlencoded fallback
        const params = new URLSearchParams(event.body);
        data = Object.fromEntries(params.entries());
      }
    }

    const escortEmail = data.escort_email || data.recipient_email;
    const escortName = data.escort_name || 'Companion / Escort';
    const clientName = data.client_name || 'Anonymous Client';
    const clientContact = data.client_contact || 'Not provided';
    const preferredDate = data.preferred_date || 'Flexible';
    const preferredTime = data.preferred_time || data.preferred_time_slot || 'Flexible';
    const quoteTotal = data.quote_total || 'Standard Rates';
    const selectedServices = data.selected_services || '';
    const message = data.message || '(No extra notes provided)';

    console.log(`📋 Booking request for: ${escortName} (${escortEmail || 'NO EMAIL SPECIFIED'}) from: ${clientName}`);

    if (!escortEmail) {
      console.warn('⚠️ No escort_email found in submission data. Skipping email dispatch.');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Submission logged, no escort email provided' })
      };
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY is not configured in Netlify environment variables.');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Submission received, but email service is unconfigured' })
      };
    }

    // Default sender (use verified domain email)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Control & Chaos <enquiries@controlandchaos.co.uk>';
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL; // Optional BCC copy to site admin

    // Build Luxury Branded HTML Email
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #0e0c0b; color: #f3f4f6; margin: 0; padding: 24px 12px; }
    .container { max-width: 620px; margin: 0 auto; background: #161412; border: 1px solid #d4af37; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
    .header { background: linear-gradient(135deg, #2a2219 0%, #12100e 100%); padding: 28px 24px; text-align: center; border-bottom: 1px solid rgba(212,175,55,0.3); }
    .header h1 { margin: 0; font-size: 24px; color: #ffd700; letter-spacing: 1px; text-transform: uppercase; font-weight: 800; }
    .header p { margin: 6px 0 0 0; font-size: 13px; color: #a8a29e; }
    .content { padding: 26px 24px; }
    .badge { display: inline-block; background: rgba(212,175,55,0.15); border: 1px solid #d4af37; color: #ffd700; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .section-title { font-size: 15px; font-weight: 700; color: #ffd700; margin: 20px 0 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px; }
    .details-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .details-table td { padding: 10px 12px; font-size: 13.5px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .details-table td.label { width: 38%; color: #a8a29e; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    .details-table td.val { color: #fff; font-weight: 600; }
    .notes-box { background: #0a0908; border: 1px solid rgba(212,175,55,0.25); border-radius: 8px; padding: 16px; margin-top: 12px; font-size: 13.5px; line-height: 1.6; color: #e5e7eb; white-space: pre-wrap; word-break: break-word; }
    .footer { background: #0e0c0b; padding: 18px 24px; text-align: center; font-size: 12px; color: #78716c; border-top: 1px solid rgba(255,255,255,0.06); }
    .footer a { color: #d4af37; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">✨ New Booking Request</span>
      <h1>Control &amp; Chaos</h1>
      <p>Direct Session Enquiry for <strong>${escortName}</strong></p>
    </div>

    <div class="content">
      <p style="font-size: 15px; color: #f3f4f6; margin-top: 0;">
        Hello <strong>${escortName}</strong>,
      </p>
      <p style="font-size: 13.5px; color: #d1d5db; line-height: 1.5;">
        You have received a new verified session enquiry via your Control &amp; Chaos directory profile. Here are the client's request details:
      </p>

      <div class="section-title">👤 Client &amp; Schedule Details</div>
      <table class="details-table">
        <tr>
          <td class="label">Client Name / SL</td>
          <td class="val" style="color: #ffd700;">${clientName}</td>
        </tr>
        <tr>
          <td class="label">Contact Info</td>
          <td class="val">${clientContact}</td>
        </tr>
        <tr>
          <td class="label">Requested Date</td>
          <td class="val">${preferredDate}</td>
        </tr>
        <tr>
          <td class="label">Time Slot</td>
          <td class="val" style="color: #60a5fa;">${preferredTime}</td>
        </tr>
        ${quoteTotal ? `
        <tr>
          <td class="label">Estimated Quote</td>
          <td class="val" style="color: #4ade80; font-size: 15px; font-weight: 800;">${quoteTotal}</td>
        </tr>` : ''}
        ${selectedServices ? `
        <tr>
          <td class="label">Selected Services</td>
          <td class="val">${selectedServices}</td>
        </tr>` : ''}
      </table>

      <div class="section-title">📝 Session Notes &amp; Scenario</div>
      <div class="notes-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>

      <div style="margin-top: 24px; padding: 14px 16px; background: rgba(212,175,55,0.08); border: 1px solid rgba(212,175,55,0.25); border-radius: 8px; font-size: 12.5px; color: #ffd700;">
        🛡️ <strong>Reminder:</strong> Payment is settled in Lindens (L$) in-world once you confirm the date and time with the client.
      </div>
    </div>

    <div class="footer">
      Sent automatically by <a href="https://controlandchaos.co.uk">Control &amp; Chaos Directory</a> • Second Life Luxury Redefined
    </div>
  </div>
</body>
</html>
`;

    // Email request body payload for Resend
    const emailPayload = {
      from: fromEmail,
      to: [escortEmail],
      subject: `✨ New Booking Request from ${clientName} (${quoteTotal || 'Session Enquiry'})`,
      html: htmlContent
    };

    // If clientContact looks like an email address, set reply_to
    if (clientContact.includes('@') && clientContact.includes('.')) {
      emailPayload.reply_to = clientContact.trim();
    }

    if (adminEmail) {
      emailPayload.bcc = [adminEmail];
    }

    console.log(`🚀 Sending email via Resend to: ${escortEmail} from: ${fromEmail}`);

    let resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });

    let resendData = await resendResponse.json();

    // Sandbox mode handling: If unverified domain cannot send to external recipient,
    // fallback to admin registered email so test submissions don't fail during testing
    if (!resendResponse.ok && resendData && resendData.message && resendData.message.includes('only send testing emails to your own email address')) {
      console.warn('⚠️ Resend is currently in Sandbox mode. Fallback sending test notification to admin email...');
      // Extract the allowed testing email from Resend error message if present (e.g. hello@pixaful.com)
      const allowedMatch = resendData.message.match(/\(([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/);
      const fallbackRecipient = (allowedMatch && allowedMatch[1]) || adminEmail;

      if (fallbackRecipient) {
        emailPayload.to = [fallbackRecipient];
        emailPayload.subject = `[SANDBOX TEST for ${escortName}] ` + emailPayload.subject;
        
        resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emailPayload)
        });
        resendData = await resendResponse.json();
      }
    }

    if (!resendResponse.ok) {
      console.error('❌ Resend API Error:', resendData);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to send email via Resend', details: resendData })
      };
    }

    console.log('✅ Email successfully delivered via Resend. ID:', resendData.id);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, emailId: resendData.id })
    };

  } catch (err) {
    console.error('❌ Unexpected error in submission-created function:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
