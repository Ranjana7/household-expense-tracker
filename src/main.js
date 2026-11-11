import './style.css';

const CATEGORY_OPTIONS = ['Groceries', 'Utilities', 'Transport', 'Dining', 'Health', 'Shopping', 'Home', 'Kids', 'Other'];
const LOCALE = 'en-IE';
const CURRENCY = 'EUR';
const TOKEN_KEY = 'expense_tracker_token';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  profile: null,
  household: null,
  inviteCode: '',
  budget: 0,
  members: [],
  expenses: [],
  editingExpenseId: null,
  filters: { search: '', category: '', paidBy: '', month: '' },
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(apiUrl(path), { ...options, headers });
  let body = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }
  if (!response.ok) {
    const message = body?.error || body?.message || 'Request failed';
    throw new Error(message);
  }
  return body;
}

function renderShell() {
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <section id="toast" class="card hidden"></section>
      <section id="authView" class="card">
        <h1>Household Expense Tracker</h1>
        <p class="muted">Secure self-hosted expense tracker for two household members.</p>
        <div class="split">
          <form id="signInForm" class="stack">
            <h2>Sign in</h2>
            <label>Email<input name="email" type="email" required autocomplete="email" /></label>
            <label>Password<input name="password" type="password" required autocomplete="current-password" /></label>
            <button type="submit">Sign in</button>
          </form>
          <form id="signUpForm" class="stack">
            <h2>Create account</h2>
            <label>Name<input name="displayName" type="text" required maxlength="80" /></label>
            <label>Email<input name="email" type="email" required autocomplete="email" /></label>
            <label>Password<input name="password" type="password" required minlength="8" autocomplete="new-password" /></label>
            <button type="submit">Create account</button>
          </form>
        </div>
      </section>

      <section id="onboardingView" class="hidden">
        <div class="card">
          <h2>Set up your household</h2>
          <p class="muted">Create a new household or join an existing one with invite code.</p>
          <div class="split">
            <form id="createHouseholdForm" class="stack">
              <h3>Create household</h3>
              <label>Household name<input name="name" required maxlength="100" /></label>
              <label>Monthly budget (EUR)<input name="budget" type="number" min="0" step="0.01" value="0" /></label>
              <button type="submit">Create</button>
            </form>
            <form id="joinHouseholdForm" class="stack">
              <h3>Join household</h3>
              <label>Invite code<input name="code" required maxlength="20" /></label>
              <button type="submit">Join</button>
            </form>
          </div>
        </div>
      </section>

      <section id="appView" class="hidden">
        <div class="card topbar">
          <div>
            <h2 id="householdTitle"></h2>
            <p class="muted">
              Signed in as <strong id="signedInName"></strong>. Invite code: <code id="inviteCodeText"></code>
            </p>
          </div>
          <button id="signOutButton" class="secondary">Sign out</button>
        </div>

        <div class="grid cards4">
          <article class="card stat"><p class="muted">This month total</p><h3 id="monthTotal">€0.00</h3></article>
          <article class="card stat"><p class="muted">Monthly budget</p><h3 id="budgetValue">€0.00</h3></article>
          <article class="card stat"><p class="muted">Budget status</p><h3 id="budgetStatus">On track</h3></article>
          <article class="card stat"><p class="muted">Entries this month</p><h3 id="entryCount">0</h3></article>
        </div>

        <section class="card">
          <h3>Budget progress</h3>
          <div class="progress"><span id="budgetProgressBar"></span></div>
          <p class="muted" id="budgetDetail"></p>
          <form id="budgetForm" class="inline-form">
            <label>Set monthly budget (EUR)<input name="budget" type="number" min="0" step="0.01" required /></label>
            <button type="submit">Save budget</button>
          </form>
        </section>

        <div class="grid cards3">
          <section class="card"><h3>Spending by category</h3><div id="categoryBreakdown" class="bars"></div></section>
          <section class="card"><h3>Spending by person</h3><div id="personBreakdown" class="bars"></div></section>
          <section class="card"><h3>Monthly trend (last 6 months)</h3><div id="monthlyTrend" class="bars"></div></section>
        </div>

        <section class="card">
          <h3 id="entryFormTitle">Quick expense entry</h3>
          <form id="expenseForm" class="grid-form">
            <label>Amount (EUR)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Date<input name="expenseDate" type="date" required /></label>
            <label>Category
              <select name="category" required>${CATEGORY_OPTIONS.map((x) => `<option value="${x}">${x}</option>`).join('')}</select>
            </label>
            <label>Description<input name="description" required maxlength="120" /></label>
            <label>Who paid<select name="paidBy" id="paidBySelect" required></select></label>
            <label class="wide">Optional notes<textarea name="notes" maxlength="500"></textarea></label>
            <div class="actions">
              <button type="submit" id="saveExpenseButton">Add expense</button>
              <button id="cancelEditButton" type="button" class="secondary hidden">Cancel edit</button>
            </div>
          </form>
        </section>

        <section class="card">
          <div class="section-head">
            <h3>Search and filter</h3>
            <div class="toolbar">
              <button id="exportCsvButton" class="secondary" type="button">Export CSV</button>
              <button id="backupButton" class="secondary" type="button">Backup JSON</button>
              <label class="file-label secondary">Restore JSON<input id="restoreInput" type="file" accept=".json,application/json" /></label>
            </div>
          </div>
          <form id="filterForm" class="filters">
            <label>Search<input name="search" placeholder="description, notes, category" /></label>
            <label>Category
              <select name="categoryFilter"><option value="">All</option>${CATEGORY_OPTIONS.map((x) => `<option value="${x}">${x}</option>`).join('')}</select>
            </label>
            <label>Who paid<select name="paidByFilter" id="paidByFilter"></select></label>
            <label>Month<input name="monthFilter" type="month" /></label>
            <button id="clearFiltersButton" class="secondary" type="button">Clear</button>
          </form>
        </section>

        <section class="card">
          <h3>Expenses</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Amount</th><th>Category</th><th>Description</th><th>Who paid</th><th>Notes</th><th>Actions</th></tr>
              </thead>
              <tbody id="expenseTableBody"></tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  `;
}

function showToast(message, isError = false) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.remove('hidden', 'danger');
  if (isError) el.classList.add('danger');
  window.setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('danger');
  }, 3500);
}

function formatCurrency(value) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(Number(value || 0));
}

function formatDate(dateText) {
  return new Intl.DateTimeFormat(LOCALE).format(new Date(`${dateText}T00:00:00`));
}

function monthKey(dateLike) {
  const d = new Date(dateLike);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setVisibleView(selector) {
  ['#authView', '#onboardingView', '#appView'].forEach((s) => document.querySelector(s).classList.add('hidden'));
  document.querySelector(selector).classList.remove('hidden');
}

function setToken(token) {
  state.token = token || '';
  if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
  else localStorage.removeItem(TOKEN_KEY);
}

function clearSession() {
  setToken('');
  state.profile = null;
  state.household = null;
  state.members = [];
  state.expenses = [];
  state.budget = 0;
  setVisibleView('#authView');
}

async function loadBootstrap() {
  const data = await apiFetch('/api/bootstrap');
  state.profile = data.profile;
  state.household = data.household;
  state.inviteCode = data.inviteCode || '';
  state.budget = Number(data.budget || 0);
  state.members = data.members || [];
  state.expenses = (data.expenses || []).map((x) => ({ ...x, amount: Number(x.amount) }));
}

function renderMemberSelects() {
  const options = state.members.map((m) => `<option value="${m.id}">${escapeHtml(m.displayName)}</option>`).join('');
  const paidBy = document.querySelector('#paidBySelect');
  const paidByFilter = document.querySelector('#paidByFilter');
  paidBy.innerHTML = options;
  paidByFilter.innerHTML = `<option value="">All</option>${options}`;
  if (state.profile) paidBy.value = state.profile.id;
}

function renderBars(container, items, total) {
  const el = document.querySelector(container);
  if (!items.length) {
    el.innerHTML = '<p class="muted">No data yet.</p>';
    return;
  }
  el.innerHTML = items
    .map((item) => {
      const width = total > 0 ? Math.round((item.value / total) * 100) : 0;
      return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(item.label)}</span><strong>${formatCurrency(item.value)}</strong></div><div class="bar-track"><span style="width:${width}%"></span></div></div>`;
    })
    .join('');
}

