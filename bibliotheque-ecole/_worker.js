const COOKIE_NAME = "be_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname === "/api/auth/google" && request.method === "GET") {
      return handleGoogleAuthRedirect(request, env, url);
    }

    if (url.pathname === "/api/auth/google/callback" && request.method === "GET") {
      return handleGoogleCallback(request, env, url);
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const auth = await isAuthenticated(request, env);
      if (!auth || !isAdminUser(auth.username, env)) return json({ error: "Non autorisé" }, {}, 401);
      return handleAdminListUsers(env);
    }

    if (url.pathname.startsWith("/api/admin/users/")) {
      const auth = await isAuthenticated(request, env);
      if (!auth || !isAdminUser(auth.username, env)) return json({ error: "Non autorisé" }, {}, 401);
      const username = normalizeUsername(decodeURIComponent(url.pathname.split("/").pop() || ""));
      if (!username) return json({ error: "Utilisateur manquant." }, {}, 400);

      if (request.method === "DELETE") {
        return handleAdminDeleteUser(env, username, auth.username);
      }

      if (request.method === "PATCH") {
        return handleAdminPatchUser(request, env, username, auth.username);
      }
    }

    if (url.pathname === "/api/account/consent" && request.method === "POST") {
      const auth = await isAuthenticated(request, env);
      if (!auth) return json({ error: "Non autorisé" }, {}, 401);
      return handleConsent(env, auth.username);
    }

    if (url.pathname === "/api/account" && request.method === "DELETE") {
      const auth = await isAuthenticated(request, env);
      if (!auth) return json({ error: "Non autorisé" }, {}, 401);
      if (isAdminUser(auth.username, env)) return json({ error: "Le compte administrateur ne peut pas être supprimé ici." }, {}, 409);
      return handleDeleteAccount(env, auth.username);
    }

    if (url.pathname === "/api/account/export" && request.method === "GET") {
      const auth = await isAuthenticated(request, env);
      if (!auth) return json({ error: "Non autorisé" }, {}, 401);
      return handleExportAccount(env, auth.username);
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return json({ ok: true }, {
        "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
      });
    }

    if (url.pathname === "/api/state") {
      const auth = await isAuthenticated(request, env);
      if (!auth) return json({ error: "Non autorisé" }, {}, 401);

      if (request.method === "GET") {
        return handleGetState(env, auth.username);
      }

      if (request.method === "PUT") {
        return handlePutState(request, env, auth.username);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Route inconnue" }, {}, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleLogin(request, env) {
  ensureDb(env);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await isLoginRateLimited(env, ip)) {
    return json({ error: "Trop de tentatives. Réessaie dans quelques minutes." }, {}, 429);
  }

  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = String(body.password || "").trim();

  if (!username) return json({ error: "Nom d'utilisateur manquant." }, {}, 400);
  if (!password) return json({ error: "Mot de passe manquant." }, {}, 400);

  const users = await getUsers(env);
  const existing = users[username];
  const passwordHash = await sha256Hex(username + ":" + password);
  let created = false;

  if (!existing) {
    users[username] = {
      passwordHash,
      createdAt: new Date().toISOString(),
      disabled: false
    };
    await setUsers(env, users);
    created = true;
  } else if (existing.disabled) {
    await recordLoginFailure(env, ip);
    return json({ error: "Ce compte est désactivé." }, {}, 403);
  } else if (!timingSafeEqual(existing.passwordHash, passwordHash)) {
    await recordLoginFailure(env, ip);
    return json({ error: "Nom d'utilisateur ou mot de passe incorrect." }, {}, 401);
  }

  users[username].lastLoginAt = new Date().toISOString();
  users[username].accessLog = [...(users[username].accessLog || []).slice(-19), { at: new Date().toISOString(), method: "password" }];
  await setUsers(env, users);

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${issuedAt}.${username}`;
  const signature = await signSession(payload, env);
  return json({ ok: true, username, created, isAdmin: isAdminUser(username, env) }, {
    "Set-Cookie": `${COOKIE_NAME}=${issuedAt}.${encodeURIComponent(username)}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
  });
}

async function handleGetState(env, username) {
  ensureDb(env);
  const users = await getUsers(env);
  const user = users[username] || {};
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind(SHARED_STATE_KEY).first();
  return json({
    state: row ? JSON.parse(row.value) : null,
    username,
    isAdmin: isAdminUser(username, env),
    consentRequired: !user.consentAt,
    accessLog: (user.accessLog || []).slice(-10)
  });
}

async function handlePutState(request, env, username) {
  ensureDb(env);
  const body = await request.json();
  await putValue(env, SHARED_STATE_KEY, JSON.stringify(body.state || {}));
  return json({ ok: true });
}

