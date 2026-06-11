/* =============================================================
   Agenda Famille — version Cloudflare (API + D1 + connexion Google)
   Les données d'un espace sont chargées/enregistrées en bloc via l'API.
   - Espace perso  : privé (vous seule).
   - Espace famille: partagé entre tous les membres invités.
   ============================================================= */
(function () {
  'use strict';

  // ---------- Constantes ----------
  const PALETTE = ['#C4736A', '#5B8A72', '#6A7FB5', '#C9A24B', '#A66BB0', '#4FA3A8', '#D98A5B', '#7E8B96'];
  const HOLIDAY_DEFAULT = '#E0B0A5';
  const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  // ---------- Utilitaires ----------
  const uid = () => Math.random().toString(36).slice(2, 10);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => iso(new Date());
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '')[0] || '?').toUpperCase() + (p[1] ? p[1][0].toUpperCase() : ''); }
  function hexAlpha(hex, a) { const h = Math.round(a * 255).toString(16).padStart(2, '0'); return /^#[0-9a-f]{6}$/i.test(hex) ? hex + h : hex; }
  function fmtDateLong(ds) { return new Date(ds + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }

  // ---------- État global ----------
  let GOOGLE_CLIENT_ID = '';
  let ME = null;     // { user:{id,email,name,picture}, spaces:[{id,type,name,ownerUserId,role}] }
  let SPACE = null;  // espace courant { id,type,name,ownerUserId,version,role }
  let DB = { members: [], events: [], holidays: [], custody: [], access: [], invites: [] };
  let state = { view: 'agenda', cursor: todayStr(), calView: 'month', filterMember: 'all' };

  // ---------- Client API ----------
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      if (ME) { ME = null; renderAuth('Session expirée. Reconnectez-vous.'); }
      throw { status: 401 };
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { status: res.status, data });
    return data;
  }

  // Accès aux données de l'espace courant (le cache ne contient que l'espace actif)
  function spaceMembers() { return DB.members; }
  function spaceEvents() { return DB.events; }
  function spaceHolidays() { return DB.holidays; }
  function spaceCustody() { return DB.custody; }
  function memberById(id) { return DB.members.find((m) => m.id === id); }
  function memberColor(id) { const m = memberById(id); return m ? m.color : '#9C8478'; }
  function currentUser() { return ME ? ME.user : null; }

  // ---------- Enregistrement (PUT du contenu, anti-conflit + coalescence) ----------
  let saving = false, dirty = false;
  function saveDB() { pushState(); }
  async function pushState() {
    if (saving) { dirty = true; return; }
    saving = true;
    try {
      do {
        dirty = false;
        const payload = { version: SPACE.version, data: { members: DB.members, events: DB.events, holidays: DB.holidays, custody: DB.custody } };
        const r = await api('PUT', '/api/spaces/' + SPACE.id, payload);
        SPACE.version = r.version;
      } while (dirty);
    } catch (e) {
      if (e.status === 409) {
        alert('Les données ont été modifiées par une autre personne. Rechargement pour récupérer la dernière version.');
        await loadSpace(SPACE.id);
      } else if (e.status !== 401) {
        alert("Erreur lors de l'enregistrement. Vérifiez votre connexion.");
      }
    } finally {
      saving = false;
    }
  }

  // =============================================================
  //  AUTHENTIFICATION GOOGLE
  // =============================================================
  function renderAuth(errMsg) {
    $('#app').innerHTML = `
      <div class="auth">
        <div class="auth-glow g1"></div><div class="auth-glow g2"></div>
        <div class="auth-card">
          <img class="auth-logo" src="logo.png" alt="Agenda" onerror="this.style.display='none'">
          <p class="auth-brand">SG Créations</p>
          <h1>Agenda <em>Famille</em></h1>
          <p class="auth-sub">Connectez-vous avec votre compte Google</p>
          ${errMsg ? `<p class="form-error" style="text-align:center">${esc(errMsg)}</p>` : ''}
          <div class="gbtn-wrap"><div id="gbtn"></div></div>
          <div id="auth-status" class="auth-loading">Chargement…</div>
          <div class="auth-hint">Votre agenda perso reste privé. Les agendas <strong>famille</strong> sont partagés avec les personnes que vous invitez par e-mail.</div>
        </div>
      </div>`;
    loadGoogle();
  }

  function loadGoogle() {
    const status = $('#auth-status');
    if (!GOOGLE_CLIENT_ID) {
      status.innerHTML = "⚠ ID client Google non configuré. Renseignez <code>GOOGLE_CLIENT_ID</code> (voir le README).";
      return;
    }
    const init = () => {
      status.textContent = '';
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
      window.google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'fr', width: 280 });
      window.google.accounts.id.prompt();
    };
    if (window.google && window.google.accounts) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = init;
    s.onerror = () => { status.textContent = 'Impossible de charger Google. Vérifiez votre connexion.'; };
    document.head.appendChild(s);
  }

  async function onGoogleCredential(resp) {
    const status = $('#auth-status');
    if (status) status.textContent = 'Connexion…';
    try {
      await api('POST', '/api/auth/google', { credential: resp.credential });
      await boot();
    } catch (e) {
      renderAuth('Échec de la connexion. Réessayez.');
    }
  }

  async function logout() {
    try { await api('POST', '/api/auth/logout'); } catch (e) { /* ignore */ }
    if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
    ME = null; SPACE = null;
    renderAuth();
  }

  // =============================================================
  //  CHARGEMENT D'UN ESPACE
  // =============================================================
  async function loadSpace(id) {
    const d = await api('GET', '/api/spaces/' + id);
    SPACE = { id: d.space.id, type: d.space.type, name: d.space.name, ownerUserId: d.space.ownerUserId, version: d.space.version, role: d.space.role };
    DB = {
      members: d.data.members || [], events: d.data.events || [],
      holidays: d.data.holidays || [], custody: d.data.custody || [],
      access: d.access || [], invites: d.invites || [],
    };
    try { localStorage.setItem('sg_last_space', id); } catch (e) { /* ignore */ }
    renderApp();
  }

  async function refreshSpaceMeta() {
    // recharge la liste des espaces (après création / renommage)
    ME = await api('GET', '/api/me');
  }

  // =============================================================
  //  STRUCTURE PRINCIPALE
  // =============================================================
  const NAV = [
    { id: 'agenda', label: 'Agenda', ico: '📅' },
    { id: 'membres', label: 'Membres', ico: '👥' },
    { id: 'vacances', label: 'Vacances', ico: '🏖️' },
    { id: 'gardes', label: 'Gardes', ico: '🔄' },
    { id: 'import', label: 'Import CSV', ico: '📥' },
  ];

  function renderApp() {
    const u = ME.user;
    const space = SPACE;
    const myMember = DB.members.find((m) => m.linkedUserId === u.id);
    const avatarColor = myMember ? myMember.color : PALETTE[0];
    const isOwner = space.role === 'owner';

    const spaceOpts = ME.spaces.map((s) =>
      `<option value="${s.id}" ${s.id === space.id ? 'selected' : ''}>${esc(s.name)}${s.type === 'famille' ? ' · famille' : ''}</option>`
    ).join('') + `<option value="__new">＋ Nouvel espace…</option>`;

    const navHtml = NAV.map((n) => `
      <button class="nav-btn ${state.view === n.id ? 'active' : ''}" data-view="${n.id}">
        <span class="ico">${n.ico}</span><span class="label">${n.label}</span>
      </button>`).join('');

    const adminBtn = isOwner ? `
      <button class="admin-btn ${state.view === 'admin' ? 'active' : ''}" data-view="admin">
        <span class="ico">🛡️</span><span class="label">Administration</span>
      </button>` : '';

    const avatar = u.picture
      ? `<img class="conn-pic" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">`
      : `<div class="conn-avatar" style="background:${avatarColor}">${initials(u.name)}</div>`;

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
            <div class="space-switch">
              <select id="space-select">${spaceOpts}</select>
            </div>
          </div>
          <nav class="nav">${navHtml}</nav>
          <div class="sidebar-foot">
            ${adminBtn}
            <div class="connbox">
              ${avatar}
              <div class="conn-info">
                <div class="conn-name">${esc(u.name || u.email)}</div>
                <div class="conn-role">${isOwner ? 'Propriétaire' : (space.type === 'famille' ? 'Membre famille' : 'Compte perso')}</div>
              </div>
              <button class="conn-logout" data-act="logout" title="Se déconnecter">⏻</button>
            </div>
          </div>
        </aside>
        <main class="content" id="content"></main>
      </div>`;

    $$('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; renderApp(); }));
    $('[data-act="logout"]').addEventListener('click', logout);
    $('#space-select').addEventListener('change', onSpaceSelect);

    renderContent();
  }

  async function onSpaceSelect(e) {
    const val = e.target.value;
    if (val === '__new') { e.target.value = SPACE.id; openCreateSpaceModal(); return; }
    if (val !== SPACE.id) { state.view = 'agenda'; await loadSpace(val); }
  }

  function renderContent() {
    switch (state.view) {
      case 'agenda': return viewAgenda(SPACE);
      case 'membres': return viewMembres(SPACE);
      case 'vacances': return viewVacances(SPACE);
      case 'gardes': return viewGardes(SPACE);
      case 'import': return viewImport(SPACE);
      case 'admin': return viewAdmin(SPACE);
    }
  }

  function openCreateSpaceModal() {
    let type = 'famille';
    openModal(`
      <div class="modal-head"><h3>Nouvel espace</h3><button class="modal-close" data-close>✕</button></div>
      <form id="cs-form" class="modal-body">
        <div class="type-choice">
          <label><input type="radio" name="type" value="famille" checked><span class="tc-inner"><span class="tc-emoji">👨‍👩‍👧</span>Famille</span></label>
          <label><input type="radio" name="type" value="perso"><span class="tc-inner"><span class="tc-emoji">👤</span>Perso</span></label>
        </div>
        <div class="field"><label>Nom de l'espace</label><input name="name" placeholder="ex. Famille Martin" required></div>
        <div class="info-box">Un espace <strong>famille</strong> peut être partagé : vous pourrez y inviter des personnes par e-mail. Un espace <strong>perso</strong> reste privé.</div>
      </form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="cs-save">Créer</button></div>`);
    $('#cs-save').addEventListener('click', async () => {
      const fd = new FormData($('#cs-form'));
      const name = String(fd.get('name')).trim();
      type = fd.get('type');
      if (!name) return;
      const created = await api('POST', '/api/spaces', { type, name });
      await refreshSpaceMeta();
      closeModal();
      state.view = 'agenda';
      await loadSpace(created.id);
    });
  }

  // =============================================================
  //  VUE AGENDA (jour / semaine / mois)
  // =============================================================
  function eventsOn(_sid, ds) {
    let evts = spaceEvents().filter((e) => e.date === ds);
    if (state.filterMember !== 'all') evts = evts.filter((e) => e.memberId === state.filterMember || e.memberId === 'all');
    return evts.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }
  function holidaysOn(_sid, ds) { return spaceHolidays().filter((h) => ds >= h.start && ds <= h.end); }
  function custodyOn(_sid, ds) {
    let c = spaceCustody().filter((x) => ds >= x.start && ds <= x.end);
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
    const members = spaceMembers();
    const filterOpts = `<option value="all">Tout le monde</option>` +
      members.map((m) => `<option value="${m.id}" ${state.filterMember === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

    $('#content').innerHTML = `
      <div class="page-head">
        <div><h2>Agenda</h2><p class="sub">${esc(space.name)}</p></div>
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
    const offset = (first.getDay() + 6) % 7;
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

      let bg = '', holTag = '';
      if (hols.length) {
        bg = `background:${hexAlpha(hols[0].color, 0.18)};`;
        holTag = `<span class="cell-holiday-tag" style="background:${hexAlpha(hols[0].color, 0.9)};color:#fff">${esc(hols[0].name)}</span>`;
      }
      const custStripe = cust.length ? `<span class="cell-custody-stripe" style="background:${memberColor(cust[0].memberId)}" title="Garde : ${esc((memberById(cust[0].memberId) || {}).name || '')}"></span>` : '';

      const shown = evts.slice(0, 3).map((e) => {
        const col = e.memberId === 'all' ? '#9C8478' : memberColor(e.memberId);
        return `<span class="evt" data-evt="${e.id}" style="background:${col}">${e.time ? `<span class="evt-time">${esc(e.time)}</span>` : ''}${esc(e.title)}</span>`;
      }).join('');
      const more = evts.length > 3 ? `<span class="evt-more">+${evts.length - 3} autre(s)</span>` : '';

      cells += `<div class="cal-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-day="${ds}" style="${bg}">
        ${custStripe}${holTag}<span class="cell-num">${d.getDate()}</span>${shown}${more}</div>`;
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

  // ---------- Grille horaire (jour / semaine) ----------
  const TG_START = 7, TG_END = 22, TG_ROW = 52;
  function minutesOf(t) { if (!t) return null; const p = t.split(':'); return (+p[0]) * 60 + (+(p[1] || 0)); }
  function splitEvents(evts) { const timed = [], allday = []; evts.forEach((e) => (e.time ? timed : allday).push(e)); return { timed, allday }; }
  function evColor(e) { return e.memberId === 'all' ? '#9C8478' : memberColor(e.memberId); }

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
    if (sc) sc.scrollTop = (8 - TG_START) * TG_ROW;
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
      return `<div class="wh-cell ${isToday ? 'today' : ''}" style="${bg}"><div class="wh-day">${WEEKDAYS[(d.getDay() + 6) % 7]}</div><div class="wh-num">${d.getDate()}</div>${dot}</div>`;
    }).join('');
    const alldayCells = dates.map((ds) => `<div class="tg-ad-cell" data-date="${ds}">${alldayCellHtml(space, ds)}</div>`).join('');
    const cols = dates.map((ds) => dayColumnHtml(space, ds)).join('');

    $('#cal-area').innerHTML = `
      <div class="weekview"><div class="week-inner">
        <div class="week-head"><div class="wh-gutter"></div>${heads}</div>
        <div class="tg-allday tg-allday-week"><span class="tg-ad-lbl">Jour.</span>${alldayCells}</div>
        <div class="tg-scroll"><div class="tg-body tg-body-week">${tgGutter()}${cols}</div></div>
      </div></div>`;
    wireTimeGrid(space);
    $$('.tg-ad-cell').forEach((cell) => cell.addEventListener('click', (ev) => {
      if (ev.target.closest('.tg-ad-chip')) return;
      openEventModal(space, null, cell.dataset.date);
    }));
  }

  function legendHtml(space) {
    const members = spaceMembers();
    const memDots = members.map((m) => `<span class="legend-item"><span class="legend-dot" style="background:${m.color}"></span>${esc(m.name)}</span>`).join('');
    const hols = spaceHolidays();
    const holDots = hols.length ? `<div class="legend-group"><span class="legend-title">Vacances</span>${hols.map((h) => `<span class="legend-item"><span class="legend-dot" style="background:${h.color}"></span>${esc(h.name)}</span>`).join('')}</div>` : '';
    return `<div class="legend">
      <div class="legend-group"><span class="legend-title">Membres</span>${memDots}<span class="legend-item"><span class="legend-dot" style="background:#9C8478"></span>Toute la famille</span></div>
      ${holDots}</div>`;
  }

  // ---------- Modale évènement ----------
  function openEventModal(space, evt, defaultDate, defaultTime) {
    const members = spaceMembers();
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
      const fd = new FormData($('#evt-form'));
      const title = String(fd.get('title')).trim();
      if (!title) return;
      const data = { title, date: fd.get('date'), time: fd.get('time'), memberId: fd.get('memberId'), type: fd.get('type'), note: String(fd.get('note') || '').trim() };
      if (isEdit) Object.assign(evt, data);
      else DB.events.push(Object.assign({ id: uid() }, data));
      saveDB(); closeModal(); viewAgenda(space);
    });
    if (isEdit) $('[data-del]').addEventListener('click', () => {
      DB.events = DB.events.filter((e) => e.id !== evt.id); saveDB(); closeModal(); viewAgenda(space);
    });
  }

  // =============================================================
  //  VUE MEMBRES (+ accès / invitations pour les familles)
  // =============================================================
  function viewMembres(space) {
    const members = spaceMembers();
    const isFamily = space.type === 'famille';

    const cards = members.map((m) => {
      const linked = m.linkedUserId ? DB.access.find((a) => a.userId === m.linkedUserId) : null;
      return `<div class="card">
        <div class="card-top">
          <div class="member-avatar" style="background:${m.color}">${initials(m.name)}</div>
          <div><div class="card-name">${esc(m.name)}</div><div class="card-tag">${m.role === 'parent' ? 'Parent' : 'Enfant'}${linked ? ' · connecté' : ''}</div></div>
        </div>
        <div class="card-row"><span>Couleur</span><span class="legend-dot" style="width:18px;height:18px;background:${m.color}"></span></div>
        <div class="card-row"><span>Compte</span><span>${linked ? esc(linked.email) : '<em>sans accès</em>'}</span></div>
        <div class="card-actions">
          <button class="icon-btn" data-edit="${m.id}">✎ Modifier</button>
          ${m.linkedUserId === currentUser().id ? '' : `<button class="icon-btn" data-delm="${m.id}">🗑 Retirer</button>`}
        </div>
      </div>`;
    }).join('');

    let accessHtml = '';
    if (isFamily) {
      const accessRows = DB.access.map((a) => `
        <tr><td>${esc(a.name || '—')}</td><td>${esc(a.email)}</td>
        <td>${a.role === 'owner' ? 'Propriétaire' : 'Membre'}</td>
        <td>${(space.role === 'owner' && a.userId !== space.ownerUserId) ? `<button class="icon-btn" data-revoke="${a.userId}">Retirer</button>` : ''}</td></tr>`).join('');
      const pendRows = DB.invites.map((i) => `<tr class="pending"><td>—</td><td>${esc(i.email)}</td><td>invitation envoyée</td><td></td></tr>`).join('');
      accessHtml = `
        <h3 class="section-title">Accès &amp; invitations</h3>
        <div class="info-box">Invitez une personne avec son adresse <strong>Gmail</strong>. Elle rejoindra cet agenda à sa prochaine connexion Google.</div>
        <table class="tbl"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th></th></tr></thead>
        <tbody>${accessRows}${pendRows}</tbody></table>
        <div style="margin-top:14px"><button class="btn btn-primary" id="invite">✉ Inviter par e-mail</button></div>`;
    }

    $('#content').innerHTML = `
      <div class="page-head">
        <div><h2>Membres</h2><p class="sub">Parents, enfants et couleurs</p></div>
        <button class="btn btn-primary" id="add-member">+ Ajouter une personne</button>
      </div>
      ${!isFamily ? '<div class="info-box">Espace <strong>perso</strong> (privé). Pour partager avec d\'autres personnes, créez un espace <strong>famille</strong> via le sélecteur en haut à gauche.</div>' : ''}
      <div class="cards">${cards}</div>
      ${accessHtml}`;

    $('#add-member').addEventListener('click', () => openMemberModal(space, null));
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openMemberModal(space, memberById(b.dataset.edit))));
    $$('[data-delm]').forEach((b) => b.addEventListener('click', () => {
      const m = memberById(b.dataset.delm);
      if (!confirm('Retirer ' + m.name + ' ? Ses évènements seront aussi supprimés.')) return;
      DB.members = DB.members.filter((x) => x.id !== m.id);
      DB.events = DB.events.filter((e) => e.memberId !== m.id);
      DB.custody = DB.custody.filter((c) => c.memberId !== m.id);
      saveDB(); viewMembres(space);
    }));
    if (isFamily) {
      $('#invite').addEventListener('click', () => openInviteModal(space));
      $$('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Retirer l\'accès de cette personne ?')) return;
        await api('DELETE', `/api/spaces/${space.id}/access/${b.dataset.revoke}`);
        await loadSpace(space.id); state.view = 'membres'; renderContent();
      }));
    }
  }

  function colorPicker(selected) {
    return `<div class="color-grid">${PALETTE.map((c) => `<div class="color-swatch ${c === selected ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>`;
  }

  function openMemberModal(space, m) {
    const isEdit = !!m;
    const used = spaceMembers().map((x) => x.color);
    let selColor = m ? m.color : (PALETTE.find((c) => !used.includes(c)) || PALETTE[0]);
    openModal(`
      <div class="modal-head"><h3>${isEdit ? 'Modifier' : 'Ajouter'} une personne</h3><button class="modal-close" data-close>✕</button></div>
      <form id="m-form" class="modal-body">
        <div class="field"><label>Nom</label><input name="name" value="${m ? esc(m.name) : ''}" required></div>
        <div class="field"><label>Rôle</label>
          <select name="role"><option value="parent" ${m && m.role === 'parent' ? 'selected' : ''}>Parent</option><option value="enfant" ${m && m.role === 'enfant' ? 'selected' : ''}>Enfant</option></select>
        </div>
        <div class="field"><label>Code couleur</label>${colorPicker(selColor)}</div>
      </form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="m-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button></div>`);
    $$('.color-swatch').forEach((s) => s.addEventListener('click', () => { selColor = s.dataset.color; $$('.color-swatch').forEach((x) => x.classList.remove('selected')); s.classList.add('selected'); }));
    $('#m-save').addEventListener('click', () => {
      const fd = new FormData($('#m-form'));
      const name = String(fd.get('name')).trim(); if (!name) return;
      if (isEdit) { m.name = name; m.role = fd.get('role'); m.color = selColor; }
      else DB.members.push({ id: uid(), name, role: fd.get('role'), color: selColor });
      saveDB(); closeModal(); viewMembres(space);
    });
  }

  function openInviteModal(space) {
    openModal(`
      <div class="modal-head"><h3>Inviter une personne</h3><button class="modal-close" data-close>✕</button></div>
      <form id="inv-form" class="modal-body">
        <div class="field"><label>Adresse Gmail</label><input name="email" type="email" placeholder="prenom@gmail.com" required></div>
        <div class="info-box">La personne rejoindra <strong>${esc(space.name)}</strong> dès qu'elle se connectera avec ce compte Google.</div>
        <p id="inv-msg" class="form-error" style="display:none"></p>
      </form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Annuler</button><button class="btn btn-primary" id="inv-save">Inviter</button></div>`);
    $('#inv-save').addEventListener('click', async () => {
      const email = String(new FormData($('#inv-form')).get('email')).trim();
      const msg = $('#inv-msg');
      try {
        const r = await api('POST', `/api/spaces/${space.id}/invite`, { email });
        closeModal();
        await loadSpace(space.id); state.view = 'membres'; renderContent();
        alert(r.status === 'added' ? 'Personne ajoutée : elle a déjà un compte et a maintenant accès.' : 'Invitation enregistrée ! Elle rejoindra à sa prochaine connexion.');
      } catch (e) {
        msg.style.display = 'block';
        msg.textContent = e.data && e.data.error === 'invalid_email' ? 'Adresse e-mail invalide.' : "Échec de l'invitation.";
      }
    });
  }

  // =============================================================
  //  VUE VACANCES
  // =============================================================
  function viewVacances(space) {
    const hols = spaceHolidays().slice().sort((a, b) => a.start.localeCompare(b.start));
    const rows = hols.map((h) => `
      <div class="card">
        <div class="card-top"><div class="member-avatar" style="background:${h.color};font-size:1.3rem">🏖️</div>
          <div><div class="card-name">${esc(h.name)}</div><div class="card-tag">${fmtDateLong(h.start)} → ${fmtDateLong(h.end)}</div></div></div>
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
      else DB.holidays.push({ id: uid(), name, start, end, color: selColor });
      saveDB(); closeModal(); viewVacances(space);
    });
  }

  // =============================================================
  //  VUE GARDES PARTAGÉES
  // =============================================================
  function viewGardes(space) {
    const cust = spaceCustody().slice().sort((a, b) => a.start.localeCompare(b.start));
    const parents = spaceMembers();
    const rows = cust.map((c) => {
      const m = memberById(c.memberId) || {};
      return `<div class="card">
        <div class="card-top"><div class="member-avatar" style="background:${m.color || '#9C8478'}">${initials(m.name)}</div>
          <div><div class="card-name">${esc(c.label || ('Garde · ' + (m.name || '')))}</div><div class="card-tag">${fmtDateLong(c.start)} → ${fmtDateLong(c.end)}</div></div></div>
        <div class="card-row"><span>Chez</span><span class="pill" style="background:${m.color || '#9C8478'}">${esc(m.name || '—')}</span></div>
        <div class="card-actions"><button class="icon-btn" data-editc="${c.id}">✎ Modifier</button><button class="icon-btn" data-delc="${c.id}">🗑 Supprimer</button></div>
      </div>`;
    }).join('');
    $('#content').innerHTML = `
      <div class="page-head"><div><h2>Gardes partagées</h2><p class="sub">Périodes repérées par couleur dans l'agenda</p></div>
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
    const members = spaceMembers();
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
      else DB.custody.push(Object.assign({ id: uid() }, data));
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
      <div class="page-head"><div><h2>Import CSV</h2><p class="sub">Ajoutez plusieurs évènements d'un coup</p></div></div>
      <div class="info-box">
        Le fichier doit contenir une <strong>ligne d'en-tête</strong>. Colonnes reconnues (FR ou EN) :
        <strong>date</strong>, <strong>titre/title</strong>, <strong>heure/time</strong>, <strong>personne/membre</strong>, <strong>type</strong>, <strong>note</strong>.<br>
        Dates : <code>2026-09-15</code> ou <code>15/09/2026</code>. Séparateur <code>,</code> ou <code>;</code>.
        <br><a href="#" id="dl-sample" style="color:var(--rose-dk);font-weight:600">⬇ Télécharger un modèle</a>
      </div>
      <div class="drop-zone" id="drop"><span class="emoji">📥</span><strong>Cliquez ou glissez votre fichier .csv ici</strong><br><span style="font-size:.82rem">Aperçu avant validation</span></div>
      <input type="file" id="file" accept=".csv,text/csv" hidden>
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
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'modele-agenda.csv'; a.click();
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
    const reader = new FileReader();
    reader.onload = () => parseAndPreview(reader.result, space);
    reader.readAsText(file, 'utf-8');
  }
  function parseAndPreview(text, space) {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) { $('#import-result').innerHTML = '<p class="form-error">Fichier vide ou sans données.</p>'; return; }
    const delim = detectDelim(lines[0]);
    const headers = parseCSVLine(lines[0], delim).map((h) => h.toLowerCase());
    const idx = (names) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return -1; };
    const iDate = idx(['date']);
    const iTitle = idx(['titre', 'title', 'évènement', 'evenement', 'event']);
    const iTime = idx(['heure', 'time', 'horaire']);
    const iMember = idx(['personne', 'membre', 'member', 'person', 'qui']);
    const iType = idx(['type', 'catégorie', 'categorie', 'category']);
    const iNote = idx(['note', 'notes', 'remarque', 'description']);
    const members = spaceMembers();
    const matchMember = (name) => {
      if (!name) return 'all';
      const n = name.trim().toLowerCase();
      if (['toute la famille', 'famille', 'tous', 'all'].includes(n)) return 'all';
      const m = members.find((x) => x.name.toLowerCase() === n);
      return m ? m.id : 'all';
    };
    const rows = []; const errors = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i], delim);
      const date = normDate(iDate >= 0 ? cols[iDate] : '');
      const title = iTitle >= 0 ? cols[iTitle] : '';
      if (!date || !title) { errors.push(`Ligne ${i + 1} ignorée (date ou titre manquant).`); continue; }
      const memberName = iMember >= 0 ? cols[iMember] : '';
      rows.push({ id: uid(), date, title, time: iTime >= 0 ? cols[iTime] : '', memberId: matchMember(memberName), _memberName: memberName, type: iType >= 0 ? cols[iType] : '', note: iNote >= 0 ? cols[iNote] : '' });
    }
    csvParsed = rows;
    if (!rows.length) { $('#import-result').innerHTML = `<p class="form-error">Aucune ligne valide.</p>${errors.map((e) => `<p class="le-meta">${esc(e)}</p>`).join('')}`; return; }
    const preview = rows.slice(0, 50).map((r) => {
      const m = r.memberId === 'all' ? 'Toute la famille' : (memberById(r.memberId) || {}).name;
      const warn = (r._memberName && r.memberId === 'all' && !['toute la famille', 'famille', 'tous', 'all', ''].includes(r._memberName.toLowerCase())) ? ` <span style="color:#b5483f" title="Nom non reconnu">⚠</span>` : '';
      return `<tr><td>${esc(r.date)}</td><td>${esc(r.title)}</td><td>${esc(r.time)}</td><td>${esc(m)}${warn}</td><td>${esc(r.type)}</td></tr>`;
    }).join('');
    $('#import-result').innerHTML = `
      <div class="info-box"><strong>${rows.length}</strong> évènement(s) prêt(s).${errors.length ? ` ${errors.length} ligne(s) ignorée(s).` : ''} Le ⚠ signale un nom non reconnu (assigné à « Toute la famille »).</div>
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
  //  VUE ADMINISTRATION (propriétaire de l'espace)
  // =============================================================
  function viewAdmin(space) {
    const isOwner = space.role === 'owner';
    const accessRows = DB.access.map((a) => `<tr><td>${esc(a.name || '—')}</td><td>${esc(a.email)}</td><td>${a.role === 'owner' ? 'Propriétaire' : 'Membre'}</td></tr>`).join('');
    $('#content').innerHTML = `
      <div class="page-head"><div><h2>Administration</h2><p class="sub">Espace « ${esc(space.name)} »</p></div></div>
      <div class="info-box">Type : <strong>${space.type === 'famille' ? 'Famille (partagé)' : 'Perso (privé)'}</strong> · ${DB.access.length} personne(s) avec accès.</div>

      <h3 class="section-title">Renommer l'espace</h3>
      <div class="field-row" style="max-width:480px">
        <div class="field" style="flex:1"><input id="rename-input" value="${esc(space.name)}"></div>
        <button class="btn btn-primary" id="rename-btn" style="height:42px">Renommer</button>
      </div>

      ${space.type === 'famille' ? `<h3 class="section-title">Personnes ayant accès</h3>
      <table class="tbl"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th></tr></thead><tbody>${accessRows}</tbody></table>
      <p class="sub" style="margin-top:8px">Gérez les invitations depuis l'onglet <strong>Membres</strong>.</p>` : ''}

      <h3 class="section-title">Zone sensible</h3>
      <div class="head-actions">
        ${isOwner ? `<button class="btn btn-danger" id="del-space">🗑 Supprimer cet espace</button>` : `<button class="btn btn-danger" id="leave-space">Quitter cet espace</button>`}
      </div>`;

    $('#rename-btn').addEventListener('click', async () => {
      const name = $('#rename-input').value.trim(); if (!name) return;
      await api('PATCH', '/api/spaces/' + space.id, { name });
      await refreshSpaceMeta(); SPACE.name = name; renderApp();
    });
    if (isOwner && $('#del-space')) $('#del-space').addEventListener('click', () => deleteOrLeave(space, true));
    if (!isOwner && $('#leave-space')) $('#leave-space').addEventListener('click', () => deleteOrLeave(space, false));
  }

  async function deleteOrLeave(space, isDelete) {
    const persoSpaces = ME.spaces.filter((s) => s.id !== space.id);
    if (isDelete && space.type === 'perso' && !ME.spaces.some((s) => s.type === 'perso' && s.id !== space.id)) {
      if (!confirm('Ceci est votre espace perso. Le supprimer effacera son contenu. Continuer ?')) return;
    } else if (!confirm(isDelete ? 'Supprimer définitivement cet espace et tout son contenu ?' : 'Quitter cet espace ?')) return;
    await api('DELETE', '/api/spaces/' + space.id);
    await refreshSpaceMeta();
    const next = (ME.spaces[0] || persoSpaces[0]);
    if (next) { state.view = 'agenda'; await loadSpace(next.id); }
    else boot();
  }

  // =============================================================
  //  MODALES
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
  async function boot() {
    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      GOOGLE_CLIENT_ID = cfg.googleClientId || '';
    } catch (e) { GOOGLE_CLIENT_ID = ''; }

    try { ME = await api('GET', '/api/me'); }
    catch (e) { ME = null; }

    if (!ME) { renderAuth(); return; }
    if (!ME.spaces.length) { openCreateSpaceModal(); return; } // ne devrait pas arriver (perso auto-créé)

    let lastId = null;
    try { lastId = localStorage.getItem('sg_last_space'); } catch (e) { /* ignore */ }
    const pick = ME.spaces.find((s) => s.id === lastId) || ME.spaces.find((s) => s.type === 'famille') || ME.spaces[0];
    await loadSpace(pick.id);
  }

  boot();
})();