function renderDashboard() {
  const currentMonth = monthKey(todayIso());
  const monthExpenses = state.expenses.filter((x) => monthKey(x.expenseDate) === currentMonth);
  const monthTotal = monthExpenses.reduce((sum, x) => sum + x.amount, 0);
  const budget = state.budget;
  document.querySelector('#monthTotal').textContent = formatCurrency(monthTotal);
  document.querySelector('#budgetValue').textContent = formatCurrency(budget);
  document.querySelector('#entryCount').textContent = String(monthExpenses.length);

  let status = 'On track';
  if (budget > 0) {
    if (monthTotal >= budget) status = 'Budget exceeded';
    else if (monthTotal >= budget * 0.8) status = 'Approaching budget';
  }
  document.querySelector('#budgetStatus').textContent = status;

  const pct = budget > 0 ? Math.min(100, Math.round((monthTotal / budget) * 100)) : 0;
  const bar = document.querySelector('#budgetProgressBar');
  bar.style.width = `${pct}%`;
  bar.className = '';
  if (budget > 0 && monthTotal >= budget) bar.classList.add('danger-fill');
  else if (budget > 0 && monthTotal >= budget * 0.8) bar.classList.add('warn-fill');
  const remaining = budget - monthTotal;
  document.querySelector('#budgetDetail').textContent =
    budget === 0 ? 'Set a monthly budget to track progress.' : `${formatCurrency(Math.abs(remaining))} ${remaining >= 0 ? 'remaining' : 'over budget'}.`;
  document.querySelector('#budgetForm input[name="budget"]').value = budget.toFixed(2);

  const byCategory = new Map();
  const byPerson = new Map();
  monthExpenses.forEach((x) => {
    byCategory.set(x.category, (byCategory.get(x.category) || 0) + x.amount);
    const name = state.members.find((m) => m.id === x.paidBy)?.displayName || 'Unknown';
    byPerson.set(name, (byPerson.get(name) || 0) + x.amount);
  });
  const catRows = [...byCategory.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const personRows = [...byPerson.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  renderBars('#categoryBreakdown', catRows, monthTotal);
  renderBars('#personBreakdown', personRows, monthTotal);

  const trend = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const total = state.expenses.filter((x) => monthKey(x.expenseDate) === key).reduce((sum, x) => sum + x.amount, 0);
    trend.push({
      label: new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' }).format(d),
      value: total,
    });
  }
  renderBars('#monthlyTrend', trend, Math.max(...trend.map((x) => x.value), 1));
}

function filteredExpenses() {
  const q = state.filters.search.trim().toLowerCase();
  return state.expenses.filter((x) => {
    const matchSearch =
      !q || x.description.toLowerCase().includes(q) || (x.notes || '').toLowerCase().includes(q) || x.category.toLowerCase().includes(q);
    const matchCategory = !state.filters.category || x.category === state.filters.category;
    const matchPaidBy = !state.filters.paidBy || x.paidBy === state.filters.paidBy;
    const matchMonth = !state.filters.month || monthKey(x.expenseDate) === state.filters.month;
    return matchSearch && matchCategory && matchPaidBy && matchMonth;
  });
}

function renderExpenseRows() {
  const rows = filteredExpenses();
  const tbody = document.querySelector('#expenseTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">No expenses match your filters.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((x) => {
      const who = state.members.find((m) => m.id === x.paidBy)?.displayName || 'Unknown';
      return `<tr>
        <td>${formatDate(x.expenseDate)}</td>
        <td>${formatCurrency(x.amount)}</td>
        <td>${escapeHtml(x.category)}</td>
        <td>${escapeHtml(x.description)}</td>
        <td>${escapeHtml(who)}</td>
        <td>${escapeHtml(x.notes || '')}</td>
        <td><div class="table-actions">
          <button type="button" class="small secondary" data-action="edit" data-id="${x.id}">Edit</button>
          <button type="button" class="small danger" data-action="delete" data-id="${x.id}">Delete</button>
        </div></td>
      </tr>`;
    })
    .join('');
}

