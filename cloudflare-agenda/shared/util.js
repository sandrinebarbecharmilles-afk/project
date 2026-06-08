// =============================================================
//  Utilitaires partagés par les Functions Cloudflare
//  - réponses JSON
//  - cookies de session signés (HMAC-SHA256)
//  - vérification du jeton d'identité Google (RS256 via JWKS)
//  Aucune dépendance : uniquement les API Web (WebCrypto, fetch).
// =============================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function parseCookie(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---------- base64url ----------
function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  const bin = atob(str + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function strToB64url(s) { return bytesToB64url(enc.encode(s)); }
function b64urlToStr(s) { return dec.decode(b64urlToBytes(s)); }

// ---------- session signée ----------
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bytesToB64url(new Uint8Array(sig));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function makeSessionCookie(uid, secret, days = 30) {
  const payload = strToB64url(JSON.stringify({ uid, exp: Date.now() + days * 864e5 }));
  const sig = await hmac(secret, payload);
  return `sess=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${days * 86400}`;
}
export function clearSessionCookie() {
  return 'sess=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}
export async function verifySession(value, secret) {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const payload = value.slice(0, i), sig = value.slice(i + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const obj = JSON.parse(b64urlToStr(payload));
    if (!obj.exp || obj.exp < Date.now()) return null;
    return obj;
  } catch (e) { return null; }
}

// ---------- vérification du jeton Google ----------
let CERTS = null, CERTS_EXP = 0;
async function googleCerts() {
  const now = Date.now();
  if (CERTS && now < CERTS_EXP) return CERTS;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const body = await res.json();
  const map = {};
  (body.keys || []).forEach((k) => { map[k.kid] = k; });
  CERTS = map;
  const cc = res.headers.get('cache-control') || '';
  const m = cc.match(/max-age=(\d+)/);
  CERTS_EXP = now + (m ? parseInt(m[1], 10) * 1000 : 3600000);
  return CERTS;
}

// Vérifie la signature RS256 + les claims (aud, iss, exp). Renvoie le payload ou null.
export async function verifyGoogleIdToken(token, clientId) {
  if (!token || !clientId) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64urlToStr(parts[0]));
    payload = JSON.parse(b64urlToStr(parts[1]));
  } catch (e) { return null; }

  const certs = await googleCerts();
  const jwk = certs[header.kid];
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;

  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') return null;
  if (payload.aud !== clientId) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export function rid(n = 8) { return crypto.randomUUID().replace(/-/g, '').slice(0, n); }