async function handleAdminListUsers(env) {
  const users = await getUsers(env);
  return json({
    users: Object.entries(users)
      .map(([username, user]) => ({
        username,
        createdAt: user.createdAt || "",
        disabled: Boolean(user.disabled),
        isAdmin: isAdminUser(username, env),
        lastLoginAt: user.lastLoginAt || "",
        authMethod: user.authMethod || "password"
      }))
      .sort((a, b) => String(a.username).localeCompare(String(b.username)))
  });
}

async function handleAdminDeleteUser(env, username, actorUsername) {
  if (isProtectedAdminUsername(username, env)) {
    return json({ error: "Ce compte administrateur ne peut pas être supprimé." }, {}, 409);
  }
  const users = await getUsers(env);
  if (!users[username]) return json({ error: "Utilisateur introuvable." }, {}, 404);
  delete users[username];
  await setUsers(env, users);
  await putValue(env, `audit:${Date.now()}:${username}`, JSON.stringify({ action: "delete-user", actor: actorUsername, username, at: new Date().toISOString() }));
  return json({ ok: true });
}

async function handleAdminPatchUser(request, env, username, actorUsername) {
  if (isProtectedAdminUsername(username, env)) {
    return json({ error: "Ce compte administrateur ne peut pas être modifié ici." }, {}, 409);
  }
  const body = await request.json().catch(() => ({}));
  const users = await getUsers(env);
  const user = users[username];
  if (!user) return json({ error: "Utilisateur introuvable." }, {}, 404);

  if (body.action === "toggle-disabled") {
    user.disabled = !Boolean(user.disabled);
    users[username] = user;
    await setUsers(env, users);
    return json({ ok: true, disabled: Boolean(user.disabled) });
  }

  if (body.action === "reset-password") {
    const password = String(body.password || "").trim();
    if (!password) return json({ error: "Mot de passe manquant." }, {}, 400);
    user.passwordHash = await sha256Hex(username + ":" + password);
    user.disabled = false;
    user.passwordUpdatedAt = new Date().toISOString();
    users[username] = user;
    await setUsers(env, users);
    await putValue(env, `audit:${Date.now()}:${username}`, JSON.stringify({ action: "reset-password", actor: actorUsername, username, at: new Date().toISOString() }));
    return json({ ok: true });
  }

  return json({ error: "Action inconnue." }, {}, 400);
}

async function handleConsent(env, username) {
  ensureDb(env);
  const users = await getUsers(env);
  if (!users[username]) return json({ error: "Utilisateur introuvable." }, {}, 404);
  users[username].consentAt = new Date().toISOString();
  await setUsers(env, users);
  return json({ ok: true });
}

async function handleDeleteAccount(env, username) {
  ensureDb(env);
  const users = await getUsers(env);
  delete users[username];
  await setUsers(env, users);
  return json({ ok: true }, {
    "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  });
}

async function handleExportAccount(env, username) {
  ensureDb(env);
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind(SHARED_STATE_KEY).first();
  const users = await getUsers(env);
  const user = users[username] || {};
  const exportData = {
    exportedAt: new Date().toISOString(),
    account: {
      username,
      email: user.email || "",
      displayName: user.displayName || "",
      createdAt: user.createdAt || "",
      authMethod: user.authMethod || "password"
    },
    sharedLibraryState: row ? JSON.parse(row.value) : null
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bibliotheque-ecole-${username}-${date}.json"`,
      "Cache-Control": "no-store"
    }
  });
}

async function handleGoogleAuthRedirect(request, env, url) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) return json({ error: "Google OAuth non configuré. Ajoutez GOOGLE_CLIENT_ID dans les variables d'environnement Cloudflare." }, {}, 500);
  const state = await generateOAuthState(env);
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account"
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

