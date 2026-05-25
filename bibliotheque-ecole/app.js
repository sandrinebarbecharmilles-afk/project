'use strict'

/* ============================================================
   DATABASE — localStorage
   ============================================================ */

const DB = {
  BOOKS_KEY:    'sg-ecole-livres-v1',
  STUDENTS_KEY: 'sg-ecole-eleves-v1',

  /* --- Books --- */

  allBooks() {
    try { return JSON.parse(localStorage.getItem(this.BOOKS_KEY) || '[]') }
    catch { return [] }
  },

  saveBooks(books) { localStorage.setItem(this.BOOKS_KEY, JSON.stringify(books)) },

  addBook(book) {
    const books = this.allBooks()
    const entry = { ...book, id: crypto.randomUUID(), addedDate: new Date().toISOString(), lent: null }
    books.push(entry)
    this.saveBooks(books)
    return entry
  },

  updateBook(id, updates) {
    this.saveBooks(this.allBooks().map(b => b.id === id ? { ...b, ...updates } : b))
  },

  removeBook(id) { this.saveBooks(this.allBooks().filter(b => b.id !== id)) },

  getBook(id) { return this.allBooks().find(b => b.id === id) || null },

  /* --- Students --- */

  allStudents() {
    try { return JSON.parse(localStorage.getItem(this.STUDENTS_KEY) || '[]') }
    catch { return [] }
  },

  saveStudents(students) { localStorage.setItem(this.STUDENTS_KEY, JSON.stringify(students)) },

  addStudent(firstName, lastName, className) {
    const students = this.allStudents()
    const entry = {
      id: crypto.randomUUID(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      className: className.trim(),
      addedDate: new Date().toISOString()
    }
    students.push(entry)
    this.saveStudents(students)
    return entry
  },

  removeStudent(id) { this.saveStudents(this.allStudents().filter(s => s.id !== id)) },

  addClassName(name) {
    /* Classes are implicit: they exist when they have at least one student,
       or are tracked in a separate class-names list so empty classes survive. */
    const classes = this.allClassNames()
    const trimmed = name.trim()
    if (!classes.includes(trimmed)) {
      classes.push(trimmed)
      localStorage.setItem('sg-ecole-classes-v1', JSON.stringify(classes))
    }
  },

  allClassNames() {
    try { return JSON.parse(localStorage.getItem('sg-ecole-classes-v1') || '[]') }
    catch { return [] }
  },

  removeClassName(name) {
    const classes = this.allClassNames().filter(c => c !== name)
    localStorage.setItem('sg-ecole-classes-v1', JSON.stringify(classes))
  }
}

/* ============================================================
   API — Google Books + Open Library fallback
   ============================================================ */

async function fetchBookByISBN(isbn) {
  const clean = isbn.replace(/[^0-9Xx]/g, '')

  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}`)
    if (res.ok) {
      const data = await res.json()
      if (data.items?.length) {
        const vol = data.items[0].volumeInfo
        return {
          isbn: clean,
          title: vol.title || '',
          author: (vol.authors || []).join(', '),
          genre: mapGenre(vol.categories?.[0] || ''),
          year: vol.publishedDate ? parseInt(vol.publishedDate) || '' : '',
          coverUrl: (vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail || '').replace('http:', 'https:')
        }
      }
    }
  } catch { /* ignore, try fallback */ }

  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`)
    if (res.ok) {
      const data = await res.json()
      const entry = data[`ISBN:${clean}`]
      if (entry) {
        return {
          isbn: clean,
          title: entry.title || '',
          author: (entry.authors || []).map(a => a.name).join(', '),
          genre: '',
          year: entry.publish_date ? parseInt(entry.publish_date) || '' : '',
          coverUrl: entry.cover?.large || entry.cover?.medium || ''
        }
      }
    }
  } catch { /* ignore */ }

  return null
}

