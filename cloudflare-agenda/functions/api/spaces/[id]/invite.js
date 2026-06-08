// Inviter une personne dans un espace famille via son adresse Gmail.
// Si l'adresse correspond déjà à un compte, l'accès est accordé immédiatement ;
// sinon une invitation en attente est créée (consommée à sa prochaine connexion).
import { json, rid } from '../../../../shared/util.js';

export async function onRequestPost({ request, env, data, params }) {
  const uid = data.user.id, sid = params.id;
  const acc = await env.DB.prepare('SELECT role FROM space_users WHERE space_id=? AND user_id=?').bind(sid, uid).first();
  if (!acc) return json({ error: 'forbidden' }, 403);

  const s = await env.DB.prepare('SELECT type FROM spaces WHERE id=?').bind(sid).first();
  if (!s) return json({ error: 'not_found' }, 404);
  if (s.type !== 'famille') return json({ error: 'not_family' }, 400);

  let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (existing) {
    const has = await env.DB.prepare('SELECT 1 FROM space_users WHERE space_id=? AND user_id=?').bind(sid, existing.id).first();
    if (!has) await env.DB.prepare('INSERT INTO space_users (space_id,user_id,role) VALUES (?,?,?)').bind(sid, existing.id, 'parent').run();
    return json({ ok: true, status: 'added', email });
  }

  const dup = await env.DB.prepare('SELECT id FROM invites WHERE space_id=? AND email=? AND used=0').bind(sid, email).first();
  if (!dup) {
    await env.DB.prepare('INSERT INTO invites (id,space_id,email,role,used,created_at) VALUES (?,?,?,?,0,?)')
      .bind(rid(12), sid, email, 'parent', Date.now()).run();
  }
  return json({ ok: true, status: 'invited', email });
}
