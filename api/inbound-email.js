// Vercel Serverless Function — POST /api/inbound-email
// Receives Resend's "email.received" webhook (sent when mail arrives at
// info@ or support@), verifies it's genuinely from Resend, fetches the
// full email body (webhooks only carry metadata, not the body), and
// stores the message in Supabase so it shows up in the admin Mailbox tab.
//
// Requires these environment variables in Vercel:
//   RESEND_API_KEY            = re_xxxxxxxxxxxxxxxxxxxxxxxx  (already set for sending)
//   RESEND_WEBHOOK_SECRET      = whsec_xxxxxxxxxxxxxxxxxxxx   (from Resend → Webhooks)
//   SUPABASE_URL               = https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  = your service_role key (Supabase → Settings → API)
//                                 NEVER expose this one in browser code — it
//                                 bypasses Row Level Security entirely, which
//                                 is exactly why only this server function uses it.
//
// See README.md → "Set up the mailbox" for how to create the webhook in
// Resend and point it at this endpoint.

import crypto from 'crypto';

// Disable Vercel's automatic body parsing so we can read the exact raw
// bytes Resend signed — required for signature verification to work.
export const config = {
  api: {
    bodyParser: false
  }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(secret, svixId, svixTimestamp, svixSignatureHeader, rawBody) {
  if (!secret || !svixId || !svixTimestamp || !svixSignatureHeader) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const provided = svixSignatureHeader.split(' ').map((s) => s.split(',')[1]);
  return provided.includes(expected);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const ok = verifySignature(
    webhookSecret,
    req.headers['svix-id'],
    req.headers['svix-timestamp'],
    req.headers['svix-signature'],
    rawBody
  );

  if (!ok) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  if (event.type !== 'email.received') {
    // Not an inbound-mail event (Resend also sends delivery/bounce events
    // to the same endpoint if you subscribe to them) — acknowledge and ignore.
    return res.status(200).json({ ignored: true });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const emailId = event.data && event.data.email_id;
  if (!apiKey || !emailId) {
    return res.status(500).json({ error: 'Missing RESEND_API_KEY or email_id.' });
  }

  // Webhooks only carry metadata — fetch the actual body separately.
  let full;
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    full = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: full.message || 'Could not fetch full email from Resend.' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch full email content.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' });
  }

  const row = {
    resend_email_id: emailId,
    from_address: full.from || null,
    to_address: Array.isArray(full.to) ? full.to.join(', ') : (full.to || null),
    subject: full.subject || null,
    body_text: full.text || null,
    body_html: full.html || null,
    message_id: full.message_id || null,
    is_read: false
  };

  try {
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/inbox_messages`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(500).json({ error: 'Supabase insert failed: ' + errText });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to save message to Supabase.' });
  }

  return res.status(200).json({ success: true });
}