function mapGenre(category) {
  const c = (category || '').toLowerCase()
  if (c.includes('science fiction') || c.includes('sci-fi')) return 'Science-Fiction'
  if (c.includes('fantasy') || c.includes('magic')) return 'Fantasy'
  if (c.includes('mystery') || c.includes('thriller') || c.includes('crime') || c.includes('detective')) return 'Policier / Thriller'
  if (c.includes('biography') || c.includes('memoir') || c.includes('autobio')) return 'Biographie'
  if (c.includes('history') || c.includes('historical')) return 'Histoire'
  if (c.includes('science') || c.includes('technology') || c.includes('nature')) return 'Sciences'
  if (c.includes('self-help') || c.includes('personal development') || c.includes('motivat')) return 'Développement personnel'
  if (c.includes('child') || c.includes('young adult') || c.includes('juvenile') || c.includes('teen')) return 'Jeunesse'
  if (c.includes('comic') || c.includes('graphic novel') || c.includes('manga')) return 'Bande dessinée'
  if (c.includes('poetry') || c.includes('poem') || c.includes('poésie')) return 'Poésie'
  if (c.includes('fiction')) return 'Roman'
  return ''
}

/* ============================================================
   SCANNER
   ============================================================ */

let scanner = null
let scannerBusy = false

function startScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Scanner non disponible. Essayez la saisie manuelle.')
    return
  }

  document.getElementById('add-intro').hidden = true
  document.getElementById('scanner-wrap').hidden = false
  scannerBusy = false

  scanner = new Html5Qrcode('reader')
  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 260, height: 100 }, aspectRatio: 1.6 },
    (decodedText) => {
      if (scannerBusy) return
      scannerBusy = true
      stopScanner()
      handleISBNScanned(decodedText)
    },
    () => { /* ignore scan errors silently */ }
  ).catch(() => {
    stopScanner()
    showToast('Impossible d\'accéder à la caméra. Vérifiez les permissions.')
  })
}

function stopScanner() {
  if (scanner) {
    scanner.stop().catch(() => {})
    scanner = null
  }
  document.getElementById('scanner-wrap').hidden = true
  document.getElementById('add-intro').hidden = false
}

async function handleISBNScanned(raw) {
  showToast('Code-barres détecté !')
  await lookupAndShowForm(raw)
}

/* ============================================================
   ADD FLOW
   ============================================================ */

async function lookupAndShowForm(isbn) {
  document.getElementById('add-intro').hidden = true
  document.getElementById('api-loading').hidden = false

  const data = await fetchBookByISBN(isbn)

  document.getElementById('api-loading').hidden = true

  if (!data) {
    showToast('Livre non trouvé — saisie manuelle')
    populateForm({ isbn: isbn.replace(/[^0-9Xx]/g, '') }, false)
  } else {
    populateForm(data, false)
  }
}

function populateForm(book, isEdit) {
  document.getElementById('add-intro').hidden = true
  document.getElementById('api-loading').hidden = true
  document.getElementById('book-form').hidden = false

  document.getElementById('form-title-heading').textContent = isEdit ? 'Modifier le livre' : 'Nouveau livre'
  document.getElementById('field-id').value = book.id || ''
  document.getElementById('field-isbn').value = book.isbn || ''
  document.getElementById('field-title').value = book.title || ''
  document.getElementById('field-author').value = book.author || ''
  document.getElementById('field-year').value = book.year || ''
  document.getElementById('field-cover-url').value = book.coverUrl || ''

  const genreSelect = document.getElementById('field-genre')
  const found = [...genreSelect.options].find(o => o.value === book.genre)
  genreSelect.value = found ? book.genre : ''

  const preview = document.getElementById('form-cover-preview')
  if (book.coverUrl) {
    preview.innerHTML = `<img src="${escHtml(book.coverUrl)}" alt="Couverture" onerror="this.parentElement.innerHTML='<span>Pas de<br>couverture</span>'">`
  } else {
    preview.innerHTML = '<span>Pas de<br>couverture</span>'
  }

  document.getElementById('field-title').focus()
}

function resetAddTab() {
  document.getElementById('add-intro').hidden = false
  document.getElementById('book-form').hidden = true
  document.getElementById('api-loading').hidden = true
  document.getElementById('scanner-wrap').hidden = true
  document.getElementById('isbn-input').value = ''
}

/* ============================================================
   RENDERING — SHELF
   ============================================================ */