async function handleGoogleCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) return Response.redirect("/?oauth_error=access_denied", 302);
  if (!code || !state) return Response.redirect("/?oauth_error=missing_params", 302);

  const stateOk = await verifyOAuthState(state, env);
  if (!stateOk) return Response.redirect("/?oauth_error=invalid_state", 302);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/google/callback`,
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) return Response.redirect("/?oauth_error=token_failed", 302);

  const tokens = await tokenResponse.json();
  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });

  if (!userInfoResponse.ok) return Response.redirect("/?oauth_error=userinfo_failed", 302);

  const userInfo = await userInfoResponse.json();
  const email = String(userInfo.email || "").toLowerCase().trim();
  if (!email) return Response.redirect("/?oauth_error=no_email", 302);

  const username = normalizeUsername(email);
  ensureDb(env);
  const users = await getUsers(env);

  if (!users[username]) {
    users[username] = {
      email,
      googleId: userInfo.sub,
      displayName: userInfo.name || "",
      createdAt: new Date().toISOString(),
      disabled: false,
      authMethod: "google"
    };
    await setUsers(env, users);
  } else if (users[username].disabled) {
    return Response.redirect("/?oauth_error=account_disabled", 302);
  } else {
    if (userInfo.sub) users[username].googleId = userInfo.sub;
  }
  users[username].lastLoginAt = new Date().toISOString();
  users[username].accessLog = [...(users[username].accessLog || []).slice(-19), { at: new Date().toISOString(), method: "google" }];
  await setUsers(env, users);

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${issuedAt}.${username}`;
  const signature = await signSession(payload, env);
  const cookie = `${COOKIE_NAME}=${issuedAt}.${encodeURIComponent(username)}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;

  const headers = new Headers({ "Location": "/", "Set-Cookie": cookie });
  return new Response(null, { status: 302, headers });
}

async function generateOAuthState(env) {
  const value = `${Math.floor(Date.now() / 1000)}.${Math.random().toString(36).slice(2)}`;
  const sig = await signSession(value, env);
  return `${value}.${sig}`;
}

async function verifyOAuthState(state, env) {
  const lastDot = state.lastIndexOf(".");
  if (lastDot < 0) return false;
  const value = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);
  const expected = await signSession(value, env);
  if (!timingSafeEqual(sig, expected)) return false;
  const timestamp = parseInt(value.split(".")[0], 10);
  const age = Math.floor(Date.now() / 1000) - timestamp;
  return Number.isFinite(age) && age >= 0 && age < 600;
}

const LOGIN_RATE_LIMIT_MAX = 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

async function isLoginRateLimited(env, ip) {
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind(`ratelimit:login:${ip}`).first();
  if (!row) return false;
  const { attempts = [] } = JSON.parse(row.value);
  const cutoff = Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS;
  return attempts.filter((ts) => ts > cutoff).length >= LOGIN_RATE_LIMIT_MAX;
}

async function recordLoginFailure(env, ip) {
  const key = `ratelimit:login:${ip}`;
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind(key).first();
  const { attempts = [] } = row ? JSON.parse(row.value) : {};
  const cutoff = Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS;
  const recent = attempts.filter((ts) => ts > cutoff);
  recent.push(Date.now());
  await putValue(env, key, JSON.stringify({ attempts: recent }));
}

async function getUsers(env) {
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE id = ?").bind("users").first();
  return row ? JSON.parse(row.value) : {};
}

async function setUsers(env, users) {
  await putValue(env, "users", JSON.stringify(users));
}

async function putValue(env, id, value) {
  await env.DB.prepare(
    "INSERT INTO app_state (id, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(id, value, new Date().toISOString()).run();
}

const SHARED_STATE_KEY = "state:shared";

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function adminUsernames(env) {
  const rawAdmins = env.ADMIN_USERS || env.ADMIN_USERNAME || (env.APP_PASSWORD ? "sandrine" : "");
  const explicit = String(rawAdmins).split(/[,;\s]+/).map((v) => normalizeUsername(v)).filter(Boolean);
  return new Set(["admin", ...explicit]);
}

function isAdminUser(username, env) {
  return adminUsernames(env).has(normalizeUsername(username));
}

function isProtectedAdminUsername(username, env) {
  return isAdminUser(username, env);
}

function ensureDb(env) {
  if (!env.DB) {
    throw new Error("Binding D1 manquant : ajoutez une liaison nommée DB dans Cloudflare Pages.");
  }
}

async function isAuthenticated(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const cookieValue = match[1];
  const firstDot = cookieValue.indexOf(".");
  const lastDot = cookieValue.lastIndexOf(".");
  if (firstDot < 0 || lastDot <= firstDot) return null;

  const issuedAt = cookieValue.slice(0, firstDot);
  const encodedUsername = cookieValue.slice(firstDot + 1, lastDot);
  const signature = cookieValue.slice(lastDot + 1);
  if (!issuedAt || !encodedUsername || !signature) return null;

  const username = decodeURIComponent(encodedUsername);
  const age = Math.floor(Date.now() / 1000) - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_SECONDS) return null;

  const expected = await signSession(`${issuedAt}.${username}`, env);
  return timingSafeEqual(signature, expected) ? { username } : null;
}

async function signSession(value, env) {
  const secret = String(env.SESSION_SECRET || "change-me");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return hex(signature);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(digest);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function json(payload, headers = {}, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}
