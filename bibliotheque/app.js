'use strict'

/* ============================================================
   DATABASE — localStorage
   ============================================================ */

const DB = {
  KEY: 'sg-bibliotheque-v1',

  all() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]') }
    catch { return [] }
  },

  save(books) { localStorage.setItem(this.KEY, JSON.stringify(books)) },

  add(book) {
    const books = this.all()
    const entry = { ...book, id: crypto.randomUUID(), addedDate: new Date().toISOString(), lent: null }
    books.push(entry)
    this.save(books)
    return entry
  },

  update(id, updates) {
    this.save(this.all().map(b => b.id === id ? { ...b, ...updates } : b))
  },

  remove(id) { this.save(this.all().filter(b => b.id !== id)) },

  get(id) { return this.all().find(b => b.id === id) || null }
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
  let books = DB.all()
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
  const books = DB.all()
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
  const books = DB.all().filter(b => b.lent)
  const list = document.getElementById('loans-list')
  const empty = document.getElementById('loans-empty')
  const badge = document.getElementById('loans-badge')

  if (books.length) {
    badge.textContent = books.length
    badge.hidden = false
  } else {
    badge.hidden = true
  }

  if (!books.length) {
    list.innerHTML = ''
    empty.hidden = false
    return
  }

  empty.hidden = true
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

  const relancerBtn = overdue
    ? `<button class="btn-loan-action primary" onclick="sendReminder('${book.id}')">Relancer</button>`
    : ''

  return `
    <div class="loan-card" role="listitem">
      ${cover}
      <div class="loan-info">
        <div class="loan-title">${escHtml(book.title)}</div>
        <div class="loan-author">${escHtml(book.author || 'Auteur inconnu')}</div>
        <div class="loan-meta ${overdueClass}">
          Prêté à <strong>${escHtml(lent.borrower)}</strong>
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
   RENDERING — SEARCH
   ============================================================ */

function renderSearch(query) {
  const prompt = document.getElementById('search-prompt')
  const results = document.getElementById('search-results')
  const noResults = document.getElementById('search-no-results')

  if (!query.trim()) {
    prompt.hidden = false
    results.hidden = true
    noResults.hidden = true
    return
  }

  prompt.hidden = true
  const q = query.toLowerCase()
  const matches = DB.all().filter(b =>
    (b.title || '').toLowerCase().includes(q) ||
    (b.author || '').toLowerCase().includes(q) ||
    (b.genre || '').toLowerCase().includes(q) ||
    (b.isbn || '').includes(q) ||
    String(b.year || '').includes(q)
  )

  if (!matches.length) {
    results.hidden = true
    noResults.hidden = false
    return
  }

  noResults.hidden = true
  results.hidden = false
  results.innerHTML = matches.map(bookCard).join('')
}

/* ============================================================
   BOOK DETAIL MODAL
   ============================================================ */

function showBookModal(id) {
  const book = DB.get(id)
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
      Prêté à <strong>${escHtml(book.lent.borrower)}</strong>
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
   LEND MODAL
   ============================================================ */

let lendingBookId = null

function showLendModal(id) {
  lendingBookId = id
  document.getElementById('borrower-name').value = ''
  document.getElementById('reminder-days').value = '30'
  document.getElementById('lend-modal').hidden = false
  setTimeout(() => document.getElementById('borrower-name').focus(), 50)
}

function closeLendModal() {
  document.getElementById('lend-modal').hidden = true
  lendingBookId = null
}

/* ============================================================
   LOAN ACTIONS
   ============================================================ */

function markReturned(id) {
  DB.update(id, { lent: null })
  renderShelf()
  renderLoans()
  checkReminders()
  showToast('Retour enregistré !')
}

function sendReminder(id) {
  const book = DB.get(id)
  if (!book?.lent) return
  const days = daysSince(book.lent.lentDate)
  const subject = encodeURIComponent(`Rappel — "${book.title}"`)
  const body = encodeURIComponent(
    `Bonjour ${book.lent.borrower},\n\n` +
    `Je te rappelle que tu as emprunté "${book.title}" il y a ${days} jour${days > 1 ? 's' : ''}.\n` +
    `Pourrais-tu me le rendre prochainement ?\n\n` +
    `Merci !`
  )
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
}

function editBook(id) {
  const book = DB.get(id)
  if (!book) return
  switchTab('add')
  populateForm(book, true)
}

function confirmDeleteBook(id) {
  closeBookModal()
  if (confirm('Supprimer ce livre de votre bibliothèque ?')) {
    DB.remove(id)
    renderShelf()
    renderLoans()
    showToast('Livre supprimé')
  }
}

/* ============================================================
   REMINDERS CHECK
   ============================================================ */

function checkReminders() {
  const overdue = DB.all().filter(b => b.lent && daysSince(b.lent.lentDate) >= b.lent.reminderDays)
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
          <span>Prêté à ${escHtml(book.lent.borrower)} il y a ${days} jour${days > 1 ? 's' : ''}</span>
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

  if (name === 'shelf')  renderShelf()
  if (name === 'loans')  renderLoans()
  if (name === 'add')    resetAddTab()
  if (name === 'search') setTimeout(() => document.getElementById('search-input').focus(), 50)
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
  // Tab navigation
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab))
  })

  // Header quick-add button
  document.getElementById('btn-add-quick').addEventListener('click', () => switchTab('add'))

  // Scanner buttons
  document.getElementById('btn-scan').addEventListener('click', startScanner)
  document.getElementById('btn-stop-scan').addEventListener('click', stopScanner)

  // ISBN lookup
  document.getElementById('btn-isbn-search').addEventListener('click', () => {
    const isbn = document.getElementById('isbn-input').value.trim()
    if (isbn) lookupAndShowForm(isbn)
  })
  document.getElementById('isbn-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-isbn-search').click()
  })

  // Manual entry button
  document.getElementById('btn-manual').addEventListener('click', () => populateForm({}, false))

  // Form cancel
  document.getElementById('btn-form-cancel').addEventListener('click', resetAddTab)

  // Form submit
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

    if (id) {
      DB.update(id, book)
      showToast('Livre modifié !')
    } else {
      DB.add(book)
      showToast('Livre ajouté !')
    }

    resetAddTab()
    switchTab('shelf')
  })

  // Shelf filters
  document.getElementById('filter-genre').addEventListener('change', renderShelf)
  document.getElementById('filter-author').addEventListener('change', renderShelf)
  document.getElementById('sort-by').addEventListener('change', renderShelf)

  // Search
  document.getElementById('search-input').addEventListener('input', e => renderSearch(e.target.value))

  // Lend confirm
  document.getElementById('btn-confirm-lend').addEventListener('click', () => {
    const borrower = document.getElementById('borrower-name').value.trim()
    if (!borrower) {
      document.getElementById('borrower-name').focus()
      return
    }
    const days = Math.max(1, parseInt(document.getElementById('reminder-days').value) || 30)
    DB.update(lendingBookId, {
      lent: { borrower, lentDate: new Date().toISOString(), reminderDays: days }
    })
    closeLendModal()
    renderShelf()
    renderLoans()
    checkReminders()
    showToast(`Prêt enregistré pour ${borrower}`)
  })

  // Lend modal: confirm on Enter in borrower field
  document.getElementById('borrower-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-lend').click()
  })

  // Close modals on overlay click
  document.getElementById('book-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeBookModal()
  })
  document.getElementById('lend-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLendModal()
  })

  // Close modals on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeBookModal(); closeLendModal() }
  })

  // Book card keyboard activation
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('book-card')) e.target.click()
  })

  // Initial render
  renderShelf()
  renderLoans()
  checkReminders()
}

document.addEventListener('DOMContentLoaded', init)
