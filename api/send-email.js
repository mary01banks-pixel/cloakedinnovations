// Vercel Serverless Function — POST /api/send-email
// Sends an email via Resend (https://resend.com) without exposing the API
// key to the browser. Supports two sender identities, chosen by the
// request's "purpose" field ('general' | 'support').
//
// Requires these environment variables in Vercel:
//   Project → Settings → Environment Variables
//
//   RESEND_API_KEY        = re_xxxxxxxxxxxxxxxxxxxxxxxx
//   ADMIN_EMAIL           = the email address of your admin login (comma separated if more than one)
//   SUPABASE_URL          = https://xxxxx.supabase.co   (already used by inbound-email.js)
//   SUPABASE_ANON_KEY     = your anon key (if not set, SUPABASE_SERVICE_ROLE_KEY is used)
//   GENERAL_FROM_EMAIL    = Cloaked Innovations Limited <info@cloakedinnovations.co.ke>
//   SUPPORT_FROM_EMAIL    = Cloaked Innovations Limited Support <support@cloakedinnovations.co.ke>
//
// Both addresses must be on a domain verified in Resend — see README.
// (noreply@ is NOT sent from here — that one is configured directly in
// Supabase's SMTP settings for auth emails, not through this function.)
//
// Only a logged in admin can call this endpoint. The admin panel sends its
// Supabase session token as "Authorization: Bearer <token>", and this function
// confirms with Supabase that the token belongs to an address in ADMIN_EMAIL.
// An admin can send to any recipient; everyone else gets a 401 or 403.

async function checkAdmin(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Please log in to the admin panel to send email.' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admins = (process.env.ADMIN_EMAIL || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!supabaseUrl || !apiKey || admins.length === 0) {
    return { ok: false, status: 500, error: 'Server setup incomplete: set SUPABASE_URL, SUPABASE_ANON_KEY and ADMIN_EMAIL in Vercel.' };
  }

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: apiKey }
    });
    if (!r.ok) return { ok: false, status: 401, error: 'Your admin session has expired. Please log in again.' };
    const user = await r.json();
    const email = String((user && user.email) || '').toLowerCase();
    if (!email || !admins.includes(email)) {
      return { ok: false, status: 403, error: 'This account is not allowed to send email.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, status: 500, error: 'Could not verify your login. Please try again.' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await checkAdmin(req);
  if (!admin.ok) {
    return res.status(admin.status).json({ error: admin.error });
  }

  const { to, subject, body, purpose, inReplyTo } = req.body || {};

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    return res.status(400).json({ error: 'Please enter one valid recipient email address.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not set in this Vercel project\'s environment variables.' });
  }

  const fromByPurpose = {
    support: process.env.SUPPORT_FROM_EMAIL || 'Cloaked Innovations Limited Support <onboarding@resend.dev>',
    general: process.env.GENERAL_FROM_EMAIL || 'Cloaked Innovations Limited <onboarding@resend.dev>'
  };
  const fromEmail = fromByPurpose[purpose] || fromByPurpose.general;
  const replyTo = purpose === 'support'
    ? (process.env.SUPPORT_REPLY_TO || 'support@cloakedinnovations.co.ke')
    : (process.env.GENERAL_REPLY_TO || 'info@cloakedinnovations.co.ke');

  const payload = {
    from: fromEmail,
    to: [to.trim()],
    subject: subject,
    text: body,
    reply_to: replyTo
  };
  // If replying to a received message, thread it properly in the
  // recipient's mail client using the standard email headers.
  if (inReplyTo) {
    payload.headers = {
      'In-Reply-To': inReplyTo,
      'References': inReplyTo
    };
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resendRes.json();

    if (!resendRes.ok) {
      return res.status(resendRes.status).json({ error: data.message || 'Resend rejected the request.' });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected server error sending email.' });
  }
}
