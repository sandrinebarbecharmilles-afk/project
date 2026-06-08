// Renvoie l'utilisateur connecté et la liste de ses espaces (perso + familles).
import { json } from '../../shared/util.js';

export async function onRequestGet({ env, data }) {
  const uid = data.user.id;
  const u = await env.DB.prepare('SELECT id,email,name,picture FROM users WHERE id=?').bind(uid).first();
  const sp = await env.DB.prepare(
    "SELECT s.id, s.type, s.name, s.owner_user_id AS ownerUserId, su.role " +
    "FROM spaces s JOIN space_users su ON su.space_id=s.id WHERE su.user_id=? " +
    "ORDER BY (s.type='perso') ASC, s.name"
  ).bind(uid).all();
  return json({ user: u, spaces: sp.results || [] });
}
