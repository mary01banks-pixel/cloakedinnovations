// POST /api/manage-admins
// Lets a logged in admin add or remove other admins and send sign-in links.
//
//   { "action": "add",    "email": "...", "name": "..." }  adds an admin and emails a link to set a password
//   { "action": "resend", "email": "..." }                 emails a fresh link (also works as "forgot password")
//   { "action": "remove", "email": "..." }                 removes an admin and deletes their login
//
// Needs these Vercel environment variables (all already used by the other routes):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, GENERAL_FROM_EMAIL
// Optional:
//   SITE_URL = https://www.cloakedinnovations.co.ke
//
// In Supabase, Authentication > URL Configuration > Redirect URLs must include
//   https://www.cloakedinnovations.co.ke/admin

import crypto from 'crypto';
import { checkAdmin } from './_lib/admin-auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await checkAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const { supabaseUrl, serviceKey } = admin;
  const siteUrl = (process.env.SITE_URL || 'https://www.cloakedinnovations.co.ke').replace(/\/+$/, '');
  const body = req.body || {};
  const action = body.action;
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 120);

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const svc = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  // ---------- helpers ----------
  async function ensureLogin() {
    const password = crypto.randomUUID() + crypto.randomUUID();
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST', headers: svc,
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    const text = JSON.stringify(d).toLowerCase();
    if (r.status === 422 || text.includes('already') || text.includes('registered') || text.includes('exists')) {
      return { ok: true }; // the login already exists
    }
    return { ok: false, error: d.msg || d.message || 'Could not create the login.' };
  }

  async function makeLink() {
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: svc,
      body: JSON.stringify({ type: 'recovery', email, redirect_to: `${siteUrl}/admin` })
    });
    const d = await r.json().catch(() => ({}));
    return d.action_link || (d.properties && d.properties.action_link) || null;
  }

  async function emailLink(link, isNew) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return false;
    const from = process.env.GENERAL_FROM_EMAIL || 'Cloaked Innovations Limited <onboarding@resend.dev>';
    const greeting = name ? `Hello ${name},` : 'Hello,';
    const intro = isNew
      ? 'You have been added as an administrator for the Cloaked Innovations Limited website.'
      : 'Here is a new sign-in link for the Cloaked Innovations Limited admin panel.';
    const text = [
      greeting, '',
      intro, '',
      'Use this link to set your password:',
      link, '',
      'The link works once and expires after a short time. After you set your password, sign in any time at:',
      `${siteUrl}/admin`, '',
      `Sign in with this email address: ${email}`, '',
      'If the link has expired, ask another admin to send you a new one.',
      'If you were not expecting this email, you can ignore it.'
    ].join('\n');
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Your Cloaked Innovations admin access', text })
      });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  async function inviteFlow(isNew) {
    const login = await ensureLogin();
    if (!login.ok) return { status: 500, error: login.error };
    const link = await makeLink();
    if (!link) {
      return { status: 500, error: 'Could not create the sign-in link. Check that your site address is listed under Redirect URLs in Supabase.' };
    }
    const emailed = await emailLink(link, isNew);
    return { status: 200, emailed, inviteLink: emailed ? undefined : link };
  }

  try {
    // ---------- add ----------
    if (action === 'add') {
      const ins = await fetch(`${supabaseUrl}/rest/v1/admins`, {
        method: 'POST',
        headers: { ...svc, Prefer: 'return=minimal' },
        body: JSON.stringify({ email, name })
      });
      if (ins.status === 409) return res.status(409).json({ error: 'That person is already an admin.' });
      if (!ins.ok) {
        return res.status(500).json({ error: 'Could not add the admin. Has supabase-admin-team.sql been run in Supabase?' });
      }
      const out = await inviteFlow(true);
      if (out.error) return res.status(out.status).json({ ok: false, added: true, error: out.error });
      return res.status(200).json({ ok: true, emailed: out.emailed, inviteLink: out.inviteLink });
    }

    // ---------- resend ----------
    if (action === 'resend') {
      const q = await fetch(`${supabaseUrl}/rest/v1/admins?select=email,name&email=eq.${encodeURIComponent(email)}&limit=1`, { headers: svc });
      const rows = q.ok ? await q.json() : [];
      if (!rows.length) return res.status(404).json({ error: 'That email is not on the admin list.' });
      const out = await inviteFlow(false);
      if (out.error) return res.status(out.status).json({ ok: false, error: out.error });
      return res.status(200).json({ ok: true, emailed: out.emailed, inviteLink: out.inviteLink });
    }

    // ---------- remove ----------
    if (action === 'remove') {
      if (email === admin.email) {
        return res.status(400).json({ error: 'You cannot remove your own access. Ask another admin to do it.' });
      }
      const target = await fetch(`${supabaseUrl}/rest/v1/admins?select=role&email=eq.${encodeURIComponent(email)}&limit=1`, { headers: svc });
      const targetRows = target.ok ? await target.json() : [];
      if (targetRows.length && targetRows[0].role === 'owner') {
        return res.status(400).json({ error: 'The owner cannot be removed.' });
      }
      const all = await fetch(`${supabaseUrl}/rest/v1/admins?select=email`, { headers: svc });
      const list = all.ok ? await all.json() : [];
      if (list.length <= 1) {
        return res.status(400).json({ error: 'You cannot remove the last admin.' });
      }
      const del = await fetch(`${supabaseUrl}/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, {
        method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' }
      });
      if (!del.ok) return res.status(500).json({ error: 'Could not remove the admin.' });

      // Also delete their login so they cannot sign in at all (best effort).
      try {
        const users = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers: svc });
        const data = users.ok ? await users.json() : {};
        const match = (data.users || []).find((u) => String(u.email || '').toLowerCase() === email);
        if (match) {
          await fetch(`${supabaseUrl}/auth/v1/admin/users/${match.id}`, { method: 'DELETE', headers: svc });
        }
      } catch (e) { /* the admin entry is already removed, which blocks access */ }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
