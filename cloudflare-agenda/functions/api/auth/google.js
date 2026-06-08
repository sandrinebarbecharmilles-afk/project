// Connexion via Google : vérifie le jeton d'identité, crée/maj l'utilisateur,
// garantit un espace perso, consomme les invitations en attente, ouvre la session.
import { verifyGoogleIdToken, makeSessionCookie, json, rid } from '../../../shared/util.js';

function seedData(name, uid) {
  return {
    members: [{ id: rid(), name: name || 'Moi', role: 'parent', color: '#C4736A', linkedUserId: uid }],
    events: [], holidays: [], custody: [],
  };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }

  const payload = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  if (!payload) return json({ error: 'invalid_token' }, 401);
  if (payload.email_verified === false) return json({ error: 'email_not_verified' }, 403);

  const uid = payload.sub;
  const email = String(payload.email || '').toLowerCase();
  const now = Date.now();
  const DB = env.DB;

  await DB.prepare(
    'INSERT INTO users (id,email,name,picture,created_at) VALUES (?,?,?,?,?) ' +
    'ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture'
  ).bind(uid, email, payload.name || '', payload.picture || '', now).run();

  // Garantir un espace perso
  const perso = await DB.prepare(
    "SELECT s.id FROM spaces s JOIN space_users su ON su.space_id=s.id WHERE su.user_id=? AND s.type='perso' LIMIT 1"
  ).bind(uid).first();
  if (!perso) {
    const sid = crypto.randomUUID();
    await DB.batch([
      DB.prepare('INSERT INTO spaces (id,type,name,owner_user_id,version,data,updated_at) VALUES (?,?,?,?,?,?,?)')
        .bind(sid, 'perso', 'Mon agenda', uid, 1, JSON.stringify(seedData(payload.name, uid)), now),
      DB.prepare('INSERT INTO space_users (space_id,user_id,role) VALUES (?,?,?)').bind(sid, uid, 'owner'),
    ]);
  }

  // Consommer les invitations en attente pour cette adresse
  const inv = await DB.prepare('SELECT id,space_id FROM invites WHERE email=? AND used=0').bind(email).all();
  for (const row of (inv.results || [])) {
    const has = await DB.prepare('SELECT 1 FROM space_users WHERE space_id=? AND user_id=?').bind(row.space_id, uid).first();
    const stmts = [];
    if (!has) stmts.push(DB.prepare('INSERT INTO space_users (space_id,user_id,role) VALUES (?,?,?)').bind(row.space_id, uid, 'parent'));
    stmts.push(DB.prepare('UPDATE invites SET used=1 WHERE id=?').bind(row.id));
    await DB.batch(stmts);
  }

  const cookie = await makeSessionCookie(uid, env.SESSION_SECRET);
  return json({ ok: true, user: { id: uid, email, name: payload.name, picture: payload.picture } }, 200, { 'Set-Cookie': cookie });
}
