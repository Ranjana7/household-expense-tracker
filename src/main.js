import { createClient } from '@supabase/supabase-js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CATEGORY_OPTIONS = ['Groceries', 'Utilities', 'Transport', 'Dining', 'Health', 'Shopping', 'Home', 'Kids', 'Other'];
const LOCALE = 'en-IE';
const CURRENCY = 'EUR';

const state = {
  session: null,
  profile: null,
  household: null,
  inviteCode: '',
  budget: 0,
  members: [],
  expenses: [],
  editingExpenseId: null,
  filters: {
    search: '',
    category: '',
    paidBy: '',
    month: '',
  },
};

let supabase = null;

function renderShell() {
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <section id="configError" class="card danger hidden"></section>
      <section id="toast" class="card hidden"></section>

      <section id="authView" class="card">
        <h1>Household Expense Tracker</h1>
        <p class="muted">Sign in with your own account to track shared household spending.</p>
        <div class="split">
          <form id="signInForm" class="stack">
            <h2>Sign in</h2>
            <label>Email<input name="email" type="email" required autocomplete="email" /></label>
            <label>Password<input name="password" type="password" required autocomplete="current-password" /></label>
            <button type="submit">Sign in</button>
          </form>
          <form id="signUpForm" class="stack">
            <h2>Create account</h2>
            <label>Name<input name="displayName" type="text" required maxlength="50" /></label>
            <label>Email<input name="email" type="email" required autocomplete="email" /></label>
            <label>Password<input name="password" type="password" required minlength="8" autocomplete="new-password" /></label>
            <button type="submit">Create account</button>
          </form>
        </div>
      </section>

      <section id="onboardingView" class="hidden">
        <div class="card">
          <h2>Set up your household</h2>
          <p class="muted">Create a new household or join an existing one using its invite code.</p>
          <div class="split">
            <form id="createHouseholdForm" class="stack">
              <h3>Create household</h3>
              <label>Household name<input name="name" required maxlength="80" /></label>
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
              Signed in as <strong id="signedInName"></strong>.
              Invite code: <code id="inviteCodeText"></code>
            </p>
          </div>
          <button id="signOutButton" class="secondary">Sign out</button>
        </div>

        <div class="grid cards4">
          <article class="card stat"><p class="muted">This month total</p><h3 id="monthTotal">EUR0.00</h3></article>
          <article class="card stat"><p class="muted">Monthly budget</p><h3 id="budgetValue">EUR0.00</h3></article>
          <article class="card stat"><p class="muted">Budget status</p><h3 id="budgetStatus">On track</h3></article>
          <article class="card stat"><p class="muted">Entries this month</p><h3 id="entryCount">0</h3></article>
        </div>

        <section class="card">
          <h3>Budget progress</h3>
          <div class="progress"><span id="budgetProgressBar"></span></div>
          <p class="muted" id="budgetDetail"></p>
          <form id="budgetForm" class="inline-form">
            <label>Set monthly budget (EUR)
              <input name="budget" type="number" min="0" step="0.01" required />
            </label>
            <button type="submit">Save budget</button>
          </form>
        </section>

        <div class="grid cards3">
          <section class="card">
            <h3>Spending by category</h3>
            <div id="categoryBreakdown" class="bars"></div>
          </section>
          <section class="card">
            <h3>Spending by person</h3>
            <div id="personBreakdown" class="bars"></div>
          </section>
          <section class="card">
            <h3>Monthly trend (last 6 months)</h3>
            <div id="monthlyTrend" class="bars"></div>
          </section>
        </div>

        <section class="card">
          <h3 id="entryFormTitle">Quick expense entry</h3>
          <form id="expenseForm" class="grid-form">
            <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
            <label>Date<input name="expenseDate" type="date" required /></label>
            <label>Category
              <select name="category" required>
                ${CATEGORY_OPTIONS.map((category) => `<option value="${category}">${category}</option>`).join('')}
              </select>
            </label>
            <label>Description<input name="description" required maxlength="120" /></label>
            <label>Who paid
              <select name="paidBy" id="paidBySelect" required></select>
            </label>
            <label class="wide">Optional notes<textarea name="notes" maxlength="500"></textarea></label>
            <div class="actions">
              <button type="submit" id="saveExpenseButton">Add expense</button>
              <button type="button" id="cancelEditButton" class="secondary hidden">Cancel edit</button>
            </div>
          </form>
        </section>

        <section class="card">
          <div class="section-head">
            <h3>Search and filter</h3>
            <div class="toolbar">
              <button id="exportCsvButton" class="secondary">Export CSV</button>
              <button id="backupButton" class="secondary">Backup JSON</button>
              <label class="file-label secondary">
                Restore JSON
                <input id="restoreInput" type="file" accept=".json,application/json" />
              </label>
            </div>
          </div>
          <form id="filterForm" class="filters">
            <label>Search
              <input name="search" placeholder="description, notes, category" />
            </label>
            <label>Category
              <select name="categoryFilter">
                <option value="">All</option>
                ${CATEGORY_OPTIONS.map((category) => `<option value="${category}">${category}</option>`).join('')}
              </select>
            </label>
            <label>Who paid
              <select name="paidByFilter" id="paidByFilter"></select>
            </label>
            <label>Month
              <input name="monthFilter" type="month" />
            </label>
            <button type="button" id="clearFiltersButton" class="secondary">Clear</button>
          </form>
        </section>

        <section class="card">
          <h3>Expenses</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Who paid</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
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
  const toast = document.querySelector('#toast');
  toast.classList.remove('hidden', 'danger');
  if (isError) {
    toast.classList.add('danger');
  }
  toast.textContent = message;
  window.setTimeout(() => {
    toast.classList.add('hidden');
    toast.textContent = '';
    toast.classList.remove('danger');
  }, 4000);
}

