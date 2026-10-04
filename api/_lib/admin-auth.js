// Shared admin check for the API routes in /api.
//
// A request is allowed when it carries a valid Supabase login token
// ("Authorization: Bearer <token>") and that login's email is either:
//   1. listed in the "admins" table in Supabase (managed from the Team tab), or
//   2. listed in the optional ADMIN_EMAIL variable in Vercel (comma separated).
//      This is a safety net, so you can never be locked out of sending email.
//
// Needs these Vercel environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY (optional, the service role key is used if it is missing)
//   ADMIN_EMAIL (optional)

function fail(status, error) {
  return { ok: false, status, error };
}

export async function checkAdmin(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return fail(401, 'Please log in to the admin panel first.');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY || serviceKey;
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    return fail(500, 'Server setup incomplete. Missing in Vercel: ' + missing.join(', ') + '. After adding it, redeploy.');
  }

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey }
    });
    if (!r.ok) return fail(401, 'Your admin session has expired. Please log in again.');
    const user = await r.json();
    const email = String((user && user.email) || '').toLowerCase();
    if (!email) return fail(403, 'This account is not allowed to do that.');

    const owners = (process.env.ADMIN_EMAIL || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    let allowed = owners.includes(email);

    if (!allowed) {
      const q = await fetch(
        `${supabaseUrl}/rest/v1/admins?select=email&email=eq.${encodeURIComponent(email)}&limit=1`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (q.ok) {
        const rows = await q.json();
        allowed = Array.isArray(rows) && rows.length > 0;
      }
    }

    if (!allowed) return fail(403, 'This account is not allowed to do that.');
    return { ok: true, email, supabaseUrl, serviceKey };
  } catch (err) {
    return fail(500, 'Could not verify your login. Please try again.');
  }
}
