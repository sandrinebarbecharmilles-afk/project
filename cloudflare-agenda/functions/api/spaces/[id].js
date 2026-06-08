// Lecture / écriture / suppression / renommage d'un espace.
//  GET    -> contenu de l'agenda + liste des accès + invitations en attente
//  PUT    -> enregistre le contenu (avec contrôle de version anti-conflit)
//  PATCH  -> renomme l'espace
//  DELETE -> supprime l'espace (propriétaire) ou quitte l'espace (membre)
import { json } from '../../../shared/util.js';

async function getAccess(env, sid, uid) {
  return env.DB.prepare('SELECT role FROM space_users WHERE space_id=? AND user_id=?').bind(sid, uid).first();
}

export async function onRequestGet({ env, data, params }) {
  const uid = data.user.id, sid = params.id;
  const acc = await getAccess(env, sid, uid);
  if (!acc) return json({ error: 'forbidden' }, 403);

  const s = await env.DB.prepare('SELECT id,type,name,owner_user_id AS ownerUserId,version,data FROM spaces WHERE id=?').bind(sid).first();
  if (!s) return json({ error: 'not_found' }, 404);

  let parsed;
  try { parsed = JSON.parse(s.data); } catch (e) { parsed = {}; }
  const content = {
    members: parsed.members || [], events: parsed.events || [],
    holidays: parsed.holidays || [], custody: parsed.custody || [],
  };

  const acl = await env.DB.prepare(
    'SELECT u.id AS userId, u.email, u.name, su.role FROM space_users su JOIN users u ON u.id=su.user_id WHERE su.space_id=?'
  ).bind(sid).all();
  const invites = await env.DB.prepare('SELECT id,email,role FROM invites WHERE space_id=? AND used=0').bind(sid).all();

  return json({
    space: { id: s.id, type: s.type, name: s.name, ownerUserId: s.ownerUserId, version: s.version, role: acc.role },
    data: content,
    access: acl.results || [],
    invites: invites.results || [],
  });
}

export async function onRequestPut({ request, env, data, params }) {
  const uid = data.user.id, sid = params.id;
  const acc = await getAccess(env, sid, uid);
  if (!acc) return json({ error: 'forbidden' }, 403);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }

  const cur = await env.DB.prepare('SELECT version,data FROM spaces WHERE id=?').bind(sid).first();
  if (!cur) return json({ error: 'not_found' }, 404);

  // Contrôle de concurrence : si la version a changé entre temps, on refuse.
  if (typeof b.version === 'number' && b.version !== cur.version) {
    let parsed; try { parsed = JSON.parse(cur.data); } catch (e) { parsed = {}; }
    return json({ error: 'conflict', version: cur.version, data: parsed }, 409);
  }

  const d = b.data || {};
  const clean = {
    members: d.members || [], events: d.events || [],
    holidays: d.holidays || [], custody: d.custody || [],
  };
  const nv = cur.version + 1;
  await env.DB.prepare('UPDATE spaces SET data=?, version=?, updated_at=? WHERE id=?')
    .bind(JSON.stringify(clean), nv, Date.now(), sid).run();
  return json({ ok: true, version: nv });
}

export async function onRequestPatch({ request, env, data, params }) {
  const uid = data.user.id, sid = params.id;
  const s = await env.DB.prepare('SELECT owner_user_id FROM spaces WHERE id=?').bind(sid).first();
  if (!s) return json({ error: 'not_found' }, 404);
  if (s.owner_user_id !== uid) return json({ error: 'forbidden' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  const name = (b.name || '').trim();
  if (!name) return json({ error: 'invalid_name' }, 400);
  await env.DB.prepare('UPDATE spaces SET name=? WHERE id=?').bind(name, sid).run();
  return json({ ok: true, name });
}

export async function onRequestDelete({ env, data, params }) {
  const uid = data.user.id, sid = params.id;
  const s = await env.DB.prepare('SELECT owner_user_id FROM spaces WHERE id=?').bind(sid).first();
  if (!s) return json({ error: 'not_found' }, 404);

  if (s.owner_user_id === uid) {
    // Le propriétaire supprime l'espace entièrement
    await env.DB.batch([
      env.DB.prepare('DELETE FROM space_users WHERE space_id=?').bind(sid),
      env.DB.prepare('DELETE FROM invites WHERE space_id=?').bind(sid),
      env.DB.prepare('DELETE FROM spaces WHERE id=?').bind(sid),
    ]);
    return json({ ok: true, deleted: true });
  }
  // Un membre quitte l'espace
  await env.DB.prepare('DELETE FROM space_users WHERE space_id=? AND user_id=?').bind(sid, uid).run();
  return json({ ok: true, left: true });
}
