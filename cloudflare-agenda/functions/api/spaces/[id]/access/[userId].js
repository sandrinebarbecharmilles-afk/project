// Retirer l'accès d'un membre à un espace (propriétaire uniquement).
import { json } from '../../../../../shared/util.js';

export async function onRequestDelete({ env, data, params }) {
  const uid = data.user.id, sid = params.id, target = params.userId;
  const s = await env.DB.prepare('SELECT owner_user_id FROM spaces WHERE id=?').bind(sid).first();
  if (!s) return json({ error: 'not_found' }, 404);
  if (s.owner_user_id !== uid) return json({ error: 'forbidden' }, 403);
  if (target === s.owner_user_id) return json({ error: 'cannot_remove_owner' }, 400);
  await env.DB.prepare('DELETE FROM space_users WHERE space_id=? AND user_id=?').bind(sid, target).run();
  return json({ ok: true });
}