function renderShelf() {
  let books = DB.allBooks()
  const genre = document.getElementById('filter-genre').value
  const author = document.getElementById('filter-author').value
  const sort = document.getElementById('sort-by').value

  if (genre) books = books.filter(b => b.genre === genre)
  if (author) books = books.filter(b => b.author === author)

  books.sort((a, b) => {
    switch (sort) {
      case 'author':    return (a.author || '').localeCompare(b.author || '', 'fr')
      case 'date-desc': return new Date(b.addedDate) - new Date(a.addedDate)
      case 'date-asc':  return new Date(a.addedDate) - new Date(b.addedDate)
      default:          return (a.title || '').localeCompare(b.title || '', 'fr')
    }
  })

  const grid = document.getElementById('books-grid')
  const empty = document.getElementById('shelf-empty')

  if (!books.length) {
    grid.innerHTML = ''
    empty.hidden = false
  } else {
    empty.hidden = true
    grid.innerHTML = books.map(bookCard).join('')
  }

  rebuildFilters()
}

function bookCard(book) {
  const cover = book.coverUrl
    ? `<img class="book-cover" src="${escHtml(book.coverUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'book-cover-placeholder\\'>📚</div>'">`
    : '<div class="book-cover-placeholder" aria-hidden="true">📚</div>'

  const genre = book.genre ? `<span class="book-card-genre">${escHtml(book.genre)}</span>` : ''
  const lentBadge = book.lent ? '<span class="book-lent-badge">Prêté</span>' : ''

  return `
    <article class="book-card" onclick="showBookModal('${book.id}')" role="listitem button" tabindex="0"
             aria-label="${escHtml(book.title)} par ${escHtml(book.author || 'auteur inconnu')}">
      ${cover}
      ${lentBadge}
      <div class="book-card-info">
        <div class="book-card-title">${escHtml(book.title)}</div>
        <div class="book-card-author">${escHtml(book.author || 'Auteur inconnu')}</div>
        ${genre}
      </div>
    </article>`
}