function renderHeader() {
  document.querySelector('#householdTitle').textContent = state.household?.name || '';
  document.querySelector('#signedInName').textContent = state.profile?.displayName || '';
  document.querySelector('#inviteCodeText').textContent = state.inviteCode || 'Unavailable';
}

function resetExpenseForm() {
  state.editingExpenseId = null;
  const form = document.querySelector('#expenseForm');
  form.reset();
  form.expenseDate.value = todayIso();
  if (state.profile) form.paidBy.value = state.profile.id;
  document.querySelector('#entryFormTitle').textContent = 'Quick expense entry';
  document.querySelector('#saveExpenseButton').textContent = 'Add expense';
  document.querySelector('#cancelEditButton').classList.add('hidden');
}

function renderApp() {
  renderHeader();
  renderMemberSelects();
  renderDashboard();
  renderExpenseRows();
  resetExpenseForm();
}

async function refreshAndRender() {
  await loadBootstrap();
  if (!state.household) {
    setVisibleView('#onboardingView');
    return;
  }
  setVisibleView('#appView');
  renderApp();
}

async function handleSignUp(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      displayName: String(f.get('displayName')).trim(),
      email: String(f.get('email')).trim(),
      password: String(f.get('password')),
    }),
  });
  showToast('Account created. Sign in now.');
  e.target.reset();
}

