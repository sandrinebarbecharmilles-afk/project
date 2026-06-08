# Agenda Famille — version Cloudflare (Pages + Functions + D1 + Google)

Agenda partagé pour la famille, avec **connexion Google**, **invitations par e-mail**,
et **données partagées** dans les espaces famille (privées dans l'espace perso).

- Front-end statique : `public/` (HTML/CSS/JS, même visuel que les applis SG Créations)
- API (Cloudflare Pages Functions) : `functions/api/...`
- Base de données : **Cloudflare D1**
- Authentification : **Google Identity Services** (jeton vérifié côté serveur)

> 📁 **Où mettre ce dossier ?** Copiez tout le contenu de `cloudflare-agenda/`
> dans votre dossier `Bureau/CLOUDFLARE/agenda`, puis suivez les étapes ci-dessous.
> (Ce dossier est volontairement autonome : il peut devenir son propre dépôt GitHub.)

---

## 1. Prérequis

- Un compte **Cloudflare** et un compte **Google Cloud**.
- **Node.js** installé, puis l'outil Cloudflare :
  ```bash
  npm install -g wrangler
  wrangler login
  ```
- Depuis le dossier `agenda` :
  ```bash
  npm install
  ```

## 2. Créer la base D1

```bash
wrangler d1 create agenda
```
Copiez le `database_id` affiché dans **`wrangler.toml`** (champ `database_id`).

Créez ensuite les tables :
```bash
npm run db:init          # base distante (production)
npm run db:init:local    # base locale (pour le dev)
```

## 3. Configurer la connexion Google

1. Allez sur <https://console.cloud.google.com/apis/credentials>.
2. **Créer des identifiants → ID client OAuth → Application Web**.
3. Dans **Origines JavaScript autorisées**, ajoutez :
   - `http://localhost:8788` (développement)
   - `https://VOTRE-PROJET.pages.dev` (et votre domaine personnalisé si vous en avez un)
4. Copiez le **Client ID** (`...apps.googleusercontent.com`) dans **`wrangler.toml`**
   (`GOOGLE_CLIENT_ID`). Vous pourrez aussi le définir dans le tableau de bord Cloudflare.

> Avec Google Identity Services, **aucun secret client n'est nécessaire** : le jeton
> d'identité est vérifié côté serveur via les clés publiques de Google.

## 4. Définir le secret de session

Une chaîne aléatoire qui sert à signer les cookies de connexion :
```bash
wrangler pages secret put SESSION_SECRET
# collez une longue valeur aléatoire (ex. sortie de :  openssl rand -hex 32)
```
Pour le dev local, créez un fichier **`.dev.vars`** (déjà ignoré par git) :
```
SESSION_SECRET=une_valeur_aleatoire_pour_le_dev
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

## 5. Lancer en local

```bash
npm run dev
```
Ouvrez l'URL affichée (par défaut `http://localhost:8788`).

## 6. Déployer

**Option A — via GitHub (recommandé)**
1. Poussez ce dossier sur un dépôt GitHub.
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**.
3. Sélectionnez le dépôt. Réglages de build :
   - *Build command* : (laisser vide)
   - *Build output directory* : `public`
   - Si le projet n'est pas à la racine du dépôt, indiquez le **dossier racine** `agenda`.
4. Dans **Settings → Functions/Bindings** du projet Pages, ajoutez :
   - **D1 database binding** : nom `DB` → votre base `agenda`.
   - **Variable** : `GOOGLE_CLIENT_ID`.
   - **Secret** : `SESSION_SECRET`.
5. Chaque `git push` redéploie automatiquement.

**Option B — en ligne de commande**
```bash
npm run deploy
```

---

## Comment fonctionnent le partage et la confidentialité

- **Espace perso** : les données vous appartiennent (votre compte). Personne d'autre n'y
  accède, mais elles se synchronisent entre **vos** appareils.
- **Espace famille** : toutes les personnes invitées partagent les **mêmes** données.
- **Invitation** : vous saisissez l'adresse Gmail d'une personne. Elle rejoint
  automatiquement la famille à sa **prochaine connexion Google** (l'adresse est vérifiée
  par Google). Si elle a déjà un compte, l'accès est immédiat.
- **Isolation** : à chaque requête, le serveur vérifie que l'utilisateur a bien accès à
  l'espace demandé. Aucune famille ne voit les données d'une autre.

## Structure du projet

```
agenda/
├─ public/                 # front-end (servi tel quel)
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ functions/api/          # API (Pages Functions)
│  ├─ _middleware.js       # session + protection des routes
│  ├─ config.js            # GET  /api/config
│  ├─ me.js                # GET  /api/me
│  ├─ spaces.js            # POST /api/spaces
│  ├─ auth/google.js       # POST /api/auth/google
│  ├─ auth/logout.js       # POST /api/auth/logout
│  └─ spaces/[id].js       # GET/PUT/PATCH/DELETE /api/spaces/:id
│     ├─ [id]/invite.js            # POST   inviter par e-mail
│     └─ [id]/access/[userId].js   # DELETE retirer un accès
├─ shared/util.js          # helpers (session, vérif. Google) — importés par les functions
├─ schema.sql              # tables D1
├─ wrangler.toml           # config (D1, variables)
└─ package.json
```

## Dépannage

- **Le bouton Google ne s'affiche pas** → vérifiez `GOOGLE_CLIENT_ID` et que l'origine
  (URL du site) figure bien dans les *Origines JavaScript autorisées* côté Google.
- **401 / déconnexion immédiate** → `SESSION_SECRET` n'est pas défini.
- **Erreur D1 / "no such table"** → relancez `npm run db:init`.
- **« conflit » à l'enregistrement** → deux personnes ont modifié en même temps ;
  l'appli recharge automatiquement la dernière version.