function rebuildFilters() {
  const books = DB.allBooks()
  const genres = [...new Set(books.map(b => b.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))
  const authors = [...new Set(books.map(b => b.author).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))

  const genreEl = document.getElementById('filter-genre')
  const authorEl = document.getElementById('filter-author')
  const savedGenre = genreEl.value
  const savedAuthor = authorEl.value

  genreEl.innerHTML = '<option value="">Tous les genres</option>' +
    genres.map(g => `<option${g === savedGenre ? ' selected' : ''}>${escHtml(g)}</option>`).join('')

  authorEl.innerHTML = '<option value="">Tous les auteurs</option>' +
    authors.map(a => `<option${a === savedAuthor ? ' selected' : ''}>${escHtml(a)}</option>`).join('')
}

/* ============================================================
   RENDERING — LOANS
   ============================================================ */

function renderLoans() {
  const books = DB.allBooks().filter(b => b.lent)
  const list = document.getElementById('loans-list')
  const empty = document.getElementById('loans-empty')
  const badge = document.getElementById('loans-badge')
  const statsBar = document.getElementById('loans-stats')

  const overdueCount = books.filter(b => daysSince(b.lent.lentDate) >= b.lent.reminderDays).length

  if (books.length) {
    badge.textContent = books.length
    badge.hidden = false
  } else {
    badge.hidden = true
  }

  if (!books.length) {
    list.innerHTML = ''
    statsBar.hidden = true
    empty.hidden = false
    return
  }

  empty.hidden = true
  statsBar.hidden = false
  statsBar.innerHTML = `
    <span class="stat-chip">${books.length} prêt${books.length > 1 ? 's' : ''}</span>
    ${overdueCount > 0 ? `<span class="stat-chip overdue">${overdueCount} en retard</span>` : ''}
  `
  list.innerHTML = books.map(loanCard).join('')
}

function loanCard(book) {
  const lent = book.lent
  const days = daysSince(lent.lentDate)
  const overdue = days >= lent.reminderDays
  const overdueClass = overdue ? 'loan-overdue' : ''
  const overdueTag = overdue ? ' — ⚠️ rappel suggéré' : ''

  const cover = book.coverUrl
    ? `<div class="loan-cover"><img src="${escHtml(book.coverUrl)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='📚'"></div>`
    : '<div class="loan-cover" aria-hidden="true">📚</div>'

  const classChip = lent.studentClass
    ? `<span class="loan-student-class">${escHtml(lent.studentClass)}</span>`
    : ''

  const relancerBtn = overdue
    ? `<button class="btn-loan-action primary" onclick="sendReminder('${book.id}')">Relancer</button>`
    : ''

  return `
    <div class="loan-card" role="listitem">
      ${cover}
      <div class="loan-info">
        <div class="loan-title">${escHtml(book.title)}</div>
        <div class="loan-author">${escHtml(book.author || 'Auteur inconnu')}</div>
        ${classChip}
        <div class="loan-meta ${overdueClass}">
          Prêté à <strong>${escHtml(lent.studentName)}</strong>
          il y a ${days} jour${days > 1 ? 's' : ''}${overdueTag}
        </div>
        <div class="loan-actions">
          ${relancerBtn}
          <button class="btn-loan-action" onclick="markReturned('${book.id}')">Retour ✓</button>
          <button class="btn-loan-action" onclick="showBookModal('${book.id}')">Détails</button>
        </div>
      </div>
    </div>`
}

/* ============================================================
   RENDERING — STUDENTS
   ============================================================ */

function renderStudents() {
  const students = DB.allStudents()
  const classNames = DB.allClassNames()

  // Build a combined set of class names: from the explicit list + from students
  const allClassNames = [...new Set([
    ...classNames,
    ...students.map(s => s.className)
  ])].sort((a, b) => a.localeCompare(b, 'fr'))

  const container = document.getElementById('classes-list')
  const emptyEl = document.getElementById('students-empty')

  if (!allClassNames.length) {
    container.innerHTML = ''
    emptyEl.hidden = false
    return
  }

  emptyEl.hidden = true
  container.innerHTML = allClassNames.map(cls => {
    const clsStudents = students.filter(s => s.className === cls)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))

    const rows = clsStudents.map(s => `
      <li class="student-row">
        <span class="student-row-name">${escHtml(s.firstName)} ${escHtml(s.lastName)}</span>
        <button class="btn-delete-student" onclick="confirmDeleteStudent('${s.id}')" aria-label="Supprimer ${escHtml(s.firstName)} ${escHtml(s.lastName)}">✕</button>
      </li>`).join('')

    return `
      <div class="class-section">
        <div class="class-section-header">
          <span class="class-section-title">${escHtml(cls)}<span class="class-count">— ${clsStudents.length} élève${clsStudents.length !== 1 ? 's' : ''}</span></span>
          <button class="btn-add-student" onclick="openStudentModal('${escHtml(cls)}')">+ Élève</button>
        </div>
        <ul class="student-list">
          ${rows || '<li class="student-row"><span class="student-row-name" style="color:var(--light);font-style:italic">Aucun élève</span></li>'}
        </ul>
      </div>`
  }).join('')
}

/* ============================================================
   BOOK DETAIL MODAL
   ============================================================ */

function showBookModal(id) {
  const book = DB.getBook(id)
  if (!book) return

  const content = document.getElementById('book-modal-content')

  const cover = book.coverUrl
    ? `<img class="book-detail-cover" src="${escHtml(book.coverUrl)}" alt="Couverture de ${escHtml(book.title)}" onerror="this.outerHTML='<div class=\\'book-detail-cover-placeholder\\' aria-hidden=\\'true\\'>📚</div>'">`
    : '<div class="book-detail-cover-placeholder" aria-hidden="true">📚</div>'

  const chips = [
    book.genre && `<span class="meta-chip">${escHtml(book.genre)}</span>`,
    book.year && `<span class="meta-chip">${book.year}</span>`,
    book.isbn && `<span class="meta-chip">ISBN ${escHtml(book.isbn)}</span>`
  ].filter(Boolean).join('')

  const lentBlock = book.lent ? `
    <div class="book-detail-lent-info">
      Prêté à <strong>${escHtml(book.lent.studentName)}</strong>
      ${book.lent.studentClass ? `(${escHtml(book.lent.studentClass)})` : ''}
      le ${formatDate(book.lent.lentDate)}<br>
      (il y a ${daysSince(book.lent.lentDate)} jour${daysSince(book.lent.lentDate) > 1 ? 's' : ''})
    </div>` : ''

  const primaryAction = book.lent
    ? `<button class="btn-primary" onclick="markReturned('${id}');closeBookModal()">Marquer comme rendu</button>`
    : `<button class="btn-primary" onclick="closeBookModal();showLendModal('${id}')">Prêter ce livre</button>`

  content.innerHTML = `
    ${cover}
    <h2 class="book-detail-title">${escHtml(book.title)}</h2>
    <p class="book-detail-author">${escHtml(book.author || 'Auteur inconnu')}</p>
    ${chips ? `<div class="book-detail-meta">${chips}</div>` : ''}
    ${lentBlock}
    <div class="book-detail-actions">
      ${primaryAction}
      <button class="btn-secondary" onclick="closeBookModal();editBook('${id}')">Modifier</button>
      <button class="btn-danger" onclick="confirmDeleteBook('${id}')">Supprimer</button>
    </div>`

  document.getElementById('book-modal').hidden = false
}

