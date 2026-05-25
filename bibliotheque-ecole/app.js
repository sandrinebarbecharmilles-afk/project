(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function daysSince(iso) {
    if (!iso) return 0;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  /* ── State ───────────────────────────────────────────────── */

  let DB = { books: [], loans: [], students: [], classes: [] };
  let currentUser = null;
  let isAdmin = false;
  let saveTimer = null;
  let scannerInstance = null;
  let scannerRunning = false;
  let currentBookId = null;
  let selectedStudent = null;
  let addStudentClass = '';
  let activeTab = 'shelf';

  const GENRES = ['Albums', 'Romans', 'BD', 'Documentaires', 'Contes et fables', 'Poésie', 'Théâtre', 'Magazines', 'Autre'];

  /* ── ISBN / book lookup ──────────────────────────────────── */

  function mapGenre(cats) {
    if (!cats || !cats.length) return 'Autre';
    const c = cats.join(' ').toLowerCase();
    if (c.includes('comic') || c.includes('graphic novel') || c.includes('bande')) return 'BD';
    if (c.includes('poetry') || c.includes('poé')) return 'Poésie';
    if (c.includes('theater') || c.includes('drama') || c.includes('théâtre')) return 'Théâtre';
    if (c.includes('fairy') || c.includes('fable') || c.includes('tale') || c.includes('conte')) return 'Contes et fables';
    if (c.includes('magazine') || c.includes('periodical')) return 'Magazines';
    if (c.includes('juvenile fiction') || c.includes('picture book') || c.includes('album')) return 'Albums';
    if (c.includes('fiction') && !c.includes('non')) return 'Romans';
    if (c.includes('nonfiction') || c.includes('non-fiction') || c.includes('science') || c.includes('history') || c.includes('nature') || c.includes('documentaire')) return 'Documentaires';
    return 'Autre';
  }

  async function fetchByISBN(isbn) {
    try {
      const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn);
      const d = await r.json();
      if (d.items && d.items[0]) {
        const info = d.items[0].volumeInfo;
        return {
          title: info.title || '',
          author: (info.authors || []).join(', '),
          genre: mapGenre(info.categories),
          publisher: info.publisher || '',
          year: info.publishedDate ? info.publishedDate.slice(0, 4) : '',
          cover: info.imageLinks ? (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || '').replace('http://', 'https://') : '',
          dimensions: info.dimensions ? info.dimensions.height + ' × ' + info.dimensions.width + ' cm' : '',
        };
      }
    } catch (e) { /* fallthrough */ }

    try {
      const r = await fetch('https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data');
      const d = await r.json();
      const b = d['ISBN:' + isbn];
      if (b) {
        return {
          title: b.title || '',
          author: (b.authors || []).map(function (a) { return a.name; }).join(', '),
          genre: 'Autre',
          publisher: b.publishers ? b.publishers[0].name : '',
          year: b.publish_date ? b.publish_date.slice(-4) : '',
          cover: b.cover ? (b.cover.medium || b.cover.small || '') : '',
          dimensions: '',
        };
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  /* ── API ─────────────────────────────────────────────────── */

  async function loadState() {
    const res = await fetch('/api/state');
    if (res.status === 401) { showLogin(); return false; }
    const data = await res.json();
    if (data.consentRequired) { showConsent(); return false; }
    currentUser = data.username;
    isAdmin = data.isAdmin;
    const defaults = { books: [], loans: [], students: [], classes: [] };
    DB = Object.assign(defaults, data.state || {});
    if (!Array.isArray(DB.books)) DB.books = [];
    if (!Array.isArray(DB.loans)) DB.loans = [];
    if (!Array.isArray(DB.students)) DB.students = [];
    if (!Array.isArray(DB.classes)) DB.classes = [];
    return true;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      try {
        await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: DB })
        });
      } catch (e) {
        toast('⚠ Erreur de sauvegarde');
      }
    }, 900);
  }

  /* ── Overlays ────────────────────────────────────────────── */

  function showLogin() {
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('appContainer').classList.add('hidden');
  }

  function showConsent() {
    document.getElementById('consentOverlay').classList.remove('hidden');
    document.getElementById('appContainer').classList.add('hidden');
  }

  function setupApp() {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('consentOverlay').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');

    if (isAdmin) {
      document.querySelectorAll('[data-admin-only]').forEach(function (el) {
        el.classList.remove('hidden');
      });
    }

    const nameEl = document.getElementById('userDisplayName');
    if (nameEl) nameEl.textContent = currentUser;

    renderShelf();
    checkReminders();
  }

  /* ── Tab switching ───────────────────────────────────────── */

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.nav-tab').forEach(function (b) { b.classList.remove('active'); });

    const pane = document.getElementById('tab-' + tab);
    if (pane) pane.classList.add('active');

    const btn = document.querySelector('.nav-tab[data-tab="' + tab + '"]');
    if (btn) btn.classList.add('active');

    if (tab !== 'add') stopScanner();

    if (tab === 'shelf') renderShelf();
    else if (tab === 'loans') renderLoans();
    else if (tab === 'students') renderStudents();
    else if (tab === 'admin') renderAdmin();
  }

  /* ── Shelf ───────────────────────────────────────────────── */

  function renderShelf() {
    const container = document.getElementById('shelfContent');
    const genreFilter = document.getElementById('filterGenre').value;
    const sortFilter = document.getElementById('filterSort').value;

    let books = DB.books.slice();

    if (genreFilter) books = books.filter(function (b) { return b.genre === genreFilter; });

    if (sortFilter === 'title') books.sort(function (a, b) { return a.title.localeCompare(b.title, 'fr'); });
    else if (sortFilter === 'author') books.sort(function (a, b) { return (a.author || '').localeCompare(b.author || '', 'fr'); });
    else if (sortFilter === 'genre') books.sort(function (a, b) { return (a.genre || '').localeCompare(b.genre || '', 'fr'); });
    else books.sort(function (a, b) { return new Date(b.addedAt || 0) - new Date(a.addedAt || 0); });

    const genres = Array.from(new Set(DB.books.map(function (b) { return b.genre; }).filter(Boolean))).sort();
    const genreSelect = document.getElementById('filterGenre');
    const saved = genreSelect.value;
    genreSelect.innerHTML = '<option value="">Tous les genres</option>' +
      genres.map(function (g) { return '<option value="' + escHtml(g) + '"' + (saved === g ? ' selected' : '') + '>' + escHtml(g) + '</option>'; }).join('');

    if (!books.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div>' +
        '<div class="empty-title">Aucun livre' + (genreFilter ? ' dans ce genre' : '') + '</div>' +
        '<div class="empty-sub">Ajoutez des livres en scannant leurs codes-barres ou en saisissant l\'ISBN.</div></div>';
      return;
    }

    container.innerHTML = '<div class="books-grid">' + books.map(renderBookCard).join('') + '</div>';
  }

  function renderBookCard(book) {
    const lent = Boolean(book.loanId);
    const badge = lent ? '<div class="book-lent-badge">Prêté</div>' : '';
    const cover = book.cover
      ? '<img class="book-cover" src="' + escHtml(book.cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
      : '';
    const ph = '<div class="book-cover-placeholder"' + (book.cover ? ' style="display:none"' : '') + '>📖</div>';
    return '<button class="book-card" onclick="openBookModal(\'' + escHtml(book.id) + '\')">' +
      badge + cover + ph +
      '<div class="book-card-info">' +
      '<div class="book-card-title">' + escHtml(book.title) + '</div>' +
      '<div class="book-card-author">' + escHtml(book.author) + '</div>' +
      (book.genre ? '<span class="book-card-genre">' + escHtml(book.genre) + '</span>' : '') +
      '</div></button>';
  }

  /* ── Loans ───────────────────────────────────────────────── */

  function renderLoans() {
    const container = document.getElementById('loansContent');
    const loans = DB.loans;

    const od = loans.filter(function (l) { return daysSince(l.lentAt) > 21; }).length;
    const totalEl = document.getElementById('statTotal');
    const overdueEl = document.getElementById('statOverdue');
    if (totalEl) totalEl.textContent = loans.length + ' prêt' + (loans.length > 1 ? 's' : '');
    if (overdueEl) {
      overdueEl.textContent = od + ' en retard';
      overdueEl.classList.toggle('overdue', od > 0);
    }

    if (!loans.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div>' +
        '<div class="empty-title">Aucun prêt en cours</div>' +
        '<div class="empty-sub">Les livres prêtés apparaîtront ici.</div></div>';
      return;
    }

    const sorted = loans.slice().sort(function (a, b) { return new Date(a.lentAt) - new Date(b.lentAt); });
    container.innerHTML = '<div class="loans-list">' + sorted.map(renderLoanCard).join('') + '</div>';
  }

  function renderLoanCard(loan) {
    const book = DB.books.find(function (b) { return b.id === loan.bookId; });
    if (!book) return '';
    const days = daysSince(loan.lentAt);
    const overdue = days > 21;
    const daysStr = days === 0 ? 'aujourd\'hui' : 'il y a ' + days + ' jour' + (days > 1 ? 's' : '');
    const cover = book.cover
      ? '<img src="' + escHtml(book.cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '📖';

    const lp = new URLSearchParams({
      student: loan.studentName, class: loan.studentClass,
      title: book.title, author: book.author,
      publisher: book.publisher || '', dimensions: book.dimensions || '',
      lentDate: loan.lentAt, days: String(days)
    });

    return '<div class="loan-card">' +
      '<div class="loan-cover">' + cover + '</div>' +
      '<div class="loan-info">' +
      '<div class="loan-title">' + escHtml(book.title) + '</div>' +
      '<div class="loan-author">' + escHtml(book.author) + '</div>' +
      '<span class="loan-student-class">' + escHtml(loan.studentName) + ' · ' + escHtml(loan.studentClass) + '</span>' +
      '<div class="loan-meta' + (overdue ? ' loan-overdue' : '') + '">Prêté ' + escHtml(daysStr) + '</div>' +
      '<div class="loan-actions">' +
      '<button class="btn-loan-action primary" onclick="markReturned(\'' + escHtml(loan.id) + '\')">Rendu</button>' +
      '<button class="btn-loan-action" onclick="window.open(\'lettre.html?' + lp + '\',\'_blank\')">Lettre</button>' +
      '</div></div></div>';
  }

  /* ── Students ────────────────────────────────────────────── */

  function renderStudents() {
    const container = document.getElementById('studentsContent');
    if (!DB.classes.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div>' +
        '<div class="empty-title">Aucune classe configurée</div>' +
        '<div class="empty-sub">Ajoutez des classes pour gérer les élèves.</div>' +
        '<button class="btn-primary" onclick="openNewClassModal()" style="margin-top:12px">Ajouter une classe</button></div>';
      return;
    }

    let html = DB.classes.map(function (cls) {
      const students = DB.students.filter(function (s) { return s.class === cls; });
      return '<div class="class-section">' +
        '<div class="class-section-header">' +
        '<div><span class="class-section-title">' + escHtml(cls) + '</span>' +
        '<span class="class-count"> ' + students.length + ' élève' + (students.length > 1 ? 's' : '') + '</span></div>' +
        '<div style="display:flex;gap:8px">' +
        '<button class="btn-add-student" onclick="openAddStudentModal(\'' + escHtml(cls) + '\')">+ Élève</button>' +
        '<button class="btn-delete-student" onclick="deleteClass(\'' + escHtml(cls) + '\')" title="Supprimer la classe">🗑</button>' +
        '</div></div>' +
        '<ul class="student-list">' +
        (students.length ? students.map(function (s) {
          return '<li class="student-row"><span class="student-row-name">' + escHtml(s.name) + '</span>' +
            '<button class="btn-delete-student" onclick="deleteStudent(\'' + escHtml(s.id) + '\')">×</button></li>';
        }).join('') : '<li class="student-row" style="color:var(--light);font-size:0.84rem;padding:12px 16px">Aucun élève</li>') +
        '</ul></div>';
    }).join('');

    html += '<div class="new-class-wrap"><button class="btn-outline-accent" onclick="openNewClassModal()">+ Nouvelle classe</button></div>';
    container.innerHTML = html;
  }

  /* ── Search ──────────────────────────────────────────────── */

  function renderSearch(query) {
    const container = document.getElementById('searchContent');
    if (!query.trim()) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Tapez pour rechercher</div></div>';
      return;
    }
    const q = query.toLowerCase();
    const results = DB.books.filter(function (b) {
      return b.title.toLowerCase().includes(q) ||
        (b.author && b.author.toLowerCase().includes(q)) ||
        (b.isbn && b.isbn.includes(q));
    });
    if (!results.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Aucun résultat pour « ' + escHtml(query) + ' »</div></div>';
      return;
    }
    container.innerHTML = '<div class="books-grid">' + results.map(renderBookCard).join('') + '</div>';
  }

  /* ── Admin ───────────────────────────────────────────────── */

  async function renderAdmin() {
    const container = document.getElementById('adminContent');
    container.innerHTML = '<div class="api-loading"><div class="spinner"></div><p>Chargement…</p></div>';
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) { container.innerHTML = '<p>Erreur de chargement.</p>'; return; }
      const data = await res.json();
      container.innerHTML = '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Utilisateur</th><th>Méthode</th><th>Dernière connexion</th><th>Statut</th><th>Actions</th>' +
        '</tr></thead><tbody>' +
        data.users.map(function (u) {
          return '<tr><td>' + escHtml(u.username) + (u.isAdmin ? ' <span class="badge badge-admin">admin</span>' : '') + '</td>' +
            '<td>' + escHtml(u.authMethod || 'password') + '</td>' +
            '<td>' + (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('fr-FR') : '—') + '</td>' +
            '<td><span class="badge ' + (u.disabled ? 'badge-disabled' : 'badge-active') + '">' + (u.disabled ? 'désactivé' : 'actif') + '</span></td>' +
            '<td><div class="admin-actions">' +
            (!u.isAdmin ? '<button class="btn-secondary btn-sm" onclick="adminToggle(\'' + escHtml(u.username) + '\')">' + (u.disabled ? 'Réactiver' : 'Désactiver') + '</button>' +
              '<button class="btn-danger btn-sm" onclick="adminDelete(\'' + escHtml(u.username) + '\')">Supprimer</button>' : '') +
            '</div></td></tr>';
        }).join('') +
        '</tbody></table></div>';
    } catch (e) {
      container.innerHTML = '<p>Erreur de chargement.</p>';
    }
  }

  /* ── Reminders ───────────────────────────────────────────── */

  function checkReminders() {
    const overdue = DB.loans.filter(function (l) { return daysSince(l.lentAt) > 21; });
    const banner = document.getElementById('reminderBanner');
    const badge = document.getElementById('loansBadge');

    if (badge) {
      badge.textContent = String(overdue.length);
      badge.classList.toggle('hidden', overdue.length === 0);
    }

    if (!overdue.length) { banner.classList.add('hidden'); return; }

    banner.classList.remove('hidden');
    banner.innerHTML = overdue.map(function (l) {
      const book = DB.books.find(function (b) { return b.id === l.bookId; });
      if (!book) return '';
      const days = daysSince(l.lentAt);
      const lp = new URLSearchParams({
        student: l.studentName, class: l.studentClass,
        title: book.title, author: book.author,
        publisher: book.publisher || '', dimensions: book.dimensions || '',
        lentDate: l.lentAt, days: String(days)
      });
      return '<div class="reminder-item">' +
        '<div class="reminder-item-info">' +
        '<strong>' + escHtml(l.studentName) + ' — ' + escHtml(book.title) + '</strong>' +
        '<span>' + days + ' jours de retard · ' + escHtml(l.studentClass) + '</span>' +
        '</div><div class="reminder-item-actions">' +
        '<button class="btn-reminder" onclick="window.open(\'lettre.html?' + lp + '\',\'_blank\')">Lettre</button>' +
        '<button class="btn-reminder solid" onclick="markReturned(\'' + escHtml(l.id) + '\')">Rendu</button>' +
        '</div></div>';
    }).join('');
  }

  /* ── Book modal ──────────────────────────────────────────── */

  function openBookModal(id) {
    currentBookId = id;
    const book = DB.books.find(function (b) { return b.id === id; });
    if (!book) return;
    const loan = book.loanId ? DB.loans.find(function (l) { return l.id === book.loanId; }) : null;
    const modal = document.getElementById('bookModal');
    const body = document.getElementById('bookModalBody');

    const cover = book.cover
      ? '<img class="book-detail-cover" src="' + escHtml(book.cover) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
      : '';
    const ph = '<div class="book-detail-cover-placeholder"' + (book.cover ? ' style="display:none"' : '') + '>📖</div>';

    const chips = [book.genre, book.year, book.publisher, book.dimensions, book.isbn ? 'ISBN ' + book.isbn : '']
      .filter(Boolean)
      .map(function (v) { return '<span class="meta-chip">' + escHtml(v) + '</span>'; }).join('');

    const lentInfo = loan
      ? '<div class="book-detail-lent-info">Prêté à <strong>' + escHtml(loan.studentName) + '</strong> (' + escHtml(loan.studentClass) + ') il y a ' + daysSince(loan.lentAt) + ' jour' + (daysSince(loan.lentAt) > 1 ? 's' : '') + '</div>'
      : '';

    const actions = loan
      ? '<button class="btn-primary" onclick="markReturned(\'' + escHtml(loan.id) + '\');closeModal(\'bookModal\')">Marquer comme rendu</button>'
      : '<button class="btn-primary" onclick="closeModal(\'bookModal\');openLendModal(\'' + escHtml(book.id) + '\')">Prêter ce livre</button>';

    body.innerHTML = cover + ph +
      '<div class="book-detail-title">' + escHtml(book.title) + '</div>' +
      '<div class="book-detail-author">' + escHtml(book.author) + '</div>' +
      '<div class="book-detail-meta">' + chips + '</div>' +
      lentInfo +
      '<div class="book-detail-actions">' + actions +
      '<button class="btn-secondary" onclick="closeModal(\'bookModal\')">Fermer</button>' +
      '<button class="btn-danger" onclick="deleteBook(\'' + escHtml(book.id) + '\')">Supprimer le livre</button>' +
      '</div>';

    modal.classList.remove('hidden');
  }

  /* ── Lend modal ──────────────────────────────────────────── */

  function openLendModal(bookId) {
    currentBookId = bookId;
    selectedStudent = null;
    const input = document.getElementById('borrowerInput');
    const chip = document.getElementById('borrowerChip');
    input.value = '';
    chip.classList.add('hidden');
    input.classList.remove('hidden');
    document.getElementById('autocompleteList').classList.add('hidden');
    document.getElementById('lendModal').classList.remove('hidden');
    setTimeout(function () { input.focus(); }, 100);
  }

  function updateAutocomplete(query) {
    const list = document.getElementById('autocompleteList');
    if (!query.trim()) { list.classList.add('hidden'); return; }
    const q = query.toLowerCase();
    const matches = DB.students.filter(function (s) { return s.name.toLowerCase().includes(q); }).slice(0, 8);
    if (!matches.length) { list.classList.add('hidden'); return; }
    list.classList.remove('hidden');
    list.innerHTML = matches.map(function (s) {
      return '<li class="autocomplete-item" onclick="selectBorrower(\'' + escHtml(s.id) + '\')">' +
        escHtml(s.name) + '<span class="autocomplete-item-class">' + escHtml(s.class) + '</span></li>';
    }).join('');
  }

  function selectBorrower(studentId) {
    const s = DB.students.find(function (st) { return st.id === studentId; });
    if (!s) return;
    selectedStudent = s;
    document.getElementById('borrowerInput').classList.add('hidden');
    document.getElementById('autocompleteList').classList.add('hidden');
    const chip = document.getElementById('borrowerChip');
    document.getElementById('borrowerChipName').textContent = s.name + ' · ' + s.class;
    chip.classList.remove('hidden');
  }

  function clearBorrower() {
    selectedStudent = null;
    document.getElementById('borrowerChip').classList.add('hidden');
    const input = document.getElementById('borrowerInput');
    input.classList.remove('hidden');
    input.value = '';
    input.focus();
  }

  function confirmLend() {
    if (!selectedStudent) { toast('Sélectionnez un élève emprunteur'); return; }
    const book = DB.books.find(function (b) { return b.id === currentBookId; });
    if (!book) return;
    const loan = {
      id: uid(),
      bookId: book.id,
      studentId: selectedStudent.id,
      studentName: selectedStudent.name,
      studentClass: selectedStudent.class,
      lentAt: new Date().toISOString()
    };
    DB.loans.push(loan);
    book.loanId = loan.id;
    scheduleSave();
    closeModal('lendModal');
    toast('📖 Prêté à ' + selectedStudent.name);
    if (activeTab === 'shelf') renderShelf();
    if (activeTab === 'loans') renderLoans();
    checkReminders();
  }

  /* ── Mark returned ───────────────────────────────────────── */

  function markReturned(loanId) {
    const loan = DB.loans.find(function (l) { return l.id === loanId; });
    if (!loan) return;
    const book = DB.books.find(function (b) { return b.id === loan.bookId; });
    if (book) book.loanId = null;
    DB.loans = DB.loans.filter(function (l) { return l.id !== loanId; });
    scheduleSave();
    toast('✅ Livre rendu');
    if (activeTab === 'shelf') renderShelf();
    if (activeTab === 'loans') renderLoans();
    checkReminders();
  }

  /* ── Delete book ─────────────────────────────────────────── */

  function deleteBook(bookId) {
    if (!confirm('Supprimer ce livre définitivement ?')) return;
    DB.loans = DB.loans.filter(function (l) { return l.bookId !== bookId; });
    DB.books = DB.books.filter(function (b) { return b.id !== bookId; });
    scheduleSave();
    closeModal('bookModal');
    toast('Livre supprimé');
    if (activeTab === 'shelf') renderShelf();
    if (activeTab === 'loans') renderLoans();
    checkReminders();
  }

  /* ── Add book form ───────────────────────────────────────── */

  async function lookupISBN() {
    const isbn = document.getElementById('isbnInput').value.trim().replace(/-/g, '');
    if (!isbn) return;
    document.getElementById('addLoading').classList.remove('hidden');
    document.getElementById('addMethods').classList.add('hidden');
    const data = await fetchByISBN(isbn);
    document.getElementById('addLoading').classList.add('hidden');
    if (!data) {
      toast('ISBN non trouvé — saisissez les informations manuellement');
      showManualForm({ isbn: isbn });
      return;
    }
    showManualForm(Object.assign({ isbn: isbn }, data));
  }

  function showManualForm(prefill) {
    prefill = prefill || {};
    document.getElementById('addMethods').classList.add('hidden');
    document.getElementById('bookForm').classList.remove('hidden');

    document.getElementById('fTitle').value = prefill.title || '';
    document.getElementById('fAuthor').value = prefill.author || '';
    document.getElementById('fPublisher').value = prefill.publisher || '';
    document.getElementById('fYear').value = prefill.year || '';
    document.getElementById('fISBN').value = prefill.isbn || '';
    document.getElementById('fDimensions').value = prefill.dimensions || '';
    document.getElementById('fCoverUrl').value = prefill.cover || '';

    const genreSelect = document.getElementById('fGenre');
    genreSelect.innerHTML = GENRES.map(function (g) {
      return '<option value="' + escHtml(g) + '"' + (prefill.genre === g ? ' selected' : '') + '>' + escHtml(g) + '</option>';
    }).join('');

    updateCoverPreview(prefill.cover || '');
    document.getElementById('fTitle').focus();
  }

  function updateCoverPreview(url) {
    const preview = document.getElementById('coverPreview');
    if (url) {
      preview.innerHTML = '<img src="' + escHtml(url) + '" alt="" style="width:100%;height:100%;object-fit:cover">';
    } else {
      preview.textContent = 'Couverture';
    }
  }

  function cancelAddBook() {
    document.getElementById('addMethods').classList.remove('hidden');
    document.getElementById('bookForm').classList.add('hidden');
    stopScanner();
  }

  function saveBook() {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) { toast('Le titre est requis'); return; }
    const book = {
      id: uid(),
      title: title,
      author: document.getElementById('fAuthor').value.trim(),
      genre: document.getElementById('fGenre').value || 'Autre',
      publisher: document.getElementById('fPublisher').value.trim(),
      year: document.getElementById('fYear').value.trim(),
      isbn: document.getElementById('fISBN').value.trim(),
      dimensions: document.getElementById('fDimensions').value.trim(),
      cover: document.getElementById('fCoverUrl').value.trim(),
      addedAt: new Date().toISOString(),
      loanId: null
    };
    DB.books.push(book);
    scheduleSave();
    cancelAddBook();
    toast('📚 Livre ajouté');
    switchTab('shelf');
  }

  /* ── Scanner ─────────────────────────────────────────────── */

  function startScanner() {
    if (scannerRunning) return;
    document.getElementById('addMethods').classList.add('hidden');
    document.getElementById('scannerSection').classList.remove('hidden');
    scannerInstance = new Html5Qrcode('reader');
    scannerRunning = true;

    scannerInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 100 } },
      async function (decoded) {
        if (!scannerRunning) return;
        stopScanner();
        toast('Code détecté — recherche en cours…');
        document.getElementById('addLoading').classList.remove('hidden');
        const data = await fetchByISBN(decoded);
        document.getElementById('addLoading').classList.add('hidden');
        document.getElementById('scannerSection').classList.add('hidden');
        showManualForm(Object.assign({ isbn: decoded }, data || {}));
        if (!data) toast('ISBN non trouvé — vérifiez les informations');
      },
      function () {}
    ).catch(function (err) {
      console.error(err);
      toast('Impossible d\'accéder à la caméra');
      stopScanner();
    });
  }

  function stopScanner() {
    if (!scannerRunning || !scannerInstance) return;
    scannerRunning = false;
    scannerInstance.stop().then(function () {
      scannerInstance.clear();
      scannerInstance = null;
    }).catch(function () {});
    document.getElementById('scannerSection').classList.add('hidden');
  }

  /* ── Students management ─────────────────────────────────── */

  function openNewClassModal() {
    document.getElementById('newClassInput').value = '';
    document.getElementById('newClassModal').classList.remove('hidden');
    setTimeout(function () { document.getElementById('newClassInput').focus(); }, 100);
  }

  function saveNewClass() {
    const name = document.getElementById('newClassInput').value.trim();
    if (!name) { toast('Nom de classe requis'); return; }
    if (DB.classes.includes(name)) { toast('Cette classe existe déjà'); return; }
    DB.classes.push(name);
    DB.classes.sort();
    scheduleSave();
    closeModal('newClassModal');
    renderStudents();
    toast('Classe ajoutée');
  }

  function deleteClass(cls) {
    const count = DB.students.filter(function (s) { return s.class === cls; }).length;
    if (count > 0 && !confirm('Supprimer la classe « ' + cls + ' » et ses ' + count + ' élève(s) ?')) return;
    DB.students = DB.students.filter(function (s) { return s.class !== cls; });
    DB.classes = DB.classes.filter(function (c) { return c !== cls; });
    scheduleSave();
    renderStudents();
    toast('Classe supprimée');
  }

  function openAddStudentModal(cls) {
    addStudentClass = cls;
    document.getElementById('addStudentTitle').textContent = 'Ajouter un élève en ' + cls;
    document.getElementById('newStudentInput').value = '';
    document.getElementById('addStudentModal').classList.remove('hidden');
    setTimeout(function () { document.getElementById('newStudentInput').focus(); }, 100);
  }

  function saveNewStudent() {
    const name = document.getElementById('newStudentInput').value.trim();
    if (!name) { toast('Nom requis'); return; }
    DB.students.push({ id: uid(), name: name, class: addStudentClass });
    DB.students.sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    scheduleSave();
    closeModal('addStudentModal');
    renderStudents();
    toast('Élève ajouté(e)');
  }

  function deleteStudent(studentId) {
    const s = DB.students.find(function (st) { return st.id === studentId; });
    if (!s || !confirm('Supprimer ' + s.name + ' ?')) return;
    DB.students = DB.students.filter(function (st) { return st.id !== studentId; });
    scheduleSave();
    renderStudents();
    toast('Élève supprimé(e)');
  }

  function openImportModal() {
    document.getElementById('importTextarea').value = '';
    document.getElementById('importModal').classList.remove('hidden');
  }

  function confirmImport() {
    const lines = document.getElementById('importTextarea').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    let added = 0;
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[,;]/).map(function (p) { return p.trim(); });
      const name = parts[0];
      const cls = parts[1] || '';
      if (!name) continue;
      if (cls && !DB.classes.includes(cls)) { DB.classes.push(cls); DB.classes.sort(); }
      DB.students.push({ id: uid(), name: name, class: cls });
      added++;
    }
    if (added) {
      DB.students.sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
      scheduleSave();
      closeModal('importModal');
      renderStudents();
      toast(added + ' élève' + (added > 1 ? 's' : '') + ' importé' + (added > 1 ? 's' : ''));
    } else {
      toast('Aucune donnée valide');
    }
  }

  /* ── Admin actions ───────────────────────────────────────── */

  async function adminToggle(username) {
    const res = await fetch('/api/admin/users/' + encodeURIComponent(username), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle-disabled' })
    });
    if (res.ok) renderAdmin(); else toast('Erreur');
  }

  async function adminDelete(username) {
    if (!confirm('Supprimer le compte de ' + username + ' ?')) return;
    const res = await fetch('/api/admin/users/' + encodeURIComponent(username), { method: 'DELETE' });
    if (res.ok) { renderAdmin(); toast('Compte supprimé'); } else toast('Erreur');
  }

  /* ── Account ─────────────────────────────────────────────── */

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
  }

  function exportData() {
    window.location.href = '/api/account/export';
  }

  async function deleteAccount() {
    if (!confirm('Supprimer votre compte ? Cette action est irréversible. Le catalogue partagé ne sera pas supprimé.')) return;
    const res = await fetch('/api/account', { method: 'DELETE' });
    if (res.ok) window.location.reload(); else toast('Erreur lors de la suppression');
  }

  /* ── Modal helpers ───────────────────────────────────────── */

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  /* ── Init ────────────────────────────────────────────────── */

  async function init() {
    const ok = await loadState();
    if (!ok) return;
    setupApp();

    /* Tab nav */
    document.querySelectorAll('.nav-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    /* Login form */
    document.getElementById('togglePasswordLogin').addEventListener('click', function () {
      document.getElementById('loginForm').classList.toggle('hidden');
    });

    document.getElementById('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      const username = document.getElementById('usernameInput').value;
      const password = document.getElementById('passwordInput').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const d = await res.json();
        document.getElementById('loginError').textContent = d.error || 'Erreur de connexion';
      }
    });

    /* Consent */
    document.getElementById('consentCheckbox').addEventListener('change', function (e) {
      document.getElementById('consentAcceptButton').disabled = !e.target.checked;
    });

    document.getElementById('consentAcceptButton').addEventListener('click', async function () {
      await fetch('/api/account/consent', { method: 'POST' });
      window.location.reload();
    });

    document.getElementById('openCgu').addEventListener('click', function () {
      document.getElementById('cguOverlay').classList.remove('hidden');
    });

    document.getElementById('closeCgu').addEventListener('click', function () {
      document.getElementById('cguOverlay').classList.add('hidden');
    });

    /* Menu */
    document.getElementById('menuBtn').addEventListener('click', function () {
      document.getElementById('menuModal').classList.remove('hidden');
    });

    /* Shelf filters */
    document.getElementById('filterGenre').addEventListener('change', renderShelf);
    document.getElementById('filterSort').addEventListener('change', renderShelf);

    /* Search */
    document.getElementById('searchInput').addEventListener('input', function (e) {
      renderSearch(e.target.value);
    });

    /* Borrower autocomplete */
    document.getElementById('borrowerInput').addEventListener('input', function (e) {
      updateAutocomplete(e.target.value);
    });

    /* Scanner / Add */
    document.getElementById('btnScan').addEventListener('click', startScanner);
    document.getElementById('btnManual').addEventListener('click', function () { showManualForm(); });
    document.getElementById('btnISBNLookup').addEventListener('click', lookupISBN);
    document.getElementById('isbnInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') lookupISBN();
    });
    document.getElementById('btnCancelAdd').addEventListener('click', cancelAddBook);
    document.getElementById('btnSaveBook').addEventListener('click', saveBook);
    document.getElementById('btnStopScanner').addEventListener('click', stopScanner);

    /* Students */
    document.getElementById('btnNewClassModal').addEventListener('click', openNewClassModal);
    document.getElementById('btnImportStudents').addEventListener('click', openImportModal);

    /* Cover URL live preview */
    document.getElementById('fCoverUrl').addEventListener('input', function (e) {
      updateCoverPreview(e.target.value);
    });

    /* Close modals on overlay click */
    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.add('hidden');
      }
    });

    /* OAuth error */
    const oauthError = new URLSearchParams(location.search).get('oauth_error');
    if (oauthError) {
      document.getElementById('loginOverlay').classList.remove('hidden');
      document.getElementById('appContainer').classList.add('hidden');
      document.getElementById('loginError').textContent = 'Erreur de connexion Google (' + oauthError + ')';
    }

    /* Enter key in modals */
    document.getElementById('newClassInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveNewClass();
    });
    document.getElementById('newStudentInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveNewStudent();
    });
  }

  /* ── Global exports (called from inline onclick) ─────────── */
  window.openBookModal = openBookModal;
  window.openLendModal = openLendModal;
  window.closeModal = closeModal;
  window.markReturned = markReturned;
  window.deleteBook = deleteBook;
  window.selectBorrower = selectBorrower;
  window.clearBorrower = clearBorrower;
  window.confirmLend = confirmLend;
  window.saveBook = saveBook;
  window.cancelAddBook = cancelAddBook;
  window.lookupISBN = lookupISBN;
  window.saveNewClass = saveNewClass;
  window.deleteClass = deleteClass;
  window.openAddStudentModal = openAddStudentModal;
  window.saveNewStudent = saveNewStudent;
  window.deleteStudent = deleteStudent;
  window.openNewClassModal = openNewClassModal;
  window.openImportModal = openImportModal;
  window.confirmImport = confirmImport;
  window.adminToggle = adminToggle;
  window.adminDelete = adminDelete;
  window.logout = logout;
  window.exportData = exportData;
  window.deleteAccount = deleteAccount;

  document.addEventListener('DOMContentLoaded', init);
})();
