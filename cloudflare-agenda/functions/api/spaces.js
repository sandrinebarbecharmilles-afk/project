// Création d'un espace (perso ou famille).
import { json, rid } from '../../shared/util.js';

export async function onRequestPost({ request, env, data }) {
  const uid = data.user.id;
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }

  const type = b.type === 'famille' ? 'famille' : 'perso';
  const name = (b.name || '').trim() || (type === 'famille' ? 'Ma famille' : 'Mon agenda');
  const u = await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(uid).first();
  const sid = crypto.randomUUID();
  const now = Date.now();
  const seed = {
    members: [{ id: rid(), name: (u && u.name) || 'Moi', role: 'parent', color: '#C4736A', linkedUserId: uid }],
    events: [], holidays: [], custody: [],
  };

  await env.DB.batch([
    env.DB.prepare('INSERT INTO spaces (id,type,name,owner_user_id,version,data,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(sid, type, name, uid, 1, JSON.stringify(seed), now),
    env.DB.prepare('INSERT INTO space_users (space_id,user_id,role) VALUES (?,?,?)').bind(sid, uid, 'owner'),
  ]);

  return json({ id: sid, type, name, ownerUserId: uid, role: 'owner' });
}