function closeBookModal() {
  document.getElementById('book-modal').hidden = true
}

/* ============================================================
   LEND MODAL — with student autocomplete
   ============================================================ */

let lendingBookId = null
let selectedStudent = null   // { id, firstName, lastName, className } | null (free-form)
let acSelectedIdx = -1

function showLendModal(id) {
  lendingBookId = id
  selectedStudent = null
  acSelectedIdx = -1

  const chip = document.getElementById('borrower-chip')
  const input = document.getElementById('borrower-input')
  chip.hidden = true
  chip.innerHTML = ''
  input.value = ''
  input.hidden = false
  document.getElementById('autocomplete-list').hidden = true
  document.getElementById('reminder-days').value = '14'
  document.getElementById('lend-modal').hidden = false
  setTimeout(() => input.focus(), 50)
}

function closeLendModal() {
  document.getElementById('lend-modal').hidden = true
  document.getElementById('autocomplete-list').hidden = true
  lendingBookId = null
  selectedStudent = null
}

function setBorrowerChip(student) {
  selectedStudent = student
  const chip = document.getElementById('borrower-chip')
  const input = document.getElementById('borrower-input')

  chip.innerHTML = `
    <span>${escHtml(student.firstName)} ${escHtml(student.lastName)} — ${escHtml(student.className)}</span>
    <button class="borrower-chip-remove" onclick="clearBorrowerChip()" aria-label="Effacer">×</button>
  `
  chip.hidden = false
  input.hidden = true
  input.value = ''
  document.getElementById('autocomplete-list').hidden = true
}

function clearBorrowerChip() {
  selectedStudent = null
  const chip = document.getElementById('borrower-chip')
  const input = document.getElementById('borrower-input')
  chip.hidden = true
  chip.innerHTML = ''
  input.hidden = false
  input.value = ''
  input.focus()
}

function renderAutocomplete(query) {
  const list = document.getElementById('autocomplete-list')

  if (!query.trim()) {
    list.hidden = true
    acSelectedIdx = -1
    return
  }

  const q = query.toLowerCase()
  const students = DB.allStudents()
  const matches = students.filter(s =>
    s.firstName.toLowerCase().includes(q) ||
    s.lastName.toLowerCase().includes(q) ||
    s.className.toLowerCase().includes(q)
  ).slice(0, 8)

  if (!matches.length) {
    list.hidden = true
    acSelectedIdx = -1
    return
  }

  acSelectedIdx = -1
  list.hidden = false
  list.innerHTML = matches.map((s, i) => `
    <li class="autocomplete-item"
        role="option"
        aria-selected="false"
        data-idx="${i}"
        onmousedown="selectAutocompleteStudent(${i})">
      <span>${escHtml(s.firstName)} ${escHtml(s.lastName)}</span>
      <span class="autocomplete-item-class">${escHtml(s.className)}</span>
    </li>`
  ).join('')

  list._matches = matches
}

function selectAutocompleteStudent(idx) {
  const list = document.getElementById('autocomplete-list')
  const matches = list._matches || []
  const student = matches[idx]
  if (!student) return
  setBorrowerChip(student)
}

/* ============================================================
   LOAN ACTIONS
   ============================================================ */