function formatCurrency(value) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(value || 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(LOCALE).format(new Date(`${value}T00:00:00`));
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

function ensureSupabaseConfigured() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return true;
  }
  const configError = document.querySelector('#configError');
  configError.classList.remove('hidden');
  configError.innerHTML = 'Missing <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code>. Add them to a local <code>.env.local</code> file.';
  document.querySelector('#authView').classList.add('hidden');
  return false;
}

function setVisibleView(view) {
  document.querySelector('#authView').classList.add('hidden');
  document.querySelector('#onboardingView').classList.add('hidden');
  document.querySelector('#appView').classList.add('hidden');
  document.querySelector(view).classList.remove('hidden');
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('user_id, display_name').eq('user_id', state.session.user.id).single();
  if (error) {
    throw error;
  }
  state.profile = data;
}

async function loadHousehold() {
  const { data: membership, error: membershipError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', state.session.user.id)
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  if (!membership) {
    state.household = null;
    state.inviteCode = '';
    return;
  }

  const householdId = membership.household_id;
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id, name')
    .eq('id', householdId)
    .single();
  if (householdError) {
    throw householdError;
  }
  state.household = household;

  const { data: inviteRow, error: inviteError } = await supabase
    .from('household_invites')
    .select('invite_code')
    .eq('household_id', householdId)
    .maybeSingle();

  if (inviteError) {
    throw inviteError;
  }
  state.inviteCode = inviteRow?.invite_code ?? '';
}

async function loadMembers() {
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, profiles!inner(display_name)')
    .eq('household_id', state.household.id)
    .order('user_id', { ascending: true });
  if (error) {
    throw error;
  }
  state.members = data.map((row) => ({ user_id: row.user_id, display_name: row.profiles.display_name }));
}

async function loadBudget() {
  const { data, error } = await supabase
    .from('monthly_budgets')
    .select('amount_eur')
    .eq('household_id', state.household.id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  state.budget = Number(data?.amount_eur ?? 0);
}

async function loadExpenses() {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, household_id, amount, expense_date, category, description, paid_by, notes')
    .eq('household_id', state.household.id)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  state.expenses = data.map((expense) => ({ ...expense, amount: Number(expense.amount) }));
}

function getFilteredExpenses() {
  const searchTerm = state.filters.search.trim().toLowerCase();
  return state.expenses.filter((expense) => {
    const matchesSearch =
      searchTerm.length === 0 ||
      expense.description.toLowerCase().includes(searchTerm) ||
      (expense.notes || '').toLowerCase().includes(searchTerm) ||
      expense.category.toLowerCase().includes(searchTerm);
    const matchesCategory = !state.filters.category || expense.category === state.filters.category;
    const matchesPaidBy = !state.filters.paidBy || expense.paid_by === state.filters.paidBy;
    const matchesMonth = !state.filters.month || monthKey(expense.expense_date) === state.filters.month;
    return matchesSearch && matchesCategory && matchesPaidBy && matchesMonth;
  });
}

function renderMemberSelects() {
  const expensePaidBy = document.querySelector('#paidBySelect');
  const paidByFilter = document.querySelector('#paidByFilter');
  const memberOptions = state.members
    .map((member) => `<option value="${member.user_id}">${escapeHtml(member.display_name)}</option>`)
    .join('');

  expensePaidBy.innerHTML = memberOptions;
  paidByFilter.innerHTML = `<option value="">All</option>${memberOptions}`;
  expensePaidBy.value = state.profile.user_id;
}

function renderBars(containerId, rows, total = 0) {
  const container = document.querySelector(containerId);
  if (!rows.length) {
    container.innerHTML = '<p class="muted">No data yet.</p>';
    return;
  }
  container.innerHTML = rows
    .map((row) => {
      const width = total > 0 ? Math.round((row.value / total) * 100) : 0;
      return `
        <div class="bar-row">
          <div class="bar-label"><span>${escapeHtml(row.label)}</span><strong>${formatCurrency(row.value)}</strong></div>
          <div class="bar-track"><span style="width:${width}%"></span></div>
        </div>
      `;
    })
    .join('');
}

function renderDashboard() {
  const currentMonth = monthKey(todayIso());
  const currentMonthExpenses = state.expenses.filter((expense) => monthKey(expense.expense_date) === currentMonth);
  const monthTotal = currentMonthExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const budget = state.budget;

  document.querySelector('#monthTotal').textContent = formatCurrency(monthTotal);
  document.querySelector('#budgetValue').textContent = formatCurrency(budget);
  document.querySelector('#entryCount').textContent = String(currentMonthExpenses.length);

  let budgetStatus = 'On track';
  if (budget > 0) {
    const ratio = monthTotal / budget;
    if (ratio >= 1) {
      budgetStatus = 'Budget exceeded';
    } else if (ratio >= 0.8) {
      budgetStatus = 'Approaching budget';
    }
  }
  document.querySelector('#budgetStatus').textContent = budgetStatus;

  const progressPercent = budget > 0 ? Math.min(100, Math.round((monthTotal / budget) * 100)) : 0;
  const progressBar = document.querySelector('#budgetProgressBar');
  progressBar.style.width = `${progressPercent}%`;
  progressBar.className = '';
  if (budget > 0 && monthTotal >= budget) {
    progressBar.classList.add('danger-fill');
  } else if (budget > 0 && monthTotal >= budget * 0.8) {
    progressBar.classList.add('warn-fill');
  }

  const remaining = budget - monthTotal;
  const budgetDetail = budget === 0 ? 'Set a monthly budget to track progress.' : `${formatCurrency(Math.abs(remaining))} ${remaining >= 0 ? 'remaining' : 'over budget'}.`;
  document.querySelector('#budgetDetail').textContent = budgetDetail;
  document.querySelector('#budgetForm input[name="budget"]').value = budget.toFixed(2);

  const byCategory = new Map();
  const byPerson = new Map();
  currentMonthExpenses.forEach((expense) => {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
    const name = state.members.find((member) => member.user_id === expense.paid_by)?.display_name ?? 'Unknown';
    byPerson.set(name, (byPerson.get(name) ?? 0) + expense.amount);
  });

  const categoryRows = Array.from(byCategory.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const personRows = Array.from(byPerson.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  renderBars('#categoryBreakdown', categoryRows, monthTotal);
  renderBars('#personBreakdown', personRows, monthTotal);

  const trend = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' }).format(d);
    const value = state.expenses.filter((expense) => monthKey(expense.expense_date) === key).reduce((sum, expense) => sum + expense.amount, 0);
    trend.push({ label, value });
  }
  const maxTrend = Math.max(...trend.map((entry) => entry.value), 0);
  renderBars('#monthlyTrend', trend, maxTrend || 1);
}

function renderExpenseRows() {
  const rows = getFilteredExpenses();
  const body = document.querySelector('#expenseTableBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">No expenses match your filters.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((expense) => {
      const paidBy = state.members.find((member) => member.user_id === expense.paid_by)?.display_name ?? 'Unknown';
      return `
        <tr>
          <td>${formatDate(expense.expense_date)}</td>
          <td>${formatCurrency(expense.amount)}</td>
          <td>${escapeHtml(expense.category)}</td>
          <td>${escapeHtml(expense.description)}</td>
          <td>${escapeHtml(paidBy)}</td>
          <td>${escapeHtml(expense.notes || '')}</td>
          <td>
            <div class="table-actions">
              <button class="small secondary" data-action="edit" data-id="${expense.id}" type="button">Edit</button>
              <button class="small danger" data-action="delete" data-id="${expense.id}" type="button">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function resetExpenseForm() {
  state.editingExpenseId = null;
  document.querySelector('#expenseForm').reset();
  document.querySelector('#expenseForm input[name="expenseDate"]').value = todayIso();
  document.querySelector('#paidBySelect').value = state.profile.user_id;
  document.querySelector('#entryFormTitle').textContent = 'Quick expense entry';
  document.querySelector('#saveExpenseButton').textContent = 'Add expense';
  document.querySelector('#cancelEditButton').classList.add('hidden');
}

function renderAppHeader() {
  document.querySelector('#householdTitle').textContent = state.household.name;
  document.querySelector('#signedInName').textContent = state.profile.display_name;
  document.querySelector('#inviteCodeText').textContent = state.inviteCode || 'Unavailable';
}

function renderEverything() {
  renderAppHeader();
  renderMemberSelects();
  renderDashboard();
  renderExpenseRows();
  resetExpenseForm();
}

async function refreshData() {
  await Promise.all([loadMembers(), loadBudget(), loadExpenses()]);
  renderEverything();
}

async function handleSignIn(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email')).trim(),
    password: String(form.get('password')),
  });
  if (error) {
    showToast(error.message, true);
    return;
  }
  showToast('Signed in.');
}

async function handleSignUp(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const displayName = String(form.get('displayName')).trim();
  const { error } = await supabase.auth.signUp({
    email: String(form.get('email')).trim(),
    password: String(form.get('password')),
    options: { data: { display_name: displayName } },
  });
  if (error) {
    showToast(error.message, true);
    return;
  }
  showToast('Account created. If email confirmation is enabled, confirm it before signing in.');
}

async function handleCreateHousehold(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const budget = Number(form.get('budget'));
  const { error } = await supabase.rpc('create_household', {
    p_name: String(form.get('name')).trim(),
    p_budget: Number.isFinite(budget) ? budget : 0,
  });
  if (error) {
    showToast(error.message, true);
    return;
  }
  await loadHousehold();
  await refreshData();
  setVisibleView('#appView');
  showToast('Household created.');
}

async function handleJoinHousehold(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const { error } = await supabase.rpc('join_household', { p_code: String(form.get('code')).trim() });
  if (error) {
    showToast(error.message, true);
    return;
  }
  await loadHousehold();
  await refreshData();
  setVisibleView('#appView');
  showToast('Joined household.');
}

async function handleSaveBudget(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const amount = Number(form.get('budget'));
  if (!Number.isFinite(amount) || amount < 0) {
    showToast('Budget must be a non-negative amount.', true);
    return;
  }

  const { error } = await supabase.from('monthly_budgets').upsert(
    {
      household_id: state.household.id,
      amount_eur: amount,
    },
    { onConflict: 'household_id' },
  );
  if (error) {
    showToast(error.message, true);
    return;
  }
  await loadBudget();
  renderDashboard();
  showToast('Budget updated.');
}

async function handleSaveExpense(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    household_id: state.household.id,
    amount: Number(form.get('amount')),
    expense_date: String(form.get('expenseDate')),
    category: String(form.get('category')),
    description: String(form.get('description')).trim(),
    paid_by: String(form.get('paidBy')),
    notes: String(form.get('notes')).trim(),
  };

  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    showToast('Amount must be greater than zero.', true);
    return;
  }

  let error = null;
  if (state.editingExpenseId) {
    ({ error } = await supabase.from('expenses').update(payload).eq('id', state.editingExpenseId).eq('household_id', state.household.id));
  } else {
    ({ error } = await supabase.from('expenses').insert(payload));
  }

  if (error) {
    showToast(error.message, true);
    return;
  }

  await loadExpenses();
  renderDashboard();
  renderExpenseRows();
  resetExpenseForm();
  showToast(state.editingExpenseId ? 'Expense updated.' : 'Expense added.');
}

function handleExpenseTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  const id = button.dataset.id;
  const expense = state.expenses.find((row) => row.id === id);
  if (!expense) {
    showToast('Expense not found.', true);
    return;
  }

  if (button.dataset.action === 'edit') {
    state.editingExpenseId = id;
    const form = document.querySelector('#expenseForm');
    form.amount.value = expense.amount.toFixed(2);
    form.expenseDate.value = expense.expense_date;
    form.category.value = expense.category;
    form.description.value = expense.description;
    form.paidBy.value = expense.paid_by;
    form.notes.value = expense.notes || '';
    document.querySelector('#entryFormTitle').textContent = 'Edit expense';
    document.querySelector('#saveExpenseButton').textContent = 'Update expense';
    document.querySelector('#cancelEditButton').classList.remove('hidden');
    return;
  }

  if (!window.confirm('Delete this expense?')) {
    return;
  }

  deleteExpense(id).catch((error) => {
    showToast(error.message, true);
  });
}

async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('household_id', state.household.id);
  if (error) {
    throw error;
  }
  await loadExpenses();
  renderDashboard();
  renderExpenseRows();
  showToast('Expense deleted.');
}

function updateFiltersFromForm(form) {
  state.filters.search = String(form.search.value || '');
  state.filters.category = String(form.categoryFilter.value || '');
  state.filters.paidBy = String(form.paidByFilter.value || '');
  state.filters.month = String(form.monthFilter.value || '');
  renderExpenseRows();
}

function exportCsv() {
  const rows = getFilteredExpenses();
  const headers = ['date', 'amount_eur', 'category', 'description', 'paid_by', 'notes'];
  const memberMap = new Map(state.members.map((member) => [member.user_id, member.display_name]));

  const csvLines = [
    headers.join(','),
    ...rows.map((expense) =>
      [
        expense.expense_date,
        expense.amount.toFixed(2),
        `"${(expense.category || '').replaceAll('"', '""')}"`,
        `"${(expense.description || '').replaceAll('"', '""')}"`,
        `"${(memberMap.get(expense.paid_by) || '').replaceAll('"', '""')}"`,
        `"${(expense.notes || '').replaceAll('"', '""')}"`,
      ].join(','),
    ),
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function backupJson() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    householdId: state.household.id,
    budget: state.budget,
    expenses: state.expenses.map((expense) => ({
      id: expense.id,
      amount: expense.amount,
      expense_date: expense.expense_date,
      category: expense.category,
      description: expense.description,
      paid_by: expense.paid_by,
      notes: expense.notes || '',
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function restoreJson(file) {
  const text = await file.text();
  const payload = JSON.parse(text);

  if (!payload || payload.version !== 1 || !Array.isArray(payload.expenses)) {
    throw new Error('Invalid backup format.');
  }
  if (payload.householdId !== state.household.id) {
    throw new Error('Backup belongs to a different household.');
  }

  const budgetAmount = Number(payload.budget ?? 0);
  if (Number.isFinite(budgetAmount) && budgetAmount >= 0) {
    const { error: budgetError } = await supabase
      .from('monthly_budgets')
      .upsert({ household_id: state.household.id, amount_eur: budgetAmount }, { onConflict: 'household_id' });
    if (budgetError) {
      throw budgetError;
    }
  }

  const expensesToUpsert = payload.expenses.map((expense) => ({
    id: expense.id,
    household_id: state.household.id,
    amount: Number(expense.amount),
    expense_date: String(expense.expense_date),
    category: String(expense.category),
    description: String(expense.description),
    paid_by: String(expense.paid_by),
    notes: String(expense.notes || ''),
  }));

  const { error } = await supabase.from('expenses').upsert(expensesToUpsert, { onConflict: 'id' });
  if (error) {
    throw error;
  }
}

async function applySession(session) {
  state.session = session;
  if (!session) {
    state.profile = null;
    state.household = null;
    setVisibleView('#authView');
    return;
  }

  await loadProfile();
  await loadHousehold();

  if (!state.household) {
    setVisibleView('#onboardingView');
    return;
  }

  await refreshData();
  setVisibleView('#appView');
}

function bindEvents() {
  document.querySelector('#signInForm').addEventListener('submit', (event) => {
    handleSignIn(event).catch((error) => showToast(error.message, true));
  });
  document.querySelector('#signUpForm').addEventListener('submit', (event) => {
    handleSignUp(event).catch((error) => showToast(error.message, true));
  });
  document.querySelector('#createHouseholdForm').addEventListener('submit', (event) => {
    handleCreateHousehold(event).catch((error) => showToast(error.message, true));
  });
  document.querySelector('#joinHouseholdForm').addEventListener('submit', (event) => {
    handleJoinHousehold(event).catch((error) => showToast(error.message, true));
  });
  document.querySelector('#budgetForm').addEventListener('submit', (event) => {
    handleSaveBudget(event).catch((error) => showToast(error.message, true));
  });
  document.querySelector('#expenseForm').addEventListener('submit', (event) => {
    handleSaveExpense(event).catch((error) => showToast(error.message, true));
  });
  document.querySelector('#cancelEditButton').addEventListener('click', resetExpenseForm);
  document.querySelector('#signOutButton').addEventListener('click', () => {
    supabase.auth.signOut().catch((error) => showToast(error.message, true));
  });
  document.querySelector('#expenseTableBody').addEventListener('click', handleExpenseTableClick);

  const filterForm = document.querySelector('#filterForm');
  filterForm.addEventListener('input', () => updateFiltersFromForm(filterForm));
  document.querySelector('#clearFiltersButton').addEventListener('click', () => {
    filterForm.reset();
    state.filters = { search: '', category: '', paidBy: '', month: '' };
    renderExpenseRows();
  });

  document.querySelector('#exportCsvButton').addEventListener('click', exportCsv);
  document.querySelector('#backupButton').addEventListener('click', backupJson);
  document.querySelector('#restoreInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      await restoreJson(file);
      await refreshData();
      showToast('Backup restored.');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      event.target.value = '';
    }
  });
}

async function main() {
  renderShell();
  if (!ensureSupabaseConfigured()) {
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  bindEvents();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showToast(error.message, true);
    return;
  }
  await applySession(data.session);
  document.querySelector('#expenseForm input[name="expenseDate"]').value = todayIso();

  supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session).catch((authError) => showToast(authError.message, true));
  });
}

main().catch((error) => {
  showToast(error.message, true);
});
