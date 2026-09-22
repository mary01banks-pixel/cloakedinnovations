// Vercel Serverless Function — POST /api/send-email
// Sends an email via Resend (https://resend.com) without exposing the API
// key to the browser. Requires an environment variable set in Vercel:
//
//   Project → Settings → Environment Variables
//     RESEND_API_KEY   = re_xxxxxxxxxxxxxxxxxxxxxxxx
//     FROM_EMAIL        = Cloaked Innovations <no-reply@cloakedinnovations.co.ke>
//                          (must be on a domain verified in Resend — see README)
//
// No admin auth check is done here beyond requiring the three fields, since
// the admin panel itself is gated by Supabase Auth before this is ever
// called from the browser. If you want to harden this further later, you
// can verify a Supabase session token passed in the request here too.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, body } = req.body || {};

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'Cloaked Innovations <onboarding@resend.dev>';

  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not set in this Vercel project\'s environment variables.' });
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subject,
        text: body,
        reply_to: 'cloakedsolutionsltd@gmail.com'
      })
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