function markReturned(id) {
  DB.updateBook(id, { lent: null })
  renderShelf()
  renderLoans()
  checkReminders()
  showToast('Retour enregistré !')
}

function sendReminder(id) {
  const book = DB.getBook(id)
  if (!book?.lent) return
  const days = daysSince(book.lent.lentDate)
  const studentName = book.lent.studentName
  const subject = encodeURIComponent(`Rappel — "${book.title}"`)
  const body = encodeURIComponent(
    `Bonjour ${studentName},\n\n` +
    `Je te rappelle que tu as emprunté "${book.title}" il y a ${days} jour${days > 1 ? 's' : ''}.\n` +
    `Merci de me le rapporter dès que possible.\n\n` +
    `Cordialement`
  )
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
}

function editBook(id) {
  const book = DB.getBook(id)
  if (!book) return
  switchTab('add')
  populateForm(book, true)
}

function confirmDeleteBook(id) {
  closeBookModal()
  if (confirm('Supprimer ce livre du catalogue ?')) {
    DB.removeBook(id)
    renderShelf()
    renderLoans()
    showToast('Livre supprimé')
  }
}

function confirmDeleteStudent(id) {
  const students = DB.allStudents()
  const student = students.find(s => s.id === id)
  if (!student) return
  if (confirm(`Supprimer ${student.firstName} ${student.lastName} de la liste ?`)) {
    DB.removeStudent(id)
    renderStudents()
    showToast('Élève supprimé')
  }
}

/* ============================================================
   CLASS MODAL
   ============================================================ */

function openClassModal() {
  document.getElementById('class-name-input').value = ''
  document.getElementById('class-modal').hidden = false
  setTimeout(() => document.getElementById('class-name-input').focus(), 50)
}

function closeClassModal() {
  document.getElementById('class-modal').hidden = true
}

/* ============================================================
   STUDENT MODAL
   ============================================================ */

function openStudentModal(className) {
  document.getElementById('student-modal-class').value = className
  document.getElementById('student-modal-title').textContent = `Ajouter un élève — ${className}`
  document.getElementById('student-firstname').value = ''
  document.getElementById('student-lastname').value = ''
  document.getElementById('student-modal').hidden = false
  setTimeout(() => document.getElementById('student-firstname').focus(), 50)
}

function closeStudentModal() {
  document.getElementById('student-modal').hidden = true
}

/* ============================================================
   IMPORT MODAL
   ============================================================ */

function openImportModal() {
  document.getElementById('import-json').value = ''
  document.getElementById('import-modal').hidden = false
}

function closeImportModal() {
  document.getElementById('import-modal').hidden = true
}

function doImport() {
  const raw = document.getElementById('import-json').value.trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    showToast('JSON invalide. Vérifiez le format.')
    return
  }

  if (!parsed || !Array.isArray(parsed.classes)) {
    showToast('Format incorrect. Attendu : {"version":1,"classes":[…]}')
    return
  }

  let added = 0
  for (const cls of parsed.classes) {
    if (!cls.nom) continue
    DB.addClassName(cls.nom)
    const eleves = Array.isArray(cls['élèves']) ? cls['élèves'] : []
    for (const e of eleves) {
      if (e['prénom'] && e['nom']) {
        DB.addStudent(e['prénom'], e['nom'], cls.nom)
        added++
      }
    }
  }

  closeImportModal()
  renderStudents()
  showToast(`${added} élève${added > 1 ? 's' : ''} importé${added > 1 ? 's' : ''} !`)
}