async function handleSignIn(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: String(f.get('email')).trim(), password: String(f.get('password')) }),
  });
  setToken(data.token);
  await refreshAndRender();
  showToast('Signed in.');
}

async function handleCreateHousehold(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  await apiFetch('/api/household/create', {
    method: 'POST',
    body: JSON.stringify({ name: String(f.get('name')).trim(), budget: Number(f.get('budget') || 0) }),
  });
  await refreshAndRender();
  showToast('Household created.');
}

async function handleJoinHousehold(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  await apiFetch('/api/household/join', {
    method: 'POST',
    body: JSON.stringify({ code: String(f.get('code')).trim() }),
  });
  await refreshAndRender();
  showToast('Joined household.');
}

async function handleSaveBudget(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  await apiFetch('/api/budget', { method: 'PUT', body: JSON.stringify({ amount: Number(f.get('budget')) }) });
  await refreshAndRender();
  showToast('Budget updated.');
}

async function handleSaveExpense(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    amount: Number(f.get('amount')),
    expenseDate: String(f.get('expenseDate')),
    category: String(f.get('category')),
    description: String(f.get('description')).trim(),
    paidBy: String(f.get('paidBy')),
    notes: String(f.get('notes')).trim(),
  };
  if (state.editingExpenseId) {
    await apiFetch(`/api/expenses/${state.editingExpenseId}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
  }
  await refreshAndRender();
  showToast(state.editingExpenseId ? 'Expense updated.' : 'Expense added.');
}

async function handleDeleteExpense(id) {
  await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
  await refreshAndRender();
  showToast('Expense deleted.');
}

function handleTableClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const expense = state.expenses.find((x) => x.id === btn.dataset.id);
  if (!expense) return;
  if (btn.dataset.action === 'edit') {
    state.editingExpenseId = expense.id;
    const form = document.querySelector('#expenseForm');
    form.amount.value = expense.amount.toFixed(2);
    form.expenseDate.value = expense.expenseDate;
    form.category.value = expense.category;
    form.description.value = expense.description;
    form.paidBy.value = expense.paidBy;
    form.notes.value = expense.notes || '';
    document.querySelector('#entryFormTitle').textContent = 'Edit expense';
    document.querySelector('#saveExpenseButton').textContent = 'Update expense';
    document.querySelector('#cancelEditButton').classList.remove('hidden');
    return;
  }
  if (window.confirm('Delete this expense?')) {
    handleDeleteExpense(expense.id).catch((err) => showToast(err.message, true));
  }
}

function updateFilters(form) {
  state.filters.search = String(form.search.value || '');
  state.filters.category = String(form.categoryFilter.value || '');
  state.filters.paidBy = String(form.paidByFilter.value || '');
  state.filters.month = String(form.monthFilter.value || '');
  renderExpenseRows();
}

function exportCsv() {
  const memberMap = new Map(state.members.map((m) => [m.id, m.displayName]));
  const lines = [
    'date,amount_eur,category,description,paid_by,notes',
    ...filteredExpenses().map((x) =>
      [
        x.expenseDate,
        x.amount.toFixed(2),
        `"${x.category.replaceAll('"', '""')}"`,
        `"${x.description.replaceAll('"', '""')}"`,
        `"${(memberMap.get(x.paidBy) || '').replaceAll('"', '""')}"`,
        `"${(x.notes || '').replaceAll('"', '""')}"`,
      ].join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-expenses-${todayIso()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function backupJson() {
  const payload = {
    version: 1,
    householdId: state.household.id,
    budget: state.budget,
    exportedAt: new Date().toISOString(),
    expenses: state.expenses,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-backup-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function restoreJson(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  await apiFetch('/api/backup/restore', { method: 'POST', body: JSON.stringify(payload) });
  await refreshAndRender();
  showToast('Backup restored.');
}

function bindEvents() {
  document.querySelector('#signUpForm').addEventListener('submit', (e) => handleSignUp(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#signInForm').addEventListener('submit', (e) => handleSignIn(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#createHouseholdForm').addEventListener('submit', (e) => handleCreateHousehold(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#joinHouseholdForm').addEventListener('submit', (e) => handleJoinHousehold(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#budgetForm').addEventListener('submit', (e) => handleSaveBudget(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#expenseForm').addEventListener('submit', (e) => handleSaveExpense(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#cancelEditButton').addEventListener('click', resetExpenseForm);
  document.querySelector('#expenseTableBody').addEventListener('click', handleTableClick);
  document.querySelector('#exportCsvButton').addEventListener('click', exportCsv);
  document.querySelector('#backupButton').addEventListener('click', backupJson);
  document.querySelector('#signOutButton').addEventListener('click', () => {
    clearSession();
    showToast('Signed out.');
  });

  const filterForm = document.querySelector('#filterForm');
  filterForm.addEventListener('input', () => updateFilters(filterForm));
  document.querySelector('#clearFiltersButton').addEventListener('click', () => {
    filterForm.reset();
    state.filters = { search: '', category: '', paidBy: '', month: '' };
    renderExpenseRows();
  });

  document.querySelector('#restoreInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await restoreJson(file);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      e.target.value = '';
    }
  });
}

async function bootSession() {
  if (!state.token) {
    setVisibleView('#authView');
    return;
  }
  try {
    await refreshAndRender();
  } catch (err) {
    clearSession();
    showToast(err.message, true);
  }
}

async function main() {
  renderShell();
  bindEvents();
  await bootSession();
}

main().catch((err) => showToast(err.message, true));
