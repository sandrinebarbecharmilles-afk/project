-- =============================================================
--  Agenda Famille — Schéma de la base Cloudflare D1
--  Appliquer avec :
--    wrangler d1 execute agenda --remote --file=./schema.sql
--    wrangler d1 execute agenda --local  --file=./schema.sql   (pour le dev local)
-- =============================================================

-- Utilisateurs identifiés via Google (l'id = "sub" Google)
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  picture    TEXT,
  created_at INTEGER
);

-- Espaces : un agenda perso (privé) ou famille (partagé)
-- Le contenu de l'agenda (membres, évènements, vacances, gardes) est stocké
-- dans la colonne "data" (JSON) — chargé et enregistré en un bloc par espace.
CREATE TABLE IF NOT EXISTS spaces (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,            -- 'perso' | 'famille'
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1, -- pour la détection de conflits (écriture concurrente)
  data          TEXT NOT NULL,            -- JSON {members, events, holidays, custody}
  updated_at    INTEGER
);

-- Qui a accès à quel espace (le partage famille)
CREATE TABLE IF NOT EXISTS space_users (
  space_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'parent', -- 'owner' | 'parent'
  PRIMARY KEY (space_id, user_id)
);

-- Invitations en attente (par adresse Gmail). Consommées à la connexion.
CREATE TABLE IF NOT EXISTS invites (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'parent',
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_space_users_user ON space_users(user_id);
CREATE INDEX IF NOT EXISTS idx_space_users_space ON space_users(space_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_space ON invites(space_id);