function doExport() {
  const students = DB.allStudents()
  const classNames = DB.allClassNames()

  const allClassNames = [...new Set([
    ...classNames,
    ...students.map(s => s.className)
  ])].sort((a, b) => a.localeCompare(b, 'fr'))

  const out = {
    version: 1,
    classes: allClassNames.map(cls => ({
      nom: cls,
      'élèves': students
        .filter(s => s.className === cls)
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr'))
        .map(s => ({ 'prénom': s.firstName, 'nom': s.lastName }))
    }))
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `eleves-${new Date().toISOString().slice(0,10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* ============================================================
   REMINDERS CHECK
   ============================================================ */

function checkReminders() {
  const overdue = DB.allBooks().filter(b => b.lent && daysSince(b.lent.lentDate) >= b.lent.reminderDays)
  const banner = document.getElementById('reminder-banner')

  if (!overdue.length) {
    banner.hidden = true
    return
  }

  banner.hidden = false
  banner.innerHTML = overdue.map(book => {
    const days = daysSince(book.lent.lentDate)
    return `
      <div class="reminder-item">
        <div class="reminder-item-info">
          <strong>${escHtml(book.title)}</strong>
          <span>Prêté à ${escHtml(book.lent.studentName)} (${escHtml(book.lent.studentClass || '')}) il y a ${days} jour${days > 1 ? 's' : ''}</span>
        </div>
        <div class="reminder-item-actions">
          <button class="btn-reminder solid" onclick="sendReminder('${book.id}')">Relancer</button>
          <button class="btn-reminder" onclick="markReturned('${book.id}')">Rendu ✓</button>
        </div>
      </div>`
  }).join('')
}

/* ============================================================
   NAVIGATION
   ============================================================ */

function switchTab(name) {
  if (name !== 'add' && scanner) stopScanner()

  document.querySelectorAll('.nav-tab').forEach(t => {
    const active = t.dataset.tab === name
    t.classList.toggle('active', active)
    t.setAttribute('aria-selected', String(active))
  })

  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${name}`)
  })

  if (name === 'shelf')    renderShelf()
  if (name === 'loans')    renderLoans()
  if (name === 'students') renderStudents()
  if (name === 'add')      resetAddTab()
}

/* ============================================================
   UTILITIES
   ============================================================ */

function daysSince(isoDate) {
  return Math.max(0, Math.floor((Date.now() - new Date(isoDate)) / 86400000))
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function escHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

let toastTimer = null

function showToast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.hidden = false
  el.style.animation = 'none'
  void el.offsetHeight
  el.style.animation = ''
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 3100)
}

/* ============================================================
   INIT
   ============================================================ */

