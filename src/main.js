import { utils, writeFileXLSX } from 'xlsx';
import './style.css';

const STORAGE_KEY = 'household-public-expense-tracker-v1';
const SESSION_UNLOCK_KEY = 'household-public-access-session-v1';
const APPROVED_NAMES = ['ranjana', 'ranjana garg', 'ak', 'ak sharma'];
const LOCALE = 'en-IE';
const CURRENCY = 'EUR';
const CATEGORY_OPTIONS = ['Groceries', 'Utilities', 'Transport', 'Dining', 'Health', 'Shopping', 'Home', 'Kids', 'Mortgage', 'Insurance', 'Subscriptions', 'Other'];
const CLASSIFICATIONS = [
  { value: 'essential', label: 'Essential' },
  { value: 'reducible', label: 'Reducible' },
  { value: 'optional', label: 'Optional' },
];

const state = {
  user: '',
  unlocked: false,
  monthlyBudget: 0,
  expenses: [],
  filters: { search: '', category: '', paidBy: '', month: '' },
  editingId: null,
};

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ monthlyBudget: state.monthlyBudget, expenses: state.expenses }));
}

function formatCurrency(value) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(LOCALE).format(new Date(`${value}T00:00:00`));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(value) {
  return String(value).slice(0, 7);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderShell() {
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <section id="toast" class="card hidden"></section>

      <section id="gateView" class="card">
        <h1>Household Expense Tracker</h1>
        <p class="muted">Simple public app hosted on GitHub Pages. Access popup asks for name and DOB.</p>
        <form id="unlockForm" class="stack">
          <h3>Open tracker</h3>
          <label>Name
            <input name="name" required maxlength="60" />
          </label>
          <label>Date of birth
            <input name="dob" type="date" required />
          </label>
          <p class="muted">Hint: for this setup, enter today's date in DOB.</p>
          <button type="submit">Enter</button>
        </form>
      </section>

      <section id="appView" class="hidden">
        <div class="card topbar">
          <div>
            <h2>Household dashboard</h2>
            <p class="muted">Opened by <strong id="signedInName"></strong></p>
          </div>
          <button id="lockButton" class="secondary">Lock</button>
        </div>

        <section class="card">
          <div class="grid cards4">
            <article class="card stat"><p class="muted">This month spend</p><h3 id="monthSpendCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">This week spend</p><h3 id="weekSpendCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">This year spend</p><h3 id="yearSpendCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Monthly budget</p><h3 id="budgetCard">€0.00</h3></article>
          </div>
          <div class="progress"><span id="budgetFill"></span></div>
          <p id="budgetStatus" class="muted"></p>
          <form id="budgetForm" class="inline-form">
            <label>Monthly budget (EUR)<input name="budget" type="number" min="0" step="0.01" required /></label>
            <button type="submit">Save budget</button>
          </form>
        </section>

        <div class="grid cards3">
          <section class="card"><h3>Spending by category</h3><div id="categoryBreakdown" class="bars"></div></section>
          <section class="card"><h3>Spending by person</h3><div id="personBreakdown" class="bars"></div></section>
          <section class="card"><h3>Monthly trend (6 months)</h3><div id="trendBreakdown" class="bars"></div></section>
        </div>

        <section class="card">
          <h3 id="expenseFormTitle">Quick expense entry</h3>
          <form id="expenseForm" class="grid-form">
            <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
            <label>Date<input name="expenseDate" type="date" required /></label>
            <label>Category
              <select name="category" required>
                ${CATEGORY_OPTIONS.map((x) => `<option value="${x}">${x}</option>`).join('')}
              </select>
            </label>
            <label>Classification
              <select name="classification" required>
                ${CLASSIFICATIONS.map((x) => `<option value="${x.value}">${x.label}</option>`).join('')}
              </select>
            </label>
            <label>Description<input name="description" required maxlength="120" /></label>
            <label>Who paid<input name="paidBy" required maxlength="60" /></label>
            <label class="wide">Notes<textarea name="notes" maxlength="500"></textarea></label>
            <div class="actions">
              <button type="submit" id="saveExpenseButton">Add expense</button>
              <button type="button" id="cancelEditButton" class="secondary hidden">Cancel edit</button>
            </div>
          </form>
        </section>

        <section class="card">
          <div class="section-head">
            <h3>Search and export</h3>
            <div class="toolbar">
              <button id="exportCsvButton" class="secondary">Export CSV</button>
              <button id="exportExcelButton" class="secondary">Export Excel</button>
              <button id="backupButton" class="secondary">Backup JSON</button>
              <label class="file-label secondary">Restore JSON<input id="restoreInput" type="file" accept=".json,application/json" /></label>
            </div>
          </div>
          <form id="filterForm" class="filters">
            <label>Search<input name="search" placeholder="description or notes..." /></label>
            <label>Category
              <select name="categoryFilter">
                <option value="">All</option>
                ${CATEGORY_OPTIONS.map((x) => `<option value="${x}">${x}</option>`).join('')}
              </select>
            </label>
            <label>Who paid<input name="paidByFilter" placeholder="name" /></label>
            <label>Month<input name="monthFilter" type="month" /></label>
            <button type="button" id="clearFiltersButton" class="secondary">Clear</button>
          </form>
        </section>

        <section class="card">
          <h3>Expenses</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Category</th><th>Class</th><th>Description</th><th>Who paid</th><th>Actions</th></tr></thead>
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
  el.classList.remove('hidden', 'danger');
  if (isError) el.classList.add('danger');
  el.textContent = message;
  window.setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('danger');
  }, 3000);
}

