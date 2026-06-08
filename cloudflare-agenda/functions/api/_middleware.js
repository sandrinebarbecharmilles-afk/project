// Middleware exécuté pour toutes les routes /api/* :
//  - lit le cookie de session signé et attache l'utilisateur courant
//  - protège les routes (401) sauf les routes publiques
import { verifySession, parseCookie, json } from '../../shared/util.js';

const PUBLIC = ['/api/config', '/api/auth/google', '/api/auth/logout'];

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);

  const cookies = parseCookie(request.headers.get('Cookie'));
  let user = null;
  if (cookies.sess && env.SESSION_SECRET) {
    const s = await verifySession(cookies.sess, env.SESSION_SECRET);
    if (s) user = { id: s.uid };
  }
  data.user = user;

  if (PUBLIC.includes(url.pathname)) return next();
  if (!user) return json({ error: 'unauthorized' }, 401);
  return next();
}