function init() {
  /* Tab navigation */
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab))
  })

  /* Header quick-add button */
  document.getElementById('btn-add-quick').addEventListener('click', () => switchTab('add'))

  /* Scanner buttons */
  document.getElementById('btn-scan').addEventListener('click', startScanner)
  document.getElementById('btn-stop-scan').addEventListener('click', stopScanner)

  /* ISBN lookup */
  document.getElementById('btn-isbn-search').addEventListener('click', () => {
    const isbn = document.getElementById('isbn-input').value.trim()
    if (isbn) lookupAndShowForm(isbn)
  })
  document.getElementById('isbn-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-isbn-search').click()
  })

  /* Manual entry button */
  document.getElementById('btn-manual').addEventListener('click', () => populateForm({}, false))

  /* Form cancel */
  document.getElementById('btn-form-cancel').addEventListener('click', resetAddTab)

  /* Form submit */
  document.getElementById('book-form').addEventListener('submit', e => {
    e.preventDefault()
    const id = document.getElementById('field-id').value
    const book = {
      isbn:     document.getElementById('field-isbn').value,
      title:    document.getElementById('field-title').value.trim(),
      author:   document.getElementById('field-author').value.trim(),
      genre:    document.getElementById('field-genre').value,
      year:     document.getElementById('field-year').value ? parseInt(document.getElementById('field-year').value) : '',
      coverUrl: document.getElementById('field-cover-url').value
    }

    if (!book.title) {
      document.getElementById('field-title').focus()
      return
    }

    if (id) {
      DB.updateBook(id, book)
      showToast('Livre modifié !')
    } else {
      DB.addBook(book)
      showToast('Livre ajouté !')
    }

    resetAddTab()
    switchTab('shelf')
  })

  /* Shelf filters */
  document.getElementById('filter-genre').addEventListener('change', renderShelf)
  document.getElementById('filter-author').addEventListener('change', renderShelf)
  document.getElementById('sort-by').addEventListener('change', renderShelf)

  /* Lend confirm */
  document.getElementById('btn-confirm-lend').addEventListener('click', () => {
    const input = document.getElementById('borrower-input')
    const days = Math.max(1, parseInt(document.getElementById('reminder-days').value) || 14)

    let studentName, studentClass, studentId

    if (selectedStudent) {
      studentName  = `${selectedStudent.firstName} ${selectedStudent.lastName}`
      studentClass = selectedStudent.className
      studentId    = selectedStudent.id
    } else {
      const freeform = input.value.trim()
      if (!freeform) {
        input.focus()
        return
      }
      studentName  = freeform
      studentClass = ''
      studentId    = null
    }

    DB.updateBook(lendingBookId, {
      lent: {
        studentId,
        studentName,
        studentClass,
        lentDate: new Date().toISOString(),
        reminderDays: days
      }
    })
    closeLendModal()
    renderShelf()
    renderLoans()
    checkReminders()
    showToast(`Prêt enregistré pour ${studentName}`)
  })

  /* Autocomplete input events */
  document.getElementById('borrower-input').addEventListener('input', e => {
    renderAutocomplete(e.target.value)
  })

  document.getElementById('borrower-input').addEventListener('keydown', e => {
    const list = document.getElementById('autocomplete-list')
    const items = list.querySelectorAll('.autocomplete-item')
    const matches = list._matches || []

    if (list.hidden || !items.length) {
      if (e.key === 'Enter') document.getElementById('btn-confirm-lend').click()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      acSelectedIdx = Math.min(acSelectedIdx + 1, items.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      acSelectedIdx = Math.max(acSelectedIdx - 1, -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (acSelectedIdx >= 0 && matches[acSelectedIdx]) {
        selectAutocompleteStudent(acSelectedIdx)
      } else {
        document.getElementById('btn-confirm-lend').click()
      }
      return
    } else if (e.key === 'Escape') {
      list.hidden = true
      acSelectedIdx = -1
      return
    }

    items.forEach((it, i) => {
      it.setAttribute('aria-selected', String(i === acSelectedIdx))
    })
  })

  /* New class button */
  document.getElementById('btn-new-class').addEventListener('click', openClassModal)

  /* Confirm new class */
  document.getElementById('btn-confirm-class').addEventListener('click', () => {
    const name = document.getElementById('class-name-input').value.trim()
    if (!name) {
      document.getElementById('class-name-input').focus()
      return
    }
    DB.addClassName(name)
    closeClassModal()
    renderStudents()
    showToast(`Classe "${name}" créée`)
  })

  document.getElementById('class-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-class').click()
  })

  /* Confirm new student */
  document.getElementById('btn-confirm-student').addEventListener('click', () => {
    const firstName = document.getElementById('student-firstname').value.trim()
    const lastName  = document.getElementById('student-lastname').value.trim()
    const className = document.getElementById('student-modal-class').value
    if (!firstName || !lastName) {
      if (!firstName) document.getElementById('student-firstname').focus()
      else document.getElementById('student-lastname').focus()
      return
    }
    DB.addStudent(firstName, lastName, className)
    closeStudentModal()
    renderStudents()
    showToast(`${firstName} ${lastName} ajouté(e)`)
  })

  document.getElementById('student-lastname').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-student').click()
  })

  /* Import / Export */
  document.getElementById('btn-import-students').addEventListener('click', openImportModal)
  document.getElementById('btn-export-students').addEventListener('click', doExport)
  document.getElementById('btn-confirm-import').addEventListener('click', doImport)

  /* Close modals on overlay click */
  document.getElementById('book-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeBookModal()
  })
  document.getElementById('lend-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLendModal()
  })
  document.getElementById('class-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeClassModal()
  })
  document.getElementById('student-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeStudentModal()
  })
  document.getElementById('import-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeImportModal()
  })

  /* Close modals on Escape */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeBookModal()
      closeLendModal()
      closeClassModal()
      closeStudentModal()
      closeImportModal()
    }
  })

  /* Book card keyboard activation */
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('book-card')) e.target.click()
  })

  /* Autocomplete: close when clicking outside */
  document.addEventListener('click', e => {
    const list = document.getElementById('autocomplete-list')
    const wrap = document.querySelector('.autocomplete-wrap')
    if (wrap && !wrap.contains(e.target)) {
      list.hidden = true
      acSelectedIdx = -1
    }
  })

  /* Initial render */
  renderShelf()
  renderLoans()
  checkReminders()
}

document.addEventListener('DOMContentLoaded', init)
