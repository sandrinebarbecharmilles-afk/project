import { clearSessionCookie, json } from '../../../shared/util.js';

export const onRequestPost = () => json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
