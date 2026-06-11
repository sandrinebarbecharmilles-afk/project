/* =============================================================
   Agenda Famille — SG Créations
   Application 100% client (localStorage). Aucune donnée envoyée
   sur un serveur : tout reste dans le navigateur de l'appareil.
   ============================================================= */
(function () {
  'use strict';

  // ---------- Constantes ----------
  const STORE_KEY = 'sg_agenda_db_v1';
  const SESSION_KEY = 'sg_agenda_session_v1';
  const PALETTE = ['#C4736A', '#5B8A72', '#6A7FB5', '#C9A24B', '#A66BB0', '#4FA3A8', '#D98A5B', '#7E8B96'];
  const HOLIDAY_DEFAULT = '#E0B0A5';
  const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  // ---------- Utilitaires ----------
  const uid = () => Math.random().toString(36).slice(2, 10);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function todayStr() { const d = new Date(); return iso(d); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '')[0] || '?').toUpperCase() + (p[1] ? p[1][0].toUpperCase() : '');
  }
  function hexAlpha(hex, alpha) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex + a : hex;
  }
  function fmtDateLong(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---------- Stockage ----------
  function loadDB() {
    let db;
    try { db = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { db = null; }
    if (!db) {
      db = { spaces: [], users: [], members: [], invites: [], events: [], holidays: [], custody: [] };
    }
    // Compte administrateur (vous) — créé une seule fois
    if (!db.users.some((u) => u.isAdmin)) {
      const sid = uid();
      db.spaces.push({ id: sid, type: 'perso', name: 'Espace de Sandrine', ownerUserId: 'admin' });
      db.users.push({ id: 'admin', name: 'Sandrine', email: 'admin', password: 'admin', isAdmin: true, spaceId: sid });
      db.members.push({ id: uid(), spaceId: sid, name: 'Sandrine', role: 'parent', color: PALETTE[0], linkedUserId: 'admin' });
    }
    return db;
  }
  function saveDB() { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
  function setSession(userId) { if (userId) localStorage.setItem(SESSION_KEY, JSON.stringify({ userId })); else localStorage.removeItem(SESSION_KEY); }

  let DB = loadDB();

  // ---------- État de session / vue ----------
  const now = new Date();
  let state = {
    view: 'agenda',
    cursor: todayStr(),   // date de référence pour les vues jour / semaine / mois
    calView: 'month',     // 'day' | 'week' | 'month'
    filterMember: 'all',
  };

  function currentUser() {
    const s = getSession();
    if (!s) return null;
    return DB.users.find((u) => u.id === s.userId) || null;
  }
  function currentSpace(u) { u = u || currentUser(); return u ? DB.spaces.find((s) => s.id === u.spaceId) : null; }
  function spaceMembers(spaceId) { return DB.members.filter((m) => m.spaceId === spaceId); }
  function spaceUsers(spaceId) { return DB.users.filter((u) => u.spaceId === spaceId); }
  function memberById(id) { return DB.members.find((m) => m.id === id); }
  function memberColor(id) { const m = memberById(id); return m ? m.color : '#9C8478'; }

  // =============================================================
  //  AUTHENTIFICATION
  // =============================================================
  let authMode = 'login'; // 'login' | 'signup'
  let signupType = 'perso'; // 'perso' | 'famille' | 'join'

  function renderAuth(errMsg) {
    const root = $('#app');
    root.innerHTML = `
      <div class="auth">
        <div class="auth-glow g1"></div><div class="auth-glow g2"></div>
        <div class="auth-card">
          <img class="auth-logo" src="logo.png" alt="Agenda" onerror="this.style.display='none'">
          <p class="auth-brand">SG Créations</p>
          <h1>Agenda <em>Famille</em></h1>
          <p class="auth-sub">Organisez le quotidien de toute la famille</p>
          <div class="auth-tabs">
            <button data-act="tab-login" class="${authMode === 'login' ? 'active' : ''}">Connexion</button>
            <button data-act="tab-signup" class="${authMode === 'signup' ? 'active' : ''}">Créer un compte</button>
          </div>
          ${errMsg ? `<p class="form-error">${esc(errMsg)}</p>` : ''}
          ${authMode === 'login' ? loginForm() : signupForm()}
        </div>
      </div>`;
    wireAuth();
  }

  function loginForm() {
    return `
      <form id="login-form">
        <div class="field"><label>E-mail ou identifiant</label><input name="email" autocomplete="username" required></div>
        <div class="field"><label>Mot de passe</label><input name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary btn-block" type="submit">Se connecter</button>
      </form>
      <div class="auth-hint"><strong>Accès administrateur (vous)</strong><br>identifiant : <code>admin</code> — mot de passe : <code>admin</code></div>`;
  }

  function signupForm() {
    return `
      <div class="type-choice">
        <label><input type="radio" name="stype" value="perso" ${signupType === 'perso' ? 'checked' : ''}><span class="tc-inner"><span class="tc-emoji">👤</span>Perso</span></label>
        <label><input type="radio" name="stype" value="famille" ${signupType === 'famille' ? 'checked' : ''}><span class="tc-inner"><span class="tc-emoji">👨‍👩‍👧</span>Famille</span></label>
        <label><input type="radio" name="stype" value="join" ${signupType === 'join' ? 'checked' : ''}><span class="tc-inner"><span class="tc-emoji">🔑</span>Rejoindre</span></label>
      </div>
      <form id="signup-form">
        <div class="field"><label>Votre nom</label><input name="name" required></div>
        ${signupType === 'famille' ? `<div class="field"><label>Nom de la famille</label><input name="familyName" placeholder="Famille Martin" required></div>` : ''}
        ${signupType === 'join' ? `<div class="field"><label>Code d'invitation</label><input name="code" placeholder="ex. AB12CD" required></div>` : ''}
        <div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label>Mot de passe</label><input name="password" type="password" autocomplete="new-password" required></div>
        <button class="btn btn-primary btn-block" type="submit">${signupType === 'join' ? 'Rejoindre la famille' : 'Créer mon compte'}</button>
      </form>
      <div class="auth-hint">
        ${signupType === 'perso' ? 'Un agenda rien que pour vous. Vous pourrez ajouter des personnes à suivre.' : ''}
        ${signupType === 'famille' ? 'Vous créez l\'espace familial et pourrez ensuite inviter les autres parents.' : ''}
        ${signupType === 'join' ? 'Demandez le code d\'invitation au créateur de la famille.' : ''}
      </div>`;
  }

  function wireAuth() {
    $$('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'tab-login') { authMode = 'login'; renderAuth(); }
      if (a === 'tab-signup') { authMode = 'signup'; renderAuth(); }
    }));
    $$('input[name="stype"]').forEach((r) => r.addEventListener('change', (e) => { signupType = e.target.value; renderAuth(); }));

    const lf = $('#login-form');
    if (lf) lf.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(lf);
      const email = String(fd.get('email')).trim().toLowerCase();
      const pwd = String(fd.get('password'));
      const u = DB.users.find((x) => x.email.toLowerCase() === email && x.password === pwd);
      if (!u) return renderAuth('Identifiants incorrects.');
      setSession(u.id); boot();
    });

    const sf = $('#signup-form');
    if (sf) sf.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(sf);
      const name = String(fd.get('name')).trim();
      const email = String(fd.get('email')).trim().toLowerCase();
      const pwd = String(fd.get('password'));
      if (DB.users.some((x) => x.email.toLowerCase() === email)) return renderAuth('Cet e-mail est déjà utilisé.');

      if (signupType === 'join') {
        const code = String(fd.get('code')).trim().toUpperCase();
        const inv = DB.invites.find((i) => i.code === code && !i.used);
        if (!inv) return renderAuth('Code d\'invitation invalide ou déjà utilisé.');
        const userId = uid();
        DB.users.push({ id: userId, name, email, password: pwd, isAdmin: false, spaceId: inv.spaceId });
        const usedColors = spaceMembers(inv.spaceId).map((m) => m.color);
        const color = PALETTE.find((c) => !usedColors.includes(c)) || PALETTE[0];
        DB.members.push({ id: uid(), spaceId: inv.spaceId, name, role: 'parent', color, linkedUserId: userId });
        inv.used = true;
        saveDB(); setSession(userId); boot(); return;
      }

      const spaceId = uid();
      const userId = uid();
      const type = signupType === 'famille' ? 'famille' : 'perso';
      const spaceName = type === 'famille' ? String(fd.get('familyName')).trim() : ('Espace de ' + name);
      DB.spaces.push({ id: spaceId, type, name: spaceName, ownerUserId: userId });
      DB.users.push({ id: userId, name, email, password: pwd, isAdmin: false, spaceId });
      DB.members.push({ id: uid(), spaceId, name, role: 'parent', color: PALETTE[0], linkedUserId: userId });
      saveDB(); setSession(userId); boot();
    });
  }

  // =============================================================
  //  STRUCTURE PRINCIPALE (sidebar + contenu)
  // =============================================================
  const NAV = [
    { id: 'agenda', label: 'Agenda', ico: '📅' },
    { id: 'membres', label: 'Membres', ico: '👥' },
    { id: 'vacances', label: 'Vacances', ico: '🏖️' },
    { id: 'gardes', label: 'Gardes', ico: '🔄' },
    { id: 'import', label: 'Import CSV', ico: '📥' },
  ];

  function renderApp() {
    const u = currentUser();
    const space = currentSpace(u);
    const myMember = DB.members.find((m) => m.linkedUserId === u.id && m.spaceId === space.id);
    const avatarColor = myMember ? myMember.color : PALETTE[0];

    const navHtml = NAV.map((n) => `
      <button class="nav-btn ${state.view === n.id ? 'active' : ''}" data-view="${n.id}">
        <span class="ico">${n.ico}</span><span class="label">${n.label}</span>
      </button>`).join('');

    const adminBtn = u.isAdmin ? `
      <button class="admin-btn ${state.view === 'admin' ? 'active' : ''}" data-view="admin">
        <span class="ico">🛡️</span><span class="label">Administration</span>
      </button>` : '';

    $('#app').innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-head">
            <div class="head-brand">
              <img class="brand-logo" src="logo.png" alt="" onerror="this.style.display='none'">
              <div>
                <p class="sidebar-brand">SG Créations</p>
                <p class="sidebar-title">Agenda <em>Famille</em></p>
              </div>
            </div>
            <div class="sidebar-space">
              <span class="badge">${space.type === 'famille' ? 'Famille' : 'Perso'}</span>
              <span>${esc(space.name)}</span>
            </div>
          </div>
          <nav class="nav">${navHtml}</nav>
          <div class="sidebar-foot">
            ${adminBtn}
            <div class="connbox">
              <div class="conn-avatar" style="background:${avatarColor}">${initials(u.name)}</div>
              <div class="conn-info">
                <div class="conn-name">${esc(u.name)}</div>
                <div class="conn-role">${u.isAdmin ? 'Administratrice' : (space.type === 'famille' ? 'Membre famille' : 'Compte perso')}</div>
              </div>
              <button class="conn-logout" data-act="logout" title="Se déconnecter">⏻</button>
            </div>
          </div>
        </aside>
        <main class="content" id="content"></main>
      </div>`;

    $$('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; renderApp(); }));
    $('[data-act="logout"]').addEventListener('click', () => { setSession(null); boot(); });

    renderContent(space, u);
  }

  function renderContent(space, u) {
    switch (state.view) {
      case 'agenda': return viewAgenda(space);
      case 'membres': return viewMembres(space);
      case 'vacances': return viewVacances(space);
      case 'gardes': return viewGardes(space);
      case 'import': return viewImport(space);
      case 'admin': return viewAdmin();
    }
  }

  // =============================================================
  //  VUE AGENDA (calendrier)
  // =============================================================
  function spaceEvents(spaceId) { return DB.events.filter((e) => e.spaceId === spaceId); }
  function spaceHolidays(spaceId) { return DB.holidays.filter((h) => h.spaceId === spaceId); }
  function spaceCustody(spaceId) { return DB.custody.filter((c) => c.spaceId === spaceId); }

  function eventsOn(spaceId, dateStr) {
    let evts = spaceEvents(spaceId).filter((e) => e.date === dateStr);
    if (state.filterMember !== 'all') evts = evts.filter((e) => e.memberId === state.filterMember || e.memberId === 'all');
    return evts.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }
  function holidaysOn(spaceId, dateStr) { return spaceHolidays(spaceId).filter((h) => dateStr >= h.start && dateStr <= h.end); }
  function custodyOn(spaceId, dateStr) {
    let c = spaceCustody(spaceId).filter((x) => dateStr >= x.start && dateStr <= x.end);
    if (state.filterMember !== 'all') c = c.filter((x) => x.memberId === state.filterMember);
    return c;
  }

  function cursorDate() { return new Date(state.cursor + 'T00:00:00'); }
  function setCursor(d) { state.cursor = iso(d); }
  function weekStart(d) { const x = new Date(d); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function shiftCursor(dir) {
    const d = cursorDate();
    if (state.calView === 'day') d.setDate(d.getDate() + dir);
    else if (state.calView === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  }

  function calLabel() {
    const d = cursorDate();
    if (state.calView === 'day') return cap(fmtDateLong(state.cursor));
    if (state.calView === 'week') {
      const s = weekStart(d); const e = new Date(s); e.setDate(s.getDate() + 6);
      const sameMonth = s.getMonth() === e.getMonth();
      const left = sameMonth ? s.getDate() : `${s.getDate()} ${MONTHS_FR[s.getMonth()]}`;
      return cap(`${left} – ${e.getDate()} ${MONTHS_FR[e.getMonth()]} ${e.getFullYear()}`);
    }
    return cap(`${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`);
  }

  function viewAgenda(space) {
    const members = spaceMembers(space.id);
    const filterOpts = `<option value="all">Tout le monde</option>` +
      members.map((m) => `<option value="${m.id}" ${state.filterMember === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

    $('#content').innerHTML = `
      <div class="page-head">
        <div>
          <h2>Agenda</h2>
          <p class="sub">${esc(space.name)}</p>
        </div>
        <div class="head-actions">
          <select id="member-filter" class="btn btn-ghost" style="padding-right:30px">${filterOpts}</select>
          <button class="btn btn-primary" id="add-evt">+ Évènement</button>
        </div>
      </div>
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button id="prev">‹</button>
          <button id="today-btn" class="btn btn-ghost btn-sm">Aujourd'hui</button>
          <button id="next">›</button>
        </div>
        <div class="cal-month">${calLabel()}</div>
        <div class="view-switch">
          <button data-cv="day" class="${state.calView === 'day' ? 'active' : ''}">Jour</button>
          <button data-cv="week" class="${state.calView === 'week' ? 'active' : ''}">Semaine</button>
          <button data-cv="month" class="${state.calView === 'month' ? 'active' : ''}">Mois</button>
        </div>
      </div>
      <div id="cal-area"></div>
      ${legendHtml(space)}`;

    $('#member-filter').addEventListener('change', (e) => { state.filterMember = e.target.value; viewAgenda(space); });
    $('#add-evt').addEventListener('click', () => openEventModal(space, null, state.cursor));
    $('#prev').addEventListener('click', () => { shiftCursor(-1); viewAgenda(space); });
    $('#next').addEventListener('click', () => { shiftCursor(1); viewAgenda(space); });
    $('#today-btn').addEventListener('click', () => { state.cursor = todayStr(); viewAgenda(space); });
    $$('[data-cv]').forEach((b) => b.addEventListener('click', () => { state.calView = b.dataset.cv; viewAgenda(space); }));

    if (state.calView === 'day') renderDayView(space);
    else if (state.calView === 'week') renderWeekView(space);
    else renderMonthGrid(space);
  }

  function renderMonthGrid(space) {
    const cur = cursorDate(); const curYear = cur.getFullYear(), curMonth = cur.getMonth();
    const first = new Date(curYear, curMonth, 1);
    let offset = (first.getDay() + 6) % 7; // lundi = 0
    const start = new Date(curYear, curMonth, 1 - offset);

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const ds = iso(d);
      const otherMonth = d.getMonth() !== curMonth;
      const isToday = ds === todayStr();
      const evts = eventsOn(space.id, ds);
      const hols = holidaysOn(space.id, ds);
      const cust = custodyOn(space.id, ds);

      let bg = '';
      let holTag = '';
      if (hols.length) {
        bg = `background:${hexAlpha(hols[0].color, 0.18)};`;
        holTag = `<span class="cell-holiday-tag" style="background:${hexAlpha(hols[0].color, 0.9)};color:#fff">${esc(hols[0].name)}</span>`;
      }
      let custStripe = cust.length ? `<span class="cell-custody-stripe" style="background:${memberColor(cust[0].memberId)}" title="Garde : ${esc((memberById(cust[0].memberId) || {}).name || '')}"></span>` : '';

      const shown = evts.slice(0, 3).map((e) => {
        const col = e.memberId === 'all' ? '#9C8478' : memberColor(e.memberId);
        return `<span class="evt" data-evt="${e.id}" style="background:${col}">${e.time ? `<span class="evt-time">${esc(e.time)}</span>` : ''}${esc(e.title)}</span>`;
      }).join('');
      const more = evts.length > 3 ? `<span class="evt-more">+${evts.length - 3} autre(s)</span>` : '';

      cells += `<div class="cal-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-day="${ds}" style="${bg}">
        ${custStripe}${holTag}
        <span class="cell-num">${d.getDate()}</span>
        ${shown}${more}
      </div>`;
    }

    $('#cal-area').innerHTML = `
      <div class="cal-grid">
        <div class="cal-weekdays">${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}</div>
        <div class="cal-days">${cells}</div>
      </div>`;

    $$('.cal-cell').forEach((c) => c.addEventListener('click', (e) => {
      const evtEl = e.target.closest('[data-evt]');
      if (evtEl) { const ev = DB.events.find((x) => x.id === evtEl.dataset.evt); openEventModal(space, ev, ev.date); return; }
      openEventModal(space, null, c.dataset.day);
    }));
  }

  // ---------- Grille horaire partagée (jour / semaine) ----------
  const TG_START = 7, TG_END = 22, TG_ROW = 52; // heures affichées et hauteur d'une heure (px)
  function minutesOf(t) { if (!t) return null; const p = t.split(':'); return (+p[0]) * 60 + (+(p[1] || 0)); }
  function splitEvents(evts) { const timed = [], allday = []; evts.forEach((e) => (e.time ? timed : allday).push(e)); return { timed, allday }; }
  function evColor(e) { return e.memberId === 'all' ? '#9C8478' : memberColor(e.memberId); }

  // Répartit les évènements horodatés en « couloirs » pour gérer les chevauchements
  function layoutDay(timed) {
    const items = timed.map((e) => { const s = minutesOf(e.time); return { e, s, en: s + 60 }; });
    items.sort((a, b) => a.s - b.s || a.en - b.en);
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const lanes = [];
      cluster.forEach((it) => {
        let placed = false;
        for (let i = 0; i < lanes.length; i++) { if (lanes[i] <= it.s) { it.lane = i; lanes[i] = it.en; placed = true; break; } }
        if (!placed) { it.lane = lanes.length; lanes.push(it.en); }
      });
      cluster.forEach((it) => { it.cols = lanes.length; });
      cluster = [];
    };
    items.forEach((it) => {
      if (cluster.length && it.s >= clusterEnd) flush();
      cluster.push(it);
      clusterEnd = cluster.length === 1 ? it.en : Math.max(clusterEnd, it.en);
    });
    flush();
    return items;
  }

  function tgGutter() {
    let h = '';
    for (let x = TG_START; x < TG_END; x++) h += `<div class="tg-hr" style="height:${TG_ROW}px">${String(x).padStart(2, '0')}:00</div>`;
    return `<div class="tg-gutter">${h}</div>`;
  }

  function dayColumnHtml(space, ds) {
    const items = layoutDay(splitEvents(eventsOn(space.id, ds)).timed);
    const blocks = items.map((it) => {
      const top = (it.s - TG_START * 60) / 60 * TG_ROW;
      const height = Math.max(TG_ROW * 0.55, (it.en - it.s) / 60 * TG_ROW - 2);
      const w = 100 / it.cols, left = it.lane * w;
      return `<div class="tg-evt" data-evt="${it.e.id}" style="top:${top}px;height:${height}px;left:${left}%;width:calc(${w}% - 3px);background:${evColor(it.e)}">
        <span class="tg-evt-t">${esc(it.e.time)}</span>${esc(it.e.title)}</div>`;
    }).join('');
    const lineStyle = `height:${(TG_END - TG_START) * TG_ROW}px;background-image:linear-gradient(var(--line-soft) 1px,transparent 1px);background-size:100% ${TG_ROW}px;`;
    return `<div class="tg-col" data-date="${ds}" style="${lineStyle}">${blocks}</div>`;
  }

  function alldayCellHtml(space, ds) {
    return splitEvents(eventsOn(space.id, ds)).allday
      .map((e) => `<span class="tg-ad-chip" data-evt="${e.id}" style="background:${evColor(e)}">${esc(e.title)}</span>`).join('');
  }

  function wireTimeGrid(space) {
    $$('.tg-evt, .tg-ad-chip').forEach((el) => el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const e = DB.events.find((x) => x.id === el.dataset.evt);
      if (e) openEventModal(space, e, e.date);
    }));
    $$('.tg-col').forEach((col) => col.addEventListener('click', (ev) => {
      if (ev.target.closest('.tg-evt')) return;
      const rect = col.getBoundingClientRect();
      let mins = TG_START * 60 + (ev.clientY - rect.top) / TG_ROW * 60;
      mins = Math.max(0, Math.round(mins / 30) * 30);
      const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
      openEventModal(space, null, col.dataset.date, `${hh}:${mm}`);
    }));
    const sc = $('.tg-scroll');
    if (sc) sc.scrollTop = (8 - TG_START) * TG_ROW; // ouvre vers 8h
  }

  function renderDayView(space) {
    const ds = state.cursor;
    const isToday = ds === todayStr();
    const hols = holidaysOn(space.id, ds), cust = custodyOn(space.id, ds);
    const ad = alldayCellHtml(space, ds);
    const tags = hols.map((h) => `<span class="pill" style="background:${h.color}">🏖️ ${esc(h.name)}</span>`).join(' ') +
      cust.map((c) => `<span class="pill" style="background:${memberColor(c.memberId)}">🔄 ${esc((memberById(c.memberId) || {}).name || '')}</span>`).join(' ');

    $('#cal-area').innerHTML = `
      <div class="dayview ${isToday ? 'is-today' : ''}">
        ${tags ? `<div class="day-tags">${tags}</div>` : ''}
        <div class="tg-allday tg-allday-day">
          <span class="tg-ad-lbl">Journée</span>
          <div class="tg-ad-items">${ad || '<span class="tg-ad-empty">—</span>'}</div>
        </div>
        <div class="tg-scroll"><div class="tg-body tg-body-day">${tgGutter()}${dayColumnHtml(space, ds)}</div></div>
      </div>`;
    wireTimeGrid(space);
  }

  function renderWeekView(space) {
    const s = weekStart(cursorDate());
    const dates = [];
    for (let i = 0; i < 7; i++) { const d = new Date(s); d.setDate(s.getDate() + i); dates.push(iso(d)); }

    const heads = dates.map((ds) => {
      const d = new Date(ds + 'T00:00:00');
      const isToday = ds === todayStr();
      const hols = holidaysOn(space.id, ds), cust = custodyOn(space.id, ds);
      const bg = hols.length ? `background:${hexAlpha(hols[0].color, 0.25)};` : '';
      const dot = cust.length ? `<span class="wh-dot" style="background:${memberColor(cust[0].memberId)}" title="Garde"></span>` : '';
      return `<div class="wh-cell ${isToday ? 'today' : ''}" style="${bg}">
        <div class="wh-day">${WEEKDAYS[(d.getDay() + 6) % 7]}</div>
        <div class="wh-num">${d.getDate()}</div>${dot}</div>`;
    }).join('');

    const alldayCells = dates.map((ds) => `<div class="tg-ad-cell" data-date="${ds}">${alldayCellHtml(space, ds)}</div>`).join('');
    const cols = dates.map((ds) => dayColumnHtml(space, ds)).join('');

    $('#cal-area').innerHTML = `
      <div class="weekview">
        <div class="week-inner">
          <div class="week-head"><div class="wh-gutter"></div>${heads}</div>
          <div class="tg-allday tg-allday-week"><span class="tg-ad-lbl">Jour.</span>${alldayCells}</div>
          <div class="tg-scroll"><div class="tg-body tg-body-week">${tgGutter()}${cols}</div></div>
        </div>
      </div>`;
    wireTimeGrid(space);
    $$('.tg-ad-cell').forEach((cell) => cell.addEventListener('click', (ev) => {
      if (ev.target.closest('.tg-ad-chip')) return;
      openEventModal(space, null, cell.dataset.date);
    }));
  }

  function legendHtml(space) {
    const members = spaceMembers(space.id);
    const memDots = members.map((m) => `<span class="legend-item"><span class="legend-dot" style="background:${m.color}"></span>${esc(m.name)}</span>`).join('');
    const hols = spaceHolidays(space.id);
    const holDots = hols.length ? `<div class="legend-group"><span class="legend-title">Vacances</span>${hols.map((h) => `<span class="legend-item"><span class="legend-dot" style="background:${h.color}"></span>${esc(h.name)}</span>`).join('')}</div>` : '';
    return `<div class="legend">
      <div class="legend-group"><span class="legend-title">Membres</span>${memDots}<span class="legend-item"><span class="legend-dot" style="background:#9C8478"></span>Toute la famille</span></div>
      ${holDots}
    </div>`;
  }

  // ---------- Modale évènement ----------
  function openEventModal(space, evt, defaultDate, defaultTime) {
    const members = spaceMembers(space.id);
    const isEdit = !!evt;
    const memberOpts = `<option value="all">Toute la famille</option>` +
      members.map((m) => `<option value="${m.id}" ${evt && evt.memberId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    const types = ['Médical', 'École', 'Activité', 'Rendez-vous', 'Anniversaire', 'Autre'];
    const typeOpts = types.map((t) => `<option ${evt && evt.type === t ? 'selected' : ''}>${t}</option>`).join('');

    openModal(`
      <div class="modal-head"><h3>${isEdit ? 'Modifier' : 'Nouvel'} évènement</h3><button class="modal-close" data-close>✕</button></div>
      <form id="evt-form" class="modal-body">
        <div class="field"><label>Titre</label><input name="title" value="${evt ? esc(evt.title) : ''}" placeholder="ex. Rendez-vous dentiste" required></div>
        <div class="field-row">
          <div class="field"><label>Date</label><input name="date" type="date" value="${evt ? evt.date : defaultDate}" required></div>
          <div class="field"><label>Heure</label><input name="time" type="time" value="${evt && evt.time ? evt.time : (defaultTime || '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Pour qui ?</label><select name="memberId">${memberOpts}</select></div>
          <div class="field"><label>Catégorie</label><select name="type">${typeOpts}</select></div>
        </div>
        <div class="field"><label>Note (facultatif)</label><textarea name="note" rows="2" placeholder="Précisions…">${evt && evt.note ? esc(evt.note) : ''}</textarea></div>
      </form>
      <div class="modal-foot">
        ${isEdit ? '<button class="btn btn-danger btn-sm" data-del>Supprimer</button>' : ''}
        <button class="btn btn-ghost" data-close>Annuler</button>
        <button class="btn btn-primary" id="evt-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
      </div>`);

    $('#evt-save').addEventListener('click', () => {
      const f = $('#evt-form'); const fd = new FormData(f);
      const title = String(fd.get('title')).trim();
      if (!title) return;
      const data = { title, date: fd.get('date'), time: fd.get('time'), memberId: fd.get('memberId'), type: fd.get('type'), note: String(fd.get('note') || '').trim() };
      if (isEdit) Object.assign(evt, data);
      else DB.events.push(Object.assign({ id: uid(), spaceId: space.id }, data));
      saveDB(); closeModal(); viewAgenda(space);
    });
    if (isEdit) $('[data-del]').addEventListener('click', () => {
      DB.events = DB.events.filter((e) => e.id !== evt.id); saveDB(); closeModal(); viewAgenda(space);
    });
  }

  // =============================================================
  //  VUE MEMBRES
  // =============================================================
  function viewMembres(space) {
    const members = spaceMembers(space.id);
    const users = spaceUsers(space.id);
    const isFamily = space.type === 'famille';

    const cards = members.map((m) => {
      const linkedUser = m.linkedUserId ? DB.users.find((u) => u.id === m.linkedUserId) : null;
      return `<div class="card">
        <div class="card-top">
          <div class="member-avatar" style="background:${m.color}">${initials(m.name)}</div>
          <div><div class="card-name">${esc(m.name)}</div><div class="card-tag">${m.role === 'parent' ? 'Parent' : 'Enfant'}${linkedUser ? ' · utilisateur' : ''}</div></div>
        </div>
        <div class="card-row"><span>Couleur</span><span class="legend-dot" style="width:18px;height:18px;background:${m.color}"></span></div>
        <div class="card-row"><span>Compte</span><span>${linkedUser ? esc(linkedUser.email) : '<em>sans accès</em>'}</span></div>
        <div class="card-actions">
          <button class="icon-btn" data-edit="${m.id}">✎ Modifier</button>
          ${m.linkedUserId === currentUser().id ? '' : `<button class="icon-btn" data-delm="${m.id}">🗑 Retirer</button>`}
        </div>
      </div>`;
    }).join('');

    $('#content').innerHTML = `
      <div class="page-head">
        <div><h2>Membres</h2><p class="sub">Parents, enfants et couleurs</p></div>
        <div class="head-actions">
          ${isFamily ? '<button class="btn btn-ghost" id="invite">✉ Inviter</button>' : ''}
          <button class="btn btn-primary" id="add-member">+ Ajouter une personne</button>
        </div>
      </div>
      ${!isFamily ? '<div class="info-box">Vous êtes sur un <strong>compte perso</strong>. Vous pouvez ajouter des personnes à suivre, mais seul un <strong>compte famille</strong> permet d\'inviter d\'autres utilisateurs.</div>' : ''}
      <div class="cards">${cards}</div>`;

    $('#add-member').addEventListener('click', () => openMemberModal(space, null));
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openMemberModal(space, memberById(b.dataset.edit))));
    $$('[data-delm]').forEach((b) => b.addEventListener('click', () => {
      const m = memberById(b.dataset.delm);
      if (!confirm('Retirer ' + m.name + ' ? Ses évènements seront aussi supprimés.')) return;
      DB.members = DB.members.filter((x) => x.id !== m.id);
      DB.events = DB.events.filter((e) => e.memberId !== m.id);
      DB.custody = DB.custody.filter((c) => c.memberId !== m.id);
      if (m.linkedUserId && m.linkedUserId !== space.ownerUserId) DB.users = DB.users.filter((u) => u.id !== m.linkedUserId);
      saveDB(); viewMembres(space);
    }));
    if (isFamily) $('#invite').addEventListener('click', () => openInviteModal(space));
  }

  function colorPicker(selected) {
    return `<div class="color-grid">${PALETTE.map((c) => `<div class="color-swatch ${c === selected ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>`;
  }

  function openMemberModal(space, m) {
    const isEdit = !!m;
    const used = spaceMembers(space.id).map((x) => x.color);
    let selColor = m ? m.color : (PALETTE.find((c) => !used.includes(c)) || PALETTE[0]);
    openModal(`
      <div class="modal-head"><h3>${isEdit ? 'Modifier' : 'Ajouter'} une personne</h3><button class="modal-close" data-close>✕</button></div>
      <form id="m-form" class="modal-body">
        <div class="field"><label>Nom</label><input name="name" value="${m ? esc(m.name) : ''}" required></div>
        <div class="field"><label>Rôle</label>
          <select name="role">
            <option value="parent" ${m && m.role === 'parent' ? 'selected' : ''}>Parent</option>
            <option value="enfant" ${m && m.role === 'enfant' ? 'selected' : ''}>Enfant</option>
          </select>
        </div>
        <div class="field"><label>Code couleur</label>${colorPicker(selColor)}</div>
      </form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="m-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button></div>`);

    $$('.color-swatch').forEach((s) => s.addEventListener('click', () => {
      selColor = s.dataset.color; $$('.color-swatch').forEach((x) => x.classList.remove('selected')); s.classList.add('selected');
    }));
    $('#m-save').addEventListener('click', () => {
      const fd = new FormData($('#m-form'));
      const name = String(fd.get('name')).trim(); if (!name) return;
      if (isEdit) { m.name = name; m.role = fd.get('role'); m.color = selColor; }
      else DB.members.push({ id: uid(), spaceId: space.id, name, role: fd.get('role'), color: selColor });
      saveDB(); closeModal(); viewMembres(space);
    });
  }

  function openInviteModal(space) {
    const code = uid().slice(0, 6).toUpperCase();
    DB.invites.push({ id: uid(), spaceId: space.id, code, role: 'parent', used: false });
    saveDB();
    openModal(`
      <div class="modal-head"><h3>Inviter un parent</h3><button class="modal-close" data-close>✕</button></div>
      <div class="modal-body">
        <p style="color:var(--ink-soft);font-size:.88rem">Transmettez ce code à la personne. Elle choisira « Rejoindre » à la création de son compte.</p>
        <div class="code-box">${code}</div>
        <div class="info-box">L'invitation rejoint l'espace <strong>${esc(space.name)}</strong> en tant que parent. Le code est valable pour une seule inscription.</div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" data-close>Compris</button></div>`);
  }

  // =============================================================
  //  VUE VACANCES SCOLAIRES
  // =============================================================
  function viewVacances(space) {
    const hols = spaceHolidays(space.id).slice().sort((a, b) => a.start.localeCompare(b.start));
    const rows = hols.map((h) => `
      <div class="card">
        <div class="card-top">
          <div class="member-avatar" style="background:${h.color};font-size:1.3rem">🏖️</div>
          <div><div class="card-name">${esc(h.name)}</div><div class="card-tag">${fmtDateLong(h.start)} → ${fmtDateLong(h.end)}</div></div>
        </div>
        <div class="card-actions"><button class="icon-btn" data-edith="${h.id}">✎ Modifier</button><button class="icon-btn" data-delh="${h.id}">🗑 Supprimer</button></div>
      </div>`).join('');

    $('#content').innerHTML = `
      <div class="page-head"><div><h2>Vacances scolaires</h2><p class="sub">Périodes mises en couleur dans l'agenda</p></div>
        <button class="btn btn-primary" id="add-hol">+ Ajouter une période</button></div>
      ${hols.length ? `<div class="cards">${rows}</div>` : '<div class="empty"><span class="emoji">🏖️</span><p>Aucune période de vacances enregistrée.</p><button class="btn btn-primary" id="empty-hol">+ Ajouter</button></div>'}`;

    const add = () => openHolidayModal(space, null);
    if ($('#add-hol')) $('#add-hol').addEventListener('click', add);
    if ($('#empty-hol')) $('#empty-hol').addEventListener('click', add);
    $$('[data-edith]').forEach((b) => b.addEventListener('click', () => openHolidayModal(space, DB.holidays.find((h) => h.id === b.dataset.edith))));
    $$('[data-delh]').forEach((b) => b.addEventListener('click', () => { DB.holidays = DB.holidays.filter((h) => h.id !== b.dataset.delh); saveDB(); viewVacances(space); }));
  }

  function openHolidayModal(space, h) {
    const isEdit = !!h; let selColor = h ? h.color : HOLIDAY_DEFAULT;
    openModal(`
      <div class="modal-head"><h3>${isEdit ? 'Modifier' : 'Ajouter'} des vacances</h3><button class="modal-close" data-close>✕</button></div>
      <form id="h-form" class="modal-body">
        <div class="field"><label>Nom</label><input name="name" value="${h ? esc(h.name) : ''}" placeholder="ex. Vacances de Pâques" required></div>
        <div class="field-row">
          <div class="field"><label>Du</label><input name="start" type="date" value="${h ? h.start : todayStr()}" required></div>
          <div class="field"><label>Au</label><input name="end" type="date" value="${h ? h.end : todayStr()}" required></div>
        </div>
        <div class="field"><label>Code couleur</label>${colorPicker(selColor)}</div>
      </form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="h-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button></div>`);
    $$('.color-swatch').forEach((s) => s.addEventListener('click', () => { selColor = s.dataset.color; $$('.color-swatch').forEach((x) => x.classList.remove('selected')); s.classList.add('selected'); }));
    $('#h-save').addEventListener('click', () => {
      const fd = new FormData($('#h-form'));
      const name = String(fd.get('name')).trim(); let start = fd.get('start'), end = fd.get('end');
      if (!name) return; if (end < start) { const t = start; start = end; end = t; }
      if (isEdit) Object.assign(h, { name, start, end, color: selColor });
      else DB.holidays.push({ id: uid(), spaceId: space.id, name, start, end, color: selColor });
      saveDB(); closeModal(); viewVacances(space);
    });
  }

  // =============================================================
  //  VUE GARDES PARTAGÉES
  // =============================================================
  function viewGardes(space) {
    const cust = spaceCustody(space.id).slice().sort((a, b) => a.start.localeCompare(b.start));
    const parents = spaceMembers(space.id);
    const rows = cust.map((c) => {
      const m = memberById(c.memberId) || {};
      return `<div class="card">
        <div class="card-top">
          <div class="member-avatar" style="background:${m.color || '#9C8478'}">${initials(m.name)}</div>
          <div><div class="card-name">${esc(c.label || ('Garde · ' + (m.name || '')))}</div><div class="card-tag">${fmtDateLong(c.start)} → ${fmtDateLong(c.end)}</div></div>
        </div>
        <div class="card-row"><span>Chez</span><span class="pill" style="background:${m.color || '#9C8478'}">${esc(m.name || '—')}</span></div>
        <div class="card-actions"><button class="icon-btn" data-editc="${c.id}">✎ Modifier</button><button class="icon-btn" data-delc="${c.id}">🗑 Supprimer</button></div>
      </div>`;
    }).join('');

    $('#content').innerHTML = `
      <div class="page-head"><div><h2>Gardes partagées</h2><p class="sub">Périodes de garde repérées par couleur dans l'agenda</p></div>
        <button class="btn btn-primary" id="add-c" ${parents.length ? '' : 'disabled'}>+ Ajouter une garde</button></div>
      ${cust.length ? `<div class="cards">${rows}</div>` : '<div class="empty"><span class="emoji">🔄</span><p>Aucune garde enregistrée.</p><button class="btn btn-primary" id="empty-c">+ Ajouter</button></div>'}`;

    const add = () => openCustodyModal(space, null);
    if ($('#add-c')) $('#add-c').addEventListener('click', add);
    if ($('#empty-c')) $('#empty-c').addEventListener('click', add);
    $$('[data-editc]').forEach((b) => b.addEventListener('click', () => openCustodyModal(space, DB.custody.find((c) => c.id === b.dataset.editc))));
    $$('[data-delc]').forEach((b) => b.addEventListener('click', () => { DB.custody = DB.custody.filter((c) => c.id !== b.dataset.delc); saveDB(); viewGardes(space); }));
  }

  function openCustodyModal(space, c) {
    const isEdit = !!c;
    const members = spaceMembers(space.id);
    const opts = members.map((m) => `<option value="${m.id}" ${c && c.memberId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    openModal(`
      <div class="modal-head"><h3>${isEdit ? 'Modifier' : 'Ajouter'} une garde</h3><button class="modal-close" data-close>✕</button></div>
      <form id="c-form" class="modal-body">
        <div class="field"><label>Chez qui ? (couleur reprise)</label><select name="memberId">${opts}</select></div>
        <div class="field"><label>Libellé (facultatif)</label><input name="label" value="${c ? esc(c.label || '') : ''}" placeholder="ex. Semaine paire"></div>
        <div class="field-row">
          <div class="field"><label>Du</label><input name="start" type="date" value="${c ? c.start : todayStr()}" required></div>
          <div class="field"><label>Au</label><input name="end" type="date" value="${c ? c.end : todayStr()}" required></div>
        </div>
      </form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="c-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button></div>`);
    $('#c-save').addEventListener('click', () => {
      const fd = new FormData($('#c-form'));
      let start = fd.get('start'), end = fd.get('end'); if (end < start) { const t = start; start = end; end = t; }
      const data = { memberId: fd.get('memberId'), label: String(fd.get('label') || '').trim(), start, end };
      if (isEdit) Object.assign(c, data);
      else DB.custody.push(Object.assign({ id: uid(), spaceId: space.id }, data));
      saveDB(); closeModal(); viewGardes(space);
    });
  }

  // =============================================================
  //  VUE IMPORT CSV
  // =============================================================
  let csvParsed = null;
  function viewImport(space) {
    csvParsed = null;
    $('#content').innerHTML = `
      <div class="page-head"><div><h2>Import CSV / Excel</h2><p class="sub">Ajoutez plusieurs évènements d'un coup</p></div></div>
      <div class="info-box">
        Le fichier (<strong>.csv</strong> ou <strong>.xlsx</strong>) doit être un tableau « une ligne = un évènement », avec une <strong>ligne d'en-tête</strong>. Colonnes reconnues (français ou anglais) :
        <strong>date</strong>, <strong>titre/title</strong>, <strong>heure/time</strong>, <strong>personne/membre</strong>, <strong>type</strong>, <strong>note</strong>.<br>
        Dates acceptées : <code>2026-09-15</code> ou <code>15/09/2026</code>. Pour Excel, la <strong>première feuille</strong> est utilisée.
        <br><a href="#" id="dl-sample" style="color:var(--rose-dk);font-weight:600">⬇ Télécharger un modèle</a>
      </div>
      <div class="drop-zone" id="drop"><span class="emoji">📥</span><strong>Cliquez ou glissez votre fichier .csv ou .xlsx ici</strong><br><span style="font-size:.82rem">Aperçu avant validation</span></div>
      <input type="file" id="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      <div id="import-result"></div>`;

    const fileInput = $('#file'); const drop = $('#drop');
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], space); });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0], space); });
    $('#dl-sample').addEventListener('click', (e) => { e.preventDefault(); downloadSample(); });
  }

  function downloadSample() {
    const csv = 'date,titre,heure,personne,type,note\n2026-09-15,Examen médical,09:30,Enfant 1,Médical,Bilan annuel\n2026-09-18,Rendez-vous dentiste,14:00,Papa,Médical,\n2026-09-22,Réunion parents,18:30,Toute la famille,École,\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'modele-agenda.csv'; a.click();
  }

  function detectDelim(line) { return (line.split(';').length > line.split(',').length) ? ';' : ','; }
  function parseCSVLine(line, delim) {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; }
      else { if (ch === '"') inQ = true; else if (ch === delim) { out.push(cur); cur = ''; } else cur += ch; }
    }
    out.push(cur); return out.map((s) => s.trim());
  }
  function normDate(v) {
    v = String(v).trim();
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return v;
    m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return null;
  }

  function handleFile(file, space) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return handleXlsx(file, space);
    const reader = new FileReader();
    reader.onload = () => previewFromRows(rowsFromCsv(reader.result), space);
    reader.readAsText(file, 'utf-8');
  }

  function rowsFromCsv(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    if (!lines.length) return [];
    const delim = detectDelim(lines[0]);
    return lines.map((l) => parseCSVLine(l, delim));
  }

  // Lecteur Excel : SheetJS chargé à la demande depuis le CDN
  let XLSX_LOADING = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (XLSX_LOADING) return XLSX_LOADING;
    XLSX_LOADING = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('cdn'));
      document.head.appendChild(s);
    });
    return XLSX_LOADING;
  }
  function handleXlsx(file, space) {
    const out = $('#import-result');
    out.innerHTML = '<p class="le-meta">Lecture du fichier Excel…</p>';
    loadXLSX().then((XLSX) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
          previewFromRows(raw.map((r) => r.map((c) => String(c == null ? '' : c))), space);
        } catch (e) { out.innerHTML = '<p class="form-error">Impossible de lire ce fichier Excel.</p>'; }
      };
      reader.readAsArrayBuffer(file);
    }).catch(() => { out.innerHTML = '<p class="form-error">Impossible de charger le lecteur Excel (vérifiez votre connexion internet).</p>'; });
  }

  function previewFromRows(allRows, space) {
    const rows0 = allRows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (rows0.length < 2) { $('#import-result').innerHTML = '<p class="form-error">Fichier vide ou sans tableau exploitable (il faut une ligne d\'en-tête + des lignes de données).</p>'; return; }
    const headers = rows0[0].map((h) => String(h).toLowerCase().trim());
    const idx = (names) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return -1; };
    const iDate = idx(['date']);
    const iTitle = idx(['titre', 'title', 'évènement', 'evenement', 'event']);
    const iTime = idx(['heure', 'time', 'horaire']);
    const iMember = idx(['personne', 'membre', 'member', 'person', 'qui']);
    const iType = idx(['type', 'catégorie', 'categorie', 'category']);
    const iNote = idx(['note', 'notes', 'remarque', 'description']);
    if (iDate < 0 || iTitle < 0) {
      $('#import-result').innerHTML = '<p class="form-error">Colonnes <strong>date</strong> et <strong>titre</strong> introuvables dans la 1<sup>re</sup> ligne. Le fichier doit être un tableau « une ligne = un évènement » (pas un calendrier en grille).</p>';
      return;
    }

    const members = spaceMembers(space.id);
    const matchMember = (name) => {
      if (!name) return 'all';
      const n = String(name).trim().toLowerCase();
      if (['toute la famille', 'famille', 'tous', 'all'].includes(n)) return 'all';
      const m = members.find((x) => x.name.toLowerCase() === n);
      return m ? m.id : 'all';
    };

    const rows = []; const errors = [];
    for (let i = 1; i < rows0.length; i++) {
      const cols = rows0[i];
      const date = normDate(cols[iDate]);
      const title = String(cols[iTitle] || '').trim();
      if (!date || !title) { errors.push(`Ligne ${i + 1} ignorée (date ou titre manquant).`); continue; }
      const memberName = iMember >= 0 ? cols[iMember] : '';
      rows.push({
        id: uid(), spaceId: space.id, date, title,
        time: iTime >= 0 ? String(cols[iTime] || '').trim() : '',
        memberId: matchMember(memberName), _memberName: memberName,
        type: iType >= 0 ? String(cols[iType] || '').trim() : '',
        note: iNote >= 0 ? String(cols[iNote] || '').trim() : '',
      });
    }
    csvParsed = rows;

    if (!rows.length) { $('#import-result').innerHTML = `<p class="form-error">Aucune ligne valide.</p>${errors.map((e) => `<p class="le-meta">${esc(e)}</p>`).join('')}`; return; }

    const preview = rows.slice(0, 50).map((r) => {
      const m = r.memberId === 'all' ? 'Toute la famille' : (memberById(r.memberId) || {}).name;
      const warn = (r._memberName && r.memberId === 'all' && !['toute la famille', 'famille', 'tous', 'all', ''].includes(String(r._memberName).toLowerCase())) ? ` <span style="color:#b5483f" title="Nom non reconnu, assigné à toute la famille">⚠</span>` : '';
      return `<tr><td>${esc(r.date)}</td><td>${esc(r.title)}</td><td>${esc(r.time)}</td><td>${esc(m)}${warn}</td><td>${esc(r.type)}</td></tr>`;
    }).join('');

    $('#import-result').innerHTML = `
      <div class="info-box"><strong>${rows.length}</strong> évènement(s) prêt(s) à être importé(s).${errors.length ? ` ${errors.length} ligne(s) ignorée(s).` : ''} Le ⚠ signale un nom non reconnu (assigné à « Toute la famille »).</div>
      <div class="preview-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Titre</th><th>Heure</th><th>Pour qui</th><th>Type</th></tr></thead><tbody>${preview}</tbody></table></div>
      <div class="head-actions" style="margin-top:16px"><button class="btn btn-primary" id="do-import">✓ Importer ${rows.length} évènement(s)</button><button class="btn btn-ghost" id="cancel-import">Annuler</button></div>`;

    $('#do-import').addEventListener('click', () => {
      csvParsed.forEach((r) => { delete r._memberName; DB.events.push(r); });
      saveDB();
      $('#import-result').innerHTML = `<div class="info-box" style="background:rgba(91,138,114,.1);border-color:rgba(91,138,114,.4)">✓ ${csvParsed.length} évènement(s) importé(s) dans l'agenda.</div>`;
      csvParsed = null;
    });
    $('#cancel-import').addEventListener('click', () => viewImport(space));
  }

  // =============================================================
  //  VUE ADMINISTRATION (réservée à l'admin)
  // =============================================================
  function viewAdmin() {
    const spaceRows = DB.spaces.map((s) => {
      const mem = spaceMembers(s.id).length, usr = spaceUsers(s.id).length, evt = spaceEvents(s.id).length;
      const owner = DB.users.find((u) => u.id === s.ownerUserId);
      return `<tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td><span class="pill" style="background:${s.type === 'famille' ? 'var(--rose)' : 'var(--brown)'}">${s.type}</span></td>
        <td>${owner ? esc(owner.name) : '—'}</td>
        <td>${usr}</td><td>${mem}</td><td>${evt}</td>
        <td><button class="icon-btn" data-dels="${s.id}">🗑</button></td>
      </tr>`;
    }).join('');
    const userRows = DB.users.map((u) => {
      const sp = DB.spaces.find((s) => s.id === u.spaceId);
      return `<tr><td>${esc(u.name)}${u.isAdmin ? ' 🛡️' : ''}</td><td>${esc(u.email)}</td><td>${sp ? esc(sp.name) : '—'}</td></tr>`;
    }).join('');

    $('#content').innerHTML = `
      <div class="page-head"><div><h2>Administration</h2><p class="sub">Vue d'ensemble — réservée à l'administratrice</p></div>
        <button class="btn btn-danger btn-sm" id="reset-all">⚠ Réinitialiser toutes les données</button></div>
      <div class="info-box">Espace technique. Les données sont stockées localement dans ce navigateur (localStorage).</div>
      <h3 style="margin:18px 0 10px;font-size:1.1rem">Espaces (${DB.spaces.length})</h3>
      <table class="tbl"><thead><tr><th>Nom</th><th>Type</th><th>Propriétaire</th><th>Utilisateurs</th><th>Membres</th><th>Évènements</th><th></th></tr></thead><tbody>${spaceRows}</tbody></table>
      <h3 style="margin:24px 0 10px;font-size:1.1rem">Utilisateurs (${DB.users.length})</h3>
      <table class="tbl"><thead><tr><th>Nom</th><th>E-mail</th><th>Espace</th></tr></thead><tbody>${userRows}</tbody></table>`;

    $$('[data-dels]').forEach((b) => b.addEventListener('click', () => {
      const sid = b.dataset.dels;
      const sp = DB.spaces.find((s) => s.id === sid);
      if (sp && sp.ownerUserId === currentUser().id) { alert('Vous ne pouvez pas supprimer votre propre espace ici.'); return; }
      if (!confirm('Supprimer l\'espace « ' + sp.name + ' » et toutes ses données ?')) return;
      DB.spaces = DB.spaces.filter((s) => s.id !== sid);
      DB.users = DB.users.filter((u) => u.spaceId !== sid || u.isAdmin);
      DB.members = DB.members.filter((m) => m.spaceId !== sid);
      DB.events = DB.events.filter((e) => e.spaceId !== sid);
      DB.holidays = DB.holidays.filter((h) => h.spaceId !== sid);
      DB.custody = DB.custody.filter((c) => c.spaceId !== sid);
      DB.invites = DB.invites.filter((i) => i.spaceId !== sid);
      saveDB(); viewAdmin();
    }));
    $('#reset-all').addEventListener('click', () => {
      if (!confirm('Effacer TOUTES les données de l\'application ? Cette action est irréversible.')) return;
      localStorage.removeItem(STORE_KEY); localStorage.removeItem(SESSION_KEY);
      DB = loadDB(); boot();
    });
  }

  // =============================================================
  //  MODALES (helpers)
  // =============================================================
  function openModal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`;
    $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
    root.querySelector('.modal-overlay').addEventListener('click', (e) => { if (e.target.classList.contains('modal-overlay')) closeModal(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  // =============================================================
  //  DÉMARRAGE
  // =============================================================
  function boot() {
    DB = loadDB();
    if (currentUser()) { state.view = state.view || 'agenda'; renderApp(); }
    else renderAuth();
  }

  boot();
})();
