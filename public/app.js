// ---------- STATE ----------
const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
};
const app = document.getElementById('app');
const nav = document.getElementById('nav');

function saveAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
}
function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  location.hash = '#/login';
}

// ---------- API HELPER ----------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.details ? `${data.error}: ${data.details.join(', ')}` : (data.error || 'Request failed'));
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(d) { try { return new Date(d).toLocaleDateString(); } catch { return d; } }

// ---------- NAV ----------
function renderNav() {
  if (!state.user) { nav.innerHTML = ''; return; }
  const links = state.user.role === 'buyer'
    ? [['#/my-rfqs', 'My RFQs'], ['#/new-rfq', '+ New RFQ']]
    : [['#/browse', 'Browse RFQs'], ['#/my-quotes', 'My Quotations']];
  nav.innerHTML = links.map(([h, t]) => `<a href="${h}" class="btn secondary" style="text-decoration:none;padding:7px 12px;">${t}</a>`).join('')
    + `<span class="muted">${esc(state.user.name)} (${state.user.role})</span>`
    + `<button id="logoutBtn">Logout</button>`;
  document.getElementById('logoutBtn').onclick = logout;
}

// ---------- ROUTER ----------
const routes = {
  '#/login': renderLogin,
  '#/signup': renderSignup,
  '#/my-rfqs': requireRole('buyer', renderMyRfqs),
  '#/new-rfq': requireRole('buyer', renderNewRfq),
  '#/browse': requireRole('supplier', renderBrowse),
  '#/my-quotes': requireRole('supplier', renderMyQuotes),
};
function requireRole(role, fn) {
  return () => {
    if (!state.user) return (location.hash = '#/login');
    if (state.user.role !== role) return (location.hash = state.user.role === 'buyer' ? '#/my-rfqs' : '#/browse');
    fn();
  };
}
function router() {
  renderNav();
  let hash = location.hash || (state.user ? (state.user.role === 'buyer' ? '#/my-rfqs' : '#/browse') : '#/login');
  if (hash.startsWith('#/rfq/')) return renderRfqDetail(hash.split('/')[2]);
  const fn = routes[hash] || routes['#/login'];
  fn();
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

// ---------- AUTH VIEWS ----------
function renderLogin() {
  app.innerHTML = `
  <div class="card form-card">
    <h2>Log in</h2>
    <form id="loginForm">
      <label>Email</label><input type="email" name="email" required>
      <label>Password</label><input type="password" name="password" required>
      <div class="error" id="err"></div>
      <div class="actions"><button type="submit">Log in</button></div>
    </form>
    <p class="muted">No account? <a href="#/signup">Sign up</a></p>
  </div>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('err'); errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      saveAuth(data.token, data.user);
      location.hash = data.user.role === 'buyer' ? '#/my-rfqs' : '#/browse';
      router();
    } catch (err) { errEl.textContent = err.message; }
  };
}

function renderSignup() {
  app.innerHTML = `
  <div class="card form-card">
    <h2>Create account</h2>
    <form id="signupForm">
      <label>Full name</label><input name="name" required>
      <label>Email</label><input type="email" name="email" required>
      <label>Password (min 6 chars)</label><input type="password" name="password" required minlength="6">
      <label>I am a</label>
      <select name="role"><option value="buyer">Buyer</option><option value="supplier">Supplier</option></select>
      <div class="error" id="err"></div>
      <div class="actions"><button type="submit">Sign up</button></div>
    </form>
    <p class="muted">Already have an account? <a href="#/login">Log in</a></p>
  </div>`;
  document.getElementById('signupForm').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('err'); errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/signup', { method: 'POST', body: {
        name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), role: fd.get('role')
      }});
      saveAuth(data.token, data.user);
      location.hash = data.user.role === 'buyer' ? '#/my-rfqs' : '#/browse';
      router();
    } catch (err) { errEl.textContent = err.message; }
  };
}

// ---------- BUYER VIEWS ----------
async function renderMyRfqs() {
  app.innerHTML = `<h2>My RFQs</h2><div id="list" class="loading">Loading...</div>`;
  const list = document.getElementById('list');
  try {
    const rfqs = await api('/api/rfqs');
    if (!rfqs.length) return (list.innerHTML = `<div class="empty">You haven't posted any RFQs yet. <a href="#/new-rfq">Create one</a>.</div>`);
    list.className = '';
    list.innerHTML = rfqs.map(r => `
      <div class="card">
        <span class="tag ${r.status}">${r.status.toUpperCase()}</span>
        <p class="rfq-title">${esc(r.product_name)}</p>
        <p class="muted">Qty: ${r.quantity} &middot; Location: ${esc(r.delivery_location)} &middot; Deadline: ${fmtDate(r.deadline)}</p>
        <p>${esc(r.description)}</p>
        <div class="actions">
          <a class="btn secondary" href="#/rfq/${r.id}" style="text-decoration:none;">View Quotations</a>
          <button class="secondary" data-edit="${r.id}">Edit</button>
          <button class="danger" data-del="${r.id}">Delete</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => renderEditRfq(b.dataset.edit, rfqs.find(r => r.id == b.dataset.edit)));
    list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this RFQ?')) return;
      try { await api(`/api/rfqs/${b.dataset.del}`, { method: 'DELETE' }); renderMyRfqs(); }
      catch (err) { alert(err.message); }
    });
  } catch (err) { list.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

function rfqFormFields(r = {}) {
  return `
    <label>Product/Service name</label><input name="product_name" required value="${esc(r.product_name || '')}">
    <label>Requirement description</label><textarea name="description" rows="4" required>${esc(r.description || '')}</textarea>
    <div class="row">
      <div><label>Quantity</label><input type="number" name="quantity" min="1" required value="${r.quantity || ''}"></div>
      <div><label>Delivery location</label><input name="delivery_location" required value="${esc(r.delivery_location || '')}"></div>
    </div>
    <label>Deadline</label><input type="date" name="deadline" required value="${r.deadline ? r.deadline.slice(0,10) : ''}">`;
}

function renderNewRfq() {
  app.innerHTML = `<div class="card form-card"><h2>New RFQ</h2><form id="f">${rfqFormFields()}
    <div class="error" id="err"></div>
    <div class="actions"><button type="submit">Post RFQ</button></div></form></div>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('err'); errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      await api('/api/rfqs', { method: 'POST', body: Object.fromEntries(fd) });
      location.hash = '#/my-rfqs'; router();
    } catch (err) { errEl.textContent = err.message; }
  };
}