function setVisibleView(view) {
  ['#gateView', '#appView'].forEach((id) => document.querySelector(id).classList.add('hidden'));
  document.querySelector(view).classList.remove('hidden');
}

function filteredExpenses() {
  const q = state.filters.search.trim().toLowerCase();
  return state.expenses.filter((x) => {
    const byQ = !q || x.description.toLowerCase().includes(q) || x.notes.toLowerCase().includes(q);
    const byCategory = !state.filters.category || x.category === state.filters.category;
    const byPaidBy = !state.filters.paidBy || x.paid_by.toLowerCase().includes(state.filters.paidBy.toLowerCase());
    const byMonth = !state.filters.month || monthKey(x.expense_date) === state.filters.month;
    return byQ && byCategory && byPaidBy && byMonth;
  });
}

function renderBars(containerId, rows) {
  const root = document.querySelector(containerId);
  if (!rows.length) {
    root.innerHTML = '<p class="muted">No data yet.</p>';
    return;
  }
  const max = Math.max(...rows.map((x) => x.value), 1);
  root.innerHTML = rows
    .map((row) => {
      const width = Math.round((row.value / max) * 100);
      return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(row.label)}</span><strong>${formatCurrency(row.value)}</strong></div><div class="bar-track"><span style="width:${width}%"></span></div></div>`;
    })
    .join('');
}

function renderDashboard() {
  document.querySelector('#signedInName').textContent = state.user;
  const now = todayIso();
  const month = monthKey(now);
  const start = new Date(`${now}T00:00:00`);
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const year = start.getFullYear();

  const monthSpend = state.expenses.filter((x) => monthKey(x.expense_date) === month).reduce((s, x) => s + x.amount, 0);
  const weekSpend = state.expenses.filter((x) => x.expense_date >= weekStartIso && x.expense_date <= now).reduce((s, x) => s + x.amount, 0);
  const yearSpend = state.expenses.filter((x) => new Date(`${x.expense_date}T00:00:00`).getFullYear() === year).reduce((s, x) => s + x.amount, 0);

  document.querySelector('#monthSpendCard').textContent = formatCurrency(monthSpend);
  document.querySelector('#weekSpendCard').textContent = formatCurrency(weekSpend);
  document.querySelector('#yearSpendCard').textContent = formatCurrency(yearSpend);
  document.querySelector('#budgetCard').textContent = formatCurrency(state.monthlyBudget);
  document.querySelector('#budgetForm').budget.value = Number(state.monthlyBudget || 0).toFixed(2);

  const fill = document.querySelector('#budgetFill');
  const status = document.querySelector('#budgetStatus');
  if (state.monthlyBudget <= 0) {
    fill.style.width = '0%';
    fill.className = '';
    status.textContent = 'Set a monthly budget to track progress.';
  } else {
    const ratio = (monthSpend / state.monthlyBudget) * 100;
    fill.style.width = `${Math.min(Math.round(ratio), 100)}%`;
    fill.className = ratio >= 100 ? 'danger-fill' : ratio >= 80 ? 'warn-fill' : '';
    status.textContent =
      ratio >= 100
        ? `Over budget by ${formatCurrency(monthSpend - state.monthlyBudget)}`
        : `Remaining budget: ${formatCurrency(state.monthlyBudget - monthSpend)}`;
  }

  const monthRows = state.expenses.filter((x) => monthKey(x.expense_date) === month);
  const byCategory = new Map();
  const byPerson = new Map();
  monthRows.forEach((x) => {
    byCategory.set(x.category, (byCategory.get(x.category) || 0) + x.amount);
    byPerson.set(x.paid_by, (byPerson.get(x.paid_by) || 0) + x.amount);
  });
  renderBars('#categoryBreakdown', Array.from(byCategory.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value));
  renderBars('#personBreakdown', Array.from(byPerson.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value));

  const monthTotals = new Map();
  state.expenses.forEach((x) => monthTotals.set(monthKey(x.expense_date), (monthTotals.get(monthKey(x.expense_date)) || 0) + x.amount));
  const trend = Array.from(monthTotals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([label, value]) => ({ label, value }));
  renderBars('#trendBreakdown', trend);
}

function renderExpensesTable() {
  const body = document.querySelector('#expenseTableBody');
  const rows = filteredExpenses();
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">No expenses found.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(
      (x) => `
      <tr>
        <td>${formatDate(x.expense_date)}</td>
        <td>${formatCurrency(x.amount)}</td>
        <td>${escapeHtml(x.category)}</td>
        <td>${escapeHtml(CLASSIFICATIONS.find((c) => c.value === x.classification)?.label || x.classification)}</td>
        <td>${escapeHtml(x.description)}</td>
        <td>${escapeHtml(x.paid_by)}</td>
        <td><div class="table-actions"><button type="button" class="small secondary" data-action="edit" data-id="${x.id}">Edit</button><button type="button" class="small danger" data-action="delete" data-id="${x.id}">Delete</button></div></td>
      </tr>
    `,
    )
    .join('');
}

function renderAll() {
  renderDashboard();
  renderExpensesTable();
}

function resetExpenseForm() {
  state.editingId = null;
  const form = document.querySelector('#expenseForm');
  form.reset();
  form.expenseDate.value = todayIso();
  form.classification.value = 'reducible';
  form.paidBy.value = state.user || '';
  document.querySelector('#expenseFormTitle').textContent = 'Quick expense entry';
  document.querySelector('#saveExpenseButton').textContent = 'Add expense';
  document.querySelector('#cancelEditButton').classList.add('hidden');
}

async function handleUnlock(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const rawName = String(form.get('name') || '').trim();
  const name = rawName.toLowerCase();
  const dob = String(form.get('dob') || '').trim();
  if (!name || !dob) throw new Error('Enter name and DOB.');
  if (!APPROVED_NAMES.includes(name)) throw new Error('Name is not approved.');
  if (dob !== todayIso()) throw new Error("DOB must match today's date for this access rule.");
  state.user = rawName;
  state.unlocked = true;
  sessionStorage.setItem(SESSION_UNLOCK_KEY, JSON.stringify({ user: state.user, ts: Date.now() }));
  setVisibleView('#appView');
  renderAll();
  resetExpenseForm();
}

function handleExpenseSave(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    id: state.editingId || crypto.randomUUID(),
    amount: Number(form.get('amount')),
    expense_date: String(form.get('expenseDate')),
    category: String(form.get('category')),
    classification: String(form.get('classification')),
    description: String(form.get('description') || '').trim(),
    paid_by: String(form.get('paidBy') || '').trim(),
    notes: String(form.get('notes') || '').trim(),
  };
  if (!Number.isFinite(payload.amount) || payload.amount <= 0 || !payload.description || !payload.paid_by) throw new Error('Enter valid expense details.');
  if (state.editingId) {
    state.expenses = state.expenses.map((x) => (x.id === state.editingId ? payload : x));
  } else {
    state.expenses.unshift(payload);
  }
  saveState();
  renderAll();
  resetExpenseForm();
}

function handleExpenseActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === 'delete') {
    if (!window.confirm('Delete this expense?')) return;
    state.expenses = state.expenses.filter((x) => x.id !== id);
    saveState();
    renderAll();
    return;
  }
  const row = state.expenses.find((x) => x.id === id);
  if (!row) return;
  state.editingId = row.id;
  const form = document.querySelector('#expenseForm');
  form.amount.value = row.amount.toFixed(2);
  form.expenseDate.value = row.expense_date;
  form.category.value = row.category;
  form.classification.value = row.classification;
  form.description.value = row.description;
  form.paidBy.value = row.paid_by;
  form.notes.value = row.notes || '';
  document.querySelector('#expenseFormTitle').textContent = 'Edit expense';
  document.querySelector('#saveExpenseButton').textContent = 'Update expense';
  document.querySelector('#cancelEditButton').classList.remove('hidden');
}

function exportCsv() {
  const rows = filteredExpenses().map((x) => ({
    date: x.expense_date,
    amount_eur: x.amount.toFixed(2),
    category: x.category,
    classification: x.classification,
    description: x.description,
    paid_by: x.paid_by,
    notes: x.notes || '',
  }));
  if (!rows.length) throw new Error('No rows to export.');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => `"${String(row[h]).replaceAll('"', '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-expenses-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExcel() {
  const rows = filteredExpenses().map((x) => ({
    Date: x.expense_date,
    Amount_EUR: x.amount,
    Category: x.category,
    Classification: x.classification,
    Description: x.description,
    Paid_By: x.paid_by,
    Notes: x.notes || '',
  }));
  if (!rows.length) throw new Error('No rows to export.');
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Expenses');
  writeFileXLSX(wb, `household-expenses-${todayIso()}.xlsx`);
}

function backupJson() {
  const payload = { exportedAt: new Date().toISOString(), monthlyBudget: state.monthlyBudget, expenses: state.expenses };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-expenses-backup-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function restoreJson(file) {
  const payload = JSON.parse(await file.text());
  if (!payload || !Array.isArray(payload.expenses)) throw new Error('Invalid backup file.');
  state.monthlyBudget = Number(payload.monthlyBudget || 0);
  state.expenses = payload.expenses
    .filter((x) => Number.isFinite(Number(x.amount)) && x.expense_date && x.category && x.description && x.paid_by)
    .map((x) => ({
      id: x.id || crypto.randomUUID(),
      amount: Number(x.amount),
      expense_date: String(x.expense_date),
      category: String(x.category),
      classification: String(x.classification || 'reducible'),
      description: String(x.description),
      paid_by: String(x.paid_by),
      notes: String(x.notes || ''),
    }));
  saveState();
  renderAll();
}

function bindEvents() {
  document.querySelector('#unlockForm').addEventListener('submit', (e) => handleUnlock(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#expenseForm').addEventListener('submit', (e) => {
    try {
      handleExpenseSave(e);
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.querySelector('#cancelEditButton').addEventListener('click', resetExpenseForm);
  document.querySelector('#expenseTableBody').addEventListener('click', handleExpenseActions);
  document.querySelector('#budgetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = Number(new FormData(e.target).get('budget'));
    if (!Number.isFinite(value) || value < 0) return showToast('Enter a valid budget.', true);
    state.monthlyBudget = value;
    saveState();
    renderDashboard();
  });
  const filterForm = document.querySelector('#filterForm');
  filterForm.addEventListener('input', () => {
    state.filters.search = String(filterForm.search.value || '');
    state.filters.category = String(filterForm.categoryFilter.value || '');
    state.filters.paidBy = String(filterForm.paidByFilter.value || '');
    state.filters.month = String(filterForm.monthFilter.value || '');
    renderExpensesTable();
  });
  document.querySelector('#clearFiltersButton').addEventListener('click', () => {
    filterForm.reset();
    state.filters = { search: '', category: '', paidBy: '', month: '' };
    renderExpensesTable();
  });
  document.querySelector('#exportCsvButton').addEventListener('click', () => {
    try {
      exportCsv();
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.querySelector('#exportExcelButton').addEventListener('click', () => {
    try {
      exportExcel();
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.querySelector('#backupButton').addEventListener('click', backupJson);
  document.querySelector('#restoreInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await restoreJson(file);
      showToast('Backup restored.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      e.target.value = '';
    }
  });
  document.querySelector('#lockButton').addEventListener('click', () => {
    state.unlocked = false;
    state.user = '';
    state.editingId = null;
    sessionStorage.removeItem(SESSION_UNLOCK_KEY);
    setVisibleView('#gateView');
  });
}

function main() {
  const saved = loadJson(STORAGE_KEY, { monthlyBudget: 0, expenses: [] });
  state.monthlyBudget = Number(saved.monthlyBudget || 0);
  state.expenses = Array.isArray(saved.expenses) ? saved.expenses : [];

  renderShell();
  bindEvents();

  const session = loadJson(SESSION_UNLOCK_KEY, null);
  if (session?.user) {
    state.user = String(session.user);
    state.unlocked = true;
    setVisibleView('#appView');
    renderAll();
    resetExpenseForm();
  } else {
    setVisibleView('#gateView');
  }
}

main();