function renderEditRfq(id, rfq) {
  app.innerHTML = `<div class="card form-card"><h2>Edit RFQ</h2><form id="f">${rfqFormFields(rfq)}
    <label>Status</label><select name="status"><option value="open" ${rfq.status==='open'?'selected':''}>Open</option><option value="closed" ${rfq.status==='closed'?'selected':''}>Closed</option></select>
    <div class="error" id="err"></div>
    <div class="actions"><button type="submit">Save changes</button><button type="button" class="secondary" id="cancel">Cancel</button></div></form></div>`;
  document.getElementById('cancel').onclick = renderMyRfqs;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('err'); errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      await api(`/api/rfqs/${id}`, { method: 'PUT', body: Object.fromEntries(fd) });
      renderMyRfqs();
    } catch (err) { errEl.textContent = err.message; }
  };
}

async function renderRfqDetail(id) {
  app.innerHTML = `<div id="d" class="loading">Loading...</div>`;
  const d = document.getElementById('d');
  try {
    const rfq = await api(`/api/rfqs/${id}`);
    let quotesHtml = '';
    if (state.user.role === 'buyer') {
      const quotes = await api(`/api/rfqs/${id}/quotations`);
      quotesHtml = quotes.length
        ? `<table><thead><tr><th>Supplier</th><th>Price</th><th>Delivery</th><th>Notes</th></tr></thead><tbody>
            ${quotes.map(q => `<tr><td>${esc(q.supplier_name)}<br><span class="muted">${esc(q.supplier_email)}</span></td><td>₹${q.price}</td><td>${esc(q.delivery_time)}</td><td>${esc(q.notes || '-')}</td></tr>`).join('')}
           </tbody></table>`
        : `<div class="empty">No quotations received yet.</div>`;
    } else {
      quotesHtml = `<form id="qf">
        <label>Quoted price (₹)</label><input type="number" name="price" min="0.01" step="0.01" required>
        <label>Estimated delivery time</label><input name="delivery_time" placeholder="e.g. 7 days" required>
        <label>Message / notes</label><textarea name="notes" rows="3"></textarea>
        <div class="error" id="qerr"></div>
        <div class="actions"><button type="submit" ${rfq.status !== 'open' ? 'disabled' : ''}>Submit quotation</button></div>
      </form>`;
    }
    d.className = '';
    d.innerHTML = `
      <div class="card">
        <span class="tag ${rfq.status}">${rfq.status.toUpperCase()}</span>
        <p class="rfq-title">${esc(rfq.product_name)}</p>
        <p class="muted">Buyer: ${esc(rfq.buyer_name || '')} &middot; Qty: ${rfq.quantity} &middot; Location: ${esc(rfq.delivery_location)} &middot; Deadline: ${fmtDate(rfq.deadline)}</p>
        <p>${esc(rfq.description)}</p>
      </div>
      <div class="card"><h3>${state.user.role === 'buyer' ? 'Quotations received' : 'Submit a quotation'}</h3>${quotesHtml}</div>
    `;
    if (state.user.role === 'supplier') {
      const qf = document.getElementById('qf');
      if (qf) qf.onsubmit = async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('qerr'); errEl.textContent = '';
        const fd = new FormData(e.target);
        try {
          await api(`/api/rfqs/${id}/quotations`, { method: 'POST', body: Object.fromEntries(fd) });
          location.hash = '#/my-quotes'; router();
        } catch (err) { errEl.textContent = err.message; }
      };
    }
  } catch (err) { d.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// ---------- SUPPLIER VIEWS ----------
async function renderBrowse() {
  app.innerHTML = `
    <h2>Browse RFQs</h2>
    <div class="filters">
      <input id="search" placeholder="Search product or description...">
      <input id="location" placeholder="Filter by delivery location...">
    </div>
    <div id="list" class="loading">Loading...</div>`;
  const list = document.getElementById('list');
  async function load() {
    list.className = 'loading'; list.textContent = 'Loading...';
    const params = new URLSearchParams({ search: document.getElementById('search').value, location: document.getElementById('location').value });
    try {
      const rfqs = await api(`/api/rfqs?${params}`);
      if (!rfqs.length) return (list.innerHTML = `<div class="empty">No open RFQs match your search.</div>`);
      list.className = '';
      list.innerHTML = rfqs.map(r => `
        <div class="card">
          <p class="rfq-title">${esc(r.product_name)}</p>
          <p class="muted">Buyer: ${esc(r.buyer_name)} &middot; Qty: ${r.quantity} &middot; Location: ${esc(r.delivery_location)} &middot; Deadline: ${fmtDate(r.deadline)}</p>
          <p>${esc(r.description.slice(0, 140))}${r.description.length > 140 ? '…' : ''}</p>
          <div class="actions"><a class="btn" href="#/rfq/${r.id}" style="text-decoration:none;">View & Quote</a></div>
        </div>`).join('');
    } catch (err) { list.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
  }
  document.getElementById('search').oninput = debounce(load, 300);
  document.getElementById('location').oninput = debounce(load, 300);
  load();
}

async function renderMyQuotes() {
  app.innerHTML = `<h2>My Quotations</h2><div id="list" class="loading">Loading...</div>`;
  const list = document.getElementById('list');
  try {
    const quotes = await api('/api/quotations/mine');
    if (!quotes.length) return (list.innerHTML = `<div class="empty">You haven't submitted any quotations yet. <a href="#/browse">Browse RFQs</a>.</div>`);
    list.className = '';
    list.innerHTML = quotes.map(q => `
      <div class="card">
        <span class="tag ${q.rfq_status}">${q.rfq_status.toUpperCase()}</span>
        <p class="rfq-title">${esc(q.product_name)}</p>
        <p class="muted">Your price: ₹${q.price} &middot; Delivery: ${esc(q.delivery_time)} &middot; Deadline: ${fmtDate(q.deadline)}</p>
        <p>${esc(q.notes || '')}</p>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
