import { utils, writeFileXLSX } from 'xlsx';
import './style.css';

const STORAGE_KEY = 'household-finance-local-v3';
const SESSION_UNLOCK_KEY = 'household-finance-session-v3';
const SYNC_API_BASE = import.meta.env.VITE_SYNC_API_BASE_URL || '';
const LOCALE = 'en-IE';
const CURRENCY = 'EUR';
const ALLOWED_SESSION_NAMES = new Set(['Amit', 'Ranjana']);
const ALLOWED_NAME_HASHES = new Set([
  '105a112c81ce60e646c007e98655b7caa27d9e6f36a7ba9584e406dd400e15ff',
  'a13e93f0c837098185bc6189f34f9975910089c0d2af201b47bb4514cb905e23',
]);
const CUSTOM_CATEGORY_VALUE = '__custom__';
const EXPENSE_CATEGORIES = [
  'Mortgage-S',
  'Mortgage-P',
  'Mortgage-A',
  'Mortgage-ES',
  'Mortgage-PT',
  'Housing',
  'Utilities',
  'Groceries',
  'Transport',
  'Insurance',
  'Healthcare',
  'Education',
  'Childcare',
  'Maintenance',
  'Taxes',
  'Shopping',
  'Dining',
  'Entertainment',
  'Travel',
  'Other',
];
const INCOME_CATEGORIES = [
  'Salary',
  'Rental Income',
  'Bonus',
  'Freelance',
  'Business',
  'Interest',
  'Dividends',
  'Pension',
  'Gift',
  'Other',
];
const FREQUENCIES = ['weekly', 'monthly', 'yearly'];
const EXPENSE_TYPES = ['mandatory', 'avoidable'];
const INCOME_TYPES = ['permanent', 'temporary'];

const state = {
  user: '',
  unlocked: false,
  activeTab: 'expense',
  data: {
    revision: null,
    expenses: [],
    incomes: [],
  },
  view: {
    mode: 'monthly',
    month: todayMonth(),
    year: String(new Date().getFullYear()),
  },
  syncStatus: SYNC_API_BASE ? 'Connected' : 'Local only',
  editingExpenseId: null,
  editingIncomeId: null,
  pollHandle: null,
};

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayMonth() {
  return todayIso().slice(0, 7);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(LOCALE).format(new Date(`${value}T00:00:00`));
}

function toOptions(values) {
  return values.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function isAllowedName(name) {
  const hash = await sha256Hex(name);
  return ALLOWED_NAME_HASHES.has(hash);
}

function showToast(message, isError = false) {
  const el = document.querySelector('#toast');
  el.classList.remove('hidden', 'danger');
  if (isError) el.classList.add('danger');
  el.textContent = message;
  setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('danger');
  }, 3000);
}

function setSyncStatus(text) {
  state.syncStatus = text;
  const el = document.querySelector('#syncStatus');
  if (el) el.textContent = text;
}

function parseIsoDate(iso) {
  return new Date(`${iso}T00:00:00`);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, maxDay));
  return d;
}

function inRange(dateIso, startIso, endIso) {
  return dateIso >= startIso && dateIso <= endIso;
}

function startAndEndForView() {
  if (state.view.mode === 'monthly') {
    const start = `${state.view.month}-01`;
    const [y, m] = state.view.month.split('-').map(Number);
    const end = new Date(y, m, 0).toISOString().slice(0, 10);
    return { start, end };
  }
  return { start: `${state.view.year}-01-01`, end: `${state.view.year}-12-31` };
}

function normaliseExpense(raw) {
  return {
    id: raw.id || crypto.randomUUID(),
    amount: Number(raw.amount || 0),
    date: String(raw.date || todayIso()),
    frequency: FREQUENCIES.includes(raw.frequency) ? raw.frequency : 'monthly',
    category: String(raw.category || 'Other'),
    expenseType: EXPENSE_TYPES.includes(raw.expenseType) ? raw.expenseType : 'avoidable',
    recurring: Boolean(raw.recurring),
    note: String(raw.note || ''),
    createdAt: Number(raw.createdAt || Date.now()),
  };
}

function normaliseIncome(raw) {
  return {
    id: raw.id || crypto.randomUUID(),
    amount: Number(raw.amount || 0),
    date: String(raw.date || todayIso()),
    frequency: FREQUENCIES.includes(raw.frequency) ? raw.frequency : 'monthly',
    category: String(raw.category || 'Other'),
    relatesToExpense: String(raw.relatesToExpense || '').trim(),
    incomeType: INCOME_TYPES.includes(raw.incomeType) ? raw.incomeType : 'permanent',
    recurring: Boolean(raw.recurring),
    note: String(raw.note || ''),
    createdAt: Number(raw.createdAt || Date.now()),
  };
}

function loadLocalData() {
  const local = loadJson(STORAGE_KEY, { revision: null, expenses: [], incomes: [] });
  state.data = {
    revision: local.revision || null,
    expenses: Array.isArray(local.expenses) ? local.expenses.map(normaliseExpense).filter((x) => x.amount > 0) : [],
    incomes: Array.isArray(local.incomes) ? local.incomes.map(normaliseIncome).filter((x) => x.amount > 0) : [],
  };
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

async function apiGetData() {
  const res = await fetch(`${SYNC_API_BASE}/finance-data`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Sync read failed (${res.status})`);
  return res.json();
}

async function apiPutData(payload, revision) {
  const res = await fetch(`${SYNC_API_BASE}/finance-data`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(revision ? { 'If-Match': String(revision) } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    const latest = await res.json();
    const err = new Error('Conflict: data changed by someone else. Reloaded latest version.');
    err.latest = latest;
    throw err;
  }
  if (!res.ok) throw new Error(`Sync save failed (${res.status})`);
  return res.json();
}

async function loadData() {
  loadLocalData();
  if (!SYNC_API_BASE) return;
  try {
    const remote = await apiGetData();
    state.data = {
      revision: remote.revision || null,
      expenses: Array.isArray(remote.data?.expenses) ? remote.data.expenses.map(normaliseExpense) : [],
      incomes: Array.isArray(remote.data?.incomes) ? remote.data.incomes.map(normaliseIncome) : [],
    };
    saveLocalData();
    setSyncStatus('Synced');
  } catch (err) {
    setSyncStatus('Sync unavailable (using local cache)');
    showToast(err.message, true);
  }
}

async function saveData() {
  saveLocalData();
  if (!SYNC_API_BASE) return;
  try {
    const payload = { expenses: state.data.expenses, incomes: state.data.incomes };
    const response = await apiPutData(payload, state.data.revision);
    state.data.revision = response.revision || state.data.revision;
    saveLocalData();
    setSyncStatus('Synced');
  } catch (err) {
    if (err.latest) {
      state.data = {
        revision: err.latest.revision || null,
        expenses: Array.isArray(err.latest.data?.expenses) ? err.latest.data.expenses.map(normaliseExpense) : [],
        incomes: Array.isArray(err.latest.data?.incomes) ? err.latest.data.incomes.map(normaliseIncome) : [],
      };
      saveLocalData();
      renderAll();
    }
    setSyncStatus('Sync conflict/error');
    throw err;
  }
}

function startPolling() {
  if (!SYNC_API_BASE) return;
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = setInterval(async () => {
    try {
      const remote = await apiGetData();
      if (remote.revision && remote.revision !== state.data.revision) {
        state.data = {
          revision: remote.revision,
          expenses: Array.isArray(remote.data?.expenses) ? remote.data.expenses.map(normaliseExpense) : [],
          incomes: Array.isArray(remote.data?.incomes) ? remote.data.incomes.map(normaliseIncome) : [],
        };
        saveLocalData();
        renderAll();
        setSyncStatus('Synced (updated)');
      }
    } catch {
      setSyncStatus('Sync unavailable');
    }
  }, 12000);
}

function occurrenceCount(entry, startIso, endIso) {
  if (!entry.recurring) {
    return inRange(entry.date, startIso, endIso) ? 1 : 0;
  }
  const step = entry.frequency;
  let count = 0;
  let current = parseIsoDate(entry.date);
  const end = parseIsoDate(endIso);
  while (current <= end) {
    const iso = current.toISOString().slice(0, 10);
    if (inRange(iso, startIso, endIso)) count += 1;
    if (step === 'weekly') current = addDays(current, 7);
    if (step === 'monthly') current = addMonths(current, 1);
    if (step === 'yearly') current = addMonths(current, 12);
  }
  return count;
}

function amountForPeriod(entry, startIso, endIso) {
  if (entry.incomeType === 'temporary' && entry.recurring) {
    const now = todayIso();
    if (startIso > now) return 0;
    const cappedEnd = endIso > now ? now : endIso;
    return entry.amount * occurrenceCount(entry, startIso, cappedEnd);
  }
  return entry.amount * occurrenceCount(entry, startIso, endIso);
}

function computeMetrics() {
  const { start, end } = startAndEndForView();
  let totalIncome = 0;
  let grossExpense = 0;
  let linkedIncome = 0;
  let mandatory = 0;
  let avoidable = 0;

  const expenseCategoryTotals = new Map();
  state.data.expenses.forEach((e) => {
    const amount = amountForPeriod(e, start, end);
    grossExpense += amount;
    expenseCategoryTotals.set(e.category.toLowerCase(), (expenseCategoryTotals.get(e.category.toLowerCase()) || 0) + amount);
    if (e.expenseType === 'mandatory') mandatory += amount;
    if (e.expenseType === 'avoidable') avoidable += amount;
  });

  state.data.incomes.forEach((i) => {
    const amount = amountForPeriod(i, start, end);
    totalIncome += amount;
    if (i.relatesToExpense && expenseCategoryTotals.has(i.relatesToExpense.toLowerCase())) {
      linkedIncome += amount;
    }
  });

  const netExpenseAfterLinkedIncome = grossExpense - linkedIncome;
  const remainingHouseholdIncome = totalIncome - grossExpense;
  return { totalIncome, grossExpense, linkedIncome, netExpenseAfterLinkedIncome, remainingHouseholdIncome, mandatory, avoidable };
}

function renderDashboard() {
  const m = computeMetrics();
  document.querySelector('#metricIncome').textContent = formatCurrency(m.totalIncome);
  document.querySelector('#metricGrossExpense').textContent = formatCurrency(m.grossExpense);
  document.querySelector('#metricLinkedIncome').textContent = formatCurrency(m.linkedIncome);
  document.querySelector('#metricNetExpense').textContent = formatCurrency(m.netExpenseAfterLinkedIncome);
  document.querySelector('#metricRemaining').textContent = formatCurrency(m.remainingHouseholdIncome);
  document.querySelector('#metricMandatory').textContent = formatCurrency(m.mandatory);
  document.querySelector('#metricAvoidable').textContent = formatCurrency(m.avoidable);
}

function renderTables() {
  const expenseBody = document.querySelector('#expenseTableBody');
  const incomeBody = document.querySelector('#incomeTableBody');
  expenseBody.innerHTML = state.data.expenses
    .sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`))
    .map(
      (e) => `<tr>
      <td>${formatDate(e.date)}</td>
      <td>${formatCurrency(e.amount)}</td>
      <td>${escapeHtml(e.frequency)}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.expenseType)}</td>
      <td>${escapeHtml(e.recurring ? 'Yes' : 'No')}</td>
      <td>${escapeHtml(e.note || '-')}</td>
      <td><div class="table-actions"><button type="button" class="small secondary" data-action="edit-expense" data-id="${e.id}">Edit</button><button type="button" class="small danger" data-action="delete-expense" data-id="${e.id}">Delete</button></div></td>
    </tr>`,
    )
    .join('');
  if (!expenseBody.innerHTML) expenseBody.innerHTML = '<tr><td colspan="8" class="muted">No expenses yet.</td></tr>';

  incomeBody.innerHTML = state.data.incomes
    .sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`))
    .map(
      (i) => `<tr>
      <td>${formatDate(i.date)}</td>
      <td>${formatCurrency(i.amount)}</td>
      <td>${escapeHtml(i.frequency)}</td>
      <td>${escapeHtml(i.category)}</td>
      <td>${escapeHtml(i.relatesToExpense || '-')}</td>
      <td>${escapeHtml(i.incomeType)}</td>
      <td>${escapeHtml(i.recurring ? 'Yes' : 'No')}</td>
      <td>${escapeHtml(i.note || '-')}</td>
      <td><div class="table-actions"><button type="button" class="small secondary" data-action="edit-income" data-id="${i.id}">Edit</button><button type="button" class="small danger" data-action="delete-income" data-id="${i.id}">Delete</button></div></td>
    </tr>`,
    )
    .join('');
  if (!incomeBody.innerHTML) incomeBody.innerHTML = '<tr><td colspan="9" class="muted">No income yet.</td></tr>';
}

function renderTabs() {
  document.querySelectorAll('[data-tab-panel]').forEach((x) => x.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x.dataset.tab === state.activeTab));
  document.querySelector(`#tab-${state.activeTab}`).classList.remove('hidden');
}

function renderAll() {
  document.querySelector('#signedInName').textContent = state.user;
  document.querySelector('#syncStatus').textContent = state.syncStatus;
  document.querySelector('#viewMode').value = state.view.mode;
  document.querySelector('#viewMonth').value = state.view.month;
  document.querySelector('#viewYear').value = state.view.year;
  document.querySelector('#viewMonthWrap').classList.toggle('hidden', state.view.mode !== 'monthly');
  document.querySelector('#viewYearWrap').classList.toggle('hidden', state.view.mode !== 'yearly');
  renderTabs();
  renderDashboard();
  renderTables();
}

function resetExpenseForm() {
  state.editingExpenseId = null;
  const form = document.querySelector('#expenseForm');
  form.reset();
  form.expenseDate.value = todayIso();
  form.expenseFrequency.value = 'monthly';
  form.expenseCategoryPreset.value = EXPENSE_CATEGORIES[0];
  form.expenseCategoryCustom.value = '';
  form.expenseType.value = 'mandatory';
  form.recurring.value = 'yes';
  toggleCustomCategory('expense');
  document.querySelector('#saveExpenseButton').textContent = 'Save expense';
  document.querySelector('#cancelExpenseEditButton').classList.add('hidden');
}

function resetIncomeForm() {
  state.editingIncomeId = null;
  const form = document.querySelector('#incomeForm');
  form.reset();
  form.incomeDate.value = todayIso();
  form.incomeFrequency.value = 'monthly';
  form.incomeCategoryPreset.value = INCOME_CATEGORIES[0];
  form.incomeCategoryCustom.value = '';
  form.incomeType.value = 'permanent';
  form.recurring.value = 'yes';
  toggleCustomCategory('income');
  document.querySelector('#saveIncomeButton').textContent = 'Save income';
  document.querySelector('#cancelIncomeEditButton').classList.add('hidden');
}

function toggleCustomCategory(kind) {
  const preset = document.querySelector(
    kind === 'expense' ? '#expenseCategoryPreset' : '#incomeCategoryPreset',
  );
  const wrap = document.querySelector(
    kind === 'expense' ? '#expenseCategoryCustomWrap' : '#incomeCategoryCustomWrap',
  );
  const input = document.querySelector(
    kind === 'expense' ? '#expenseCategoryCustom' : '#incomeCategoryCustom',
  );
  const isCustom = preset.value === CUSTOM_CATEGORY_VALUE;
  wrap.classList.toggle('hidden', !isCustom);
  input.required = isCustom;
  if (!isCustom) input.value = '';
}

function resolveCategory(form, kind) {
  const preset = String(
    form.get(kind === 'expense' ? 'expenseCategoryPreset' : 'incomeCategoryPreset') || '',
  ).trim();
  if (preset && preset !== CUSTOM_CATEGORY_VALUE) return preset;
  const custom = String(
    form.get(kind === 'expense' ? 'expenseCategoryCustom' : 'incomeCategoryCustom') || '',
  ).trim();
  if (!custom) throw new Error('Enter a category.');
  return custom;
}

async function handleSaveExpense(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const entry = normaliseExpense({
    id: state.editingExpenseId || crypto.randomUUID(),
    amount: Number(form.get('amount')),
    date: String(form.get('expenseDate')),
    frequency: String(form.get('expenseFrequency')),
    category: resolveCategory(form, 'expense'),
    expenseType: String(form.get('expenseType')),
    recurring: String(form.get('recurring')) === 'yes',
    note: String(form.get('note') || '').trim(),
    createdAt: Date.now(),
  });
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error('Enter a valid expense amount.');
  if (state.editingExpenseId) {
    state.data.expenses = state.data.expenses.map((x) => (x.id === state.editingExpenseId ? entry : x));
  } else {
    state.data.expenses.unshift(entry);
  }
  await saveData();
  resetExpenseForm();
  renderExpenseCategoryList();
  renderAll();
}

async function handleSaveIncome(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const entry = normaliseIncome({
    id: state.editingIncomeId || crypto.randomUUID(),
    amount: Number(form.get('amount')),
    date: String(form.get('incomeDate')),
    frequency: String(form.get('incomeFrequency')),
    category: resolveCategory(form, 'income'),
    relatesToExpense: String(form.get('relatesToExpense') || '').trim(),
    incomeType: String(form.get('incomeType')),
    recurring: String(form.get('recurring')) === 'yes',
    note: String(form.get('note') || '').trim(),
    createdAt: Date.now(),
  });
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error('Enter a valid income amount.');
  if (state.editingIncomeId) {
    state.data.incomes = state.data.incomes.map((x) => (x.id === state.editingIncomeId ? entry : x));
  } else {
    state.data.incomes.unshift(entry);
  }
  await saveData();
  resetIncomeForm();
  renderAll();
}

function editExpense(id) {
  const row = state.data.expenses.find((x) => x.id === id);
  if (!row) return;
  state.activeTab = 'expense';
  renderTabs();
  state.editingExpenseId = id;
  const form = document.querySelector('#expenseForm');
  form.amount.value = row.amount.toFixed(2);
  form.expenseDate.value = row.date;
  form.expenseFrequency.value = row.frequency;
  if (EXPENSE_CATEGORIES.includes(row.category)) {
    form.expenseCategoryPreset.value = row.category;
    form.expenseCategoryCustom.value = '';
  } else {
    form.expenseCategoryPreset.value = CUSTOM_CATEGORY_VALUE;
    form.expenseCategoryCustom.value = row.category;
  }
  form.expenseType.value = row.expenseType;
  form.recurring.value = row.recurring ? 'yes' : 'no';
  form.note.value = row.note || '';
  toggleCustomCategory('expense');
  document.querySelector('#saveExpenseButton').textContent = 'Update expense';
  document.querySelector('#cancelExpenseEditButton').classList.remove('hidden');
}

function editIncome(id) {
  const row = state.data.incomes.find((x) => x.id === id);
  if (!row) return;
  state.activeTab = 'income';
  renderTabs();
  state.editingIncomeId = id;
  const form = document.querySelector('#incomeForm');
  form.amount.value = row.amount.toFixed(2);
  form.incomeDate.value = row.date;
  form.incomeFrequency.value = row.frequency;
  if (INCOME_CATEGORIES.includes(row.category)) {
    form.incomeCategoryPreset.value = row.category;
    form.incomeCategoryCustom.value = '';
  } else {
    form.incomeCategoryPreset.value = CUSTOM_CATEGORY_VALUE;
    form.incomeCategoryCustom.value = row.category;
  }
  form.relatesToExpense.value = row.relatesToExpense || '';
  form.incomeType.value = row.incomeType;
  form.recurring.value = row.recurring ? 'yes' : 'no';
  form.note.value = row.note || '';
  toggleCustomCategory('income');
  document.querySelector('#saveIncomeButton').textContent = 'Update income';
  document.querySelector('#cancelIncomeEditButton').classList.remove('hidden');
}

async function deleteExpense(id) {
  state.data.expenses = state.data.expenses.filter((x) => x.id !== id);
  await saveData();
  renderExpenseCategoryList();
  renderAll();
}

async function deleteIncome(id) {
  state.data.incomes = state.data.incomes.filter((x) => x.id !== id);
  await saveData();
  renderAll();
}

function exportJson() {
  const payload = { exportedAt: new Date().toISOString(), data: state.data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-finance-backup-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = [
    ...state.data.expenses.map((x) => ({
      kind: 'expense',
      amount_eur: x.amount.toFixed(2),
      date: x.date,
      frequency: x.frequency,
      category: x.category,
      mandatory_or_avoidable: x.expenseType,
      recurring: x.recurring ? 'yes' : 'no',
      relates_to_expense: '',
      permanent_or_temporary: '',
      note: x.note || '',
    })),
    ...state.data.incomes.map((x) => ({
      kind: 'income',
      amount_eur: x.amount.toFixed(2),
      date: x.date,
      frequency: x.frequency,
      category: x.category,
      mandatory_or_avoidable: '',
      recurring: x.recurring ? 'yes' : 'no',
      relates_to_expense: x.relatesToExpense || '',
      permanent_or_temporary: x.incomeType,
      note: x.note || '',
    })),
  ];
  if (!rows.length) throw new Error('No entries to export.');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => `"${String(r[h]).replaceAll('"', '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-finance-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExcel() {
  const rows = [
    ...state.data.expenses.map((x) => ({
      Kind: 'Expense',
      Amount_EUR: Number(x.amount.toFixed(2)),
      Date: x.date,
      Frequency: x.frequency,
      Category: x.category,
      Mandatory_or_Avoidable: x.expenseType,
      Recurring: x.recurring ? 'Yes' : 'No',
      Relates_to_Expense: '',
      Permanent_or_Temporary: '',
      Note: x.note || '',
    })),
    ...state.data.incomes.map((x) => ({
      Kind: 'Income',
      Amount_EUR: Number(x.amount.toFixed(2)),
      Date: x.date,
      Frequency: x.frequency,
      Category: x.category,
      Mandatory_or_Avoidable: '',
      Recurring: x.recurring ? 'Yes' : 'No',
      Relates_to_Expense: x.relatesToExpense || '',
      Permanent_or_Temporary: x.incomeType,
      Note: x.note || '',
    })),
  ];
  if (!rows.length) throw new Error('No entries to export.');
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Entries');
  writeFileXLSX(wb, `household-finance-${todayIso()}.xlsx`);
}

async function restoreJson(file) {
  const payload = JSON.parse(await file.text());
  const expenses = Array.isArray(payload?.data?.expenses) ? payload.data.expenses.map(normaliseExpense) : null;
  const incomes = Array.isArray(payload?.data?.incomes) ? payload.data.incomes.map(normaliseIncome) : null;
  if (!expenses || !incomes) throw new Error('Invalid backup file.');
  state.data.expenses = expenses;
  state.data.incomes = incomes;
  await saveData();
  renderAll();
}

function renderShell() {
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <section id="toast" class="card hidden"></section>

      <section id="gateView" class="card">
        <h1>Household Finance Tracker</h1>
        <form id="unlockForm" class="stack">
          <label>Name <input name="name" required maxlength="60" /></label>
          <label>Date of birth <input name="dob" type="date" required /></label>
          <button type="submit">Enter</button>
        </form>
      </section>

      <section id="appView" class="hidden">
        <div class="card topbar">
          <div>
            <h2>Household Finance</h2>
            <p class="muted">Opened by <strong id="signedInName"></strong> • <span id="syncStatus"></span></p>
          </div>
          <button id="lockButton" class="secondary" type="button">Lock</button>
        </div>

        <section class="card">
          <div class="toolbar">
            <label>View
              <select id="viewMode">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label id="viewMonthWrap">Month <input id="viewMonth" type="month" /></label>
            <label id="viewYearWrap" class="hidden">Year <input id="viewYear" type="number" min="2000" max="2100" /></label>
            <button id="reloadButton" class="secondary" type="button">Refresh shared data</button>
          </div>
          <div class="grid cards3">
            <article class="card stat"><p class="muted">Household income</p><h3 id="metricIncome">€0.00</h3></article>
            <article class="card stat"><p class="muted">Gross expenses</p><h3 id="metricGrossExpense">€0.00</h3></article>
            <article class="card stat"><p class="muted">Income linked to expenses</p><h3 id="metricLinkedIncome">€0.00</h3></article>
          </div>
          <div class="grid cards4">
            <article class="card stat"><p class="muted">Net expenses after linked income</p><h3 id="metricNetExpense">€0.00</h3></article>
            <article class="card stat"><p class="muted">Remaining household income</p><h3 id="metricRemaining">€0.00</h3></article>
            <article class="card stat"><p class="muted">Mandatory expenses</p><h3 id="metricMandatory">€0.00</h3></article>
            <article class="card stat"><p class="muted">Avoidable expenses</p><h3 id="metricAvoidable">€0.00</h3></article>
          </div>
        </section>

        <section class="card tabs">
          <button class="tab-btn active" data-tab="expense" type="button">Add Expense</button>
          <button class="tab-btn" data-tab="income" type="button">Add Income</button>
        </section>

        <section id="tab-expense" data-tab-panel class="card">
          <form id="expenseForm" class="grid-form">
            <label>Amount <input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Expense date <input name="expenseDate" type="date" required /></label>
            <label>Frequency <select name="expenseFrequency">${FREQUENCIES.map((x) => `<option value="${x}">${x}</option>`).join('')}</select></label>
            <label>Category
              <select id="expenseCategoryPreset" name="expenseCategoryPreset">
                ${toOptions(EXPENSE_CATEGORIES)}
                <option value="${CUSTOM_CATEGORY_VALUE}">Other (type your own)</option>
              </select>
            </label>
            <label id="expenseCategoryCustomWrap" class="hidden">Custom category <input id="expenseCategoryCustom" name="expenseCategoryCustom" maxlength="60" /></label>
            <label>Mandatory or Avoidable <select name="expenseType">${EXPENSE_TYPES.map((x) => `<option value="${x}">${x}</option>`).join('')}</select></label>
            <label>Recurring <select name="recurring"><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label class="wide">Optional note <textarea name="note" maxlength="300"></textarea></label>
            <div class="actions">
              <button id="saveExpenseButton" type="submit">Save expense</button>
              <button id="cancelExpenseEditButton" class="secondary hidden" type="button">Cancel edit</button>
            </div>
          </form>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Frequency</th><th>Category</th><th>Type</th><th>Recurring</th><th>Note</th><th>Actions</th></tr></thead>
              <tbody id="expenseTableBody"></tbody>
            </table>
          </div>
        </section>

        <section id="tab-income" data-tab-panel class="card hidden">
          <form id="incomeForm" class="grid-form">
            <label>Amount <input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Income date <input name="incomeDate" type="date" required /></label>
            <label>Frequency <select name="incomeFrequency">${FREQUENCIES.map((x) => `<option value="${x}">${x}</option>`).join('')}</select></label>
            <label>Category
              <select id="incomeCategoryPreset" name="incomeCategoryPreset">
                ${toOptions(INCOME_CATEGORIES)}
                <option value="${CUSTOM_CATEGORY_VALUE}">Other (type your own)</option>
              </select>
            </label>
            <label id="incomeCategoryCustomWrap" class="hidden">Custom category <input id="incomeCategoryCustom" name="incomeCategoryCustom" maxlength="60" /></label>
            <label>Relates to Expense (optional) <input name="relatesToExpense" maxlength="60" list="expenseCategoryList" /></label>
            <label>Permanent or Temporary <select name="incomeType">${INCOME_TYPES.map((x) => `<option value="${x}">${x}</option>`).join('')}</select></label>
            <label>Recurring <select name="recurring"><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label class="wide">Optional note <textarea name="note" maxlength="300"></textarea></label>
            <div class="actions">
              <button id="saveIncomeButton" type="submit">Save income</button>
              <button id="cancelIncomeEditButton" class="secondary hidden" type="button">Cancel edit</button>
            </div>
          </form>
          <datalist id="expenseCategoryList"></datalist>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Frequency</th><th>Category</th><th>Relates to Expense</th><th>Type</th><th>Recurring</th><th>Note</th><th>Actions</th></tr></thead>
              <tbody id="incomeTableBody"></tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <div class="toolbar">
            <button id="exportCsvButton" class="secondary" type="button">Export CSV</button>
            <button id="exportExcelButton" class="secondary" type="button">Export Excel</button>
            <button id="backupButton" class="secondary" type="button">Backup JSON</button>
            <label class="file-label secondary">Restore JSON<input id="restoreInput" type="file" accept=".json,application/json" /></label>
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderExpenseCategoryList() {
  const set = new Set(state.data.expenses.map((x) => x.category).filter(Boolean));
  document.querySelector('#expenseCategoryList').innerHTML = Array.from(set)
    .sort((a, b) => a.localeCompare(b))
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join('');
}

function setVisibleView(target) {
  const gate = document.querySelector('#gateView');
  const app = document.querySelector('#appView');
  if (!gate || !app) return;
  gate.classList.toggle('hidden', target !== '#gateView');
  app.classList.toggle('hidden', target !== '#appView');
}

function bindEvents() {
  document.querySelector('#unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const nameRaw = String(fd.get('name') || '').trim();
    const dob = String(fd.get('dob') || '').trim();
    if (!nameRaw || !(await isAllowedName(nameRaw)) || dob !== todayIso()) {
      showToast('Access denied.', true);
      return;
    }
    state.user = nameRaw;
    state.unlocked = true;
    sessionStorage.setItem(SESSION_UNLOCK_KEY, JSON.stringify({ user: state.user, ts: Date.now() }));
    setVisibleView('#appView');
    resetExpenseForm();
    resetIncomeForm();
    renderExpenseCategoryList();
    renderAll();
    startPolling();
  });

  document.querySelector('#lockButton').addEventListener('click', () => {
    state.unlocked = false;
    state.user = '';
    sessionStorage.removeItem(SESSION_UNLOCK_KEY);
    if (state.pollHandle) clearInterval(state.pollHandle);
    state.pollHandle = null;
    setVisibleView('#gateView');
  });

  document.querySelectorAll('.tab-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderTabs();
    }),
  );

  document.querySelector('#expenseForm').addEventListener('submit', (e) =>
    handleSaveExpense(e).catch((err) => showToast(err.message, true)),
  );
  document.querySelector('#incomeForm').addEventListener('submit', (e) =>
    handleSaveIncome(e).catch((err) => showToast(err.message, true)),
  );
  document.querySelector('#cancelExpenseEditButton').addEventListener('click', resetExpenseForm);
  document.querySelector('#cancelIncomeEditButton').addEventListener('click', resetIncomeForm);
  document.querySelector('#expenseCategoryPreset').addEventListener('change', () => toggleCustomCategory('expense'));
  document.querySelector('#incomeCategoryPreset').addEventListener('change', () => toggleCustomCategory('income'));

  document.querySelector('#expenseTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-expense') editExpense(id);
    if (btn.dataset.action === 'delete-expense' && window.confirm('Delete this expense?')) {
      deleteExpense(id).catch((err) => showToast(err.message, true));
    }
  });
  document.querySelector('#incomeTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-income') editIncome(id);
    if (btn.dataset.action === 'delete-income' && window.confirm('Delete this income?')) {
      deleteIncome(id).catch((err) => showToast(err.message, true));
    }
  });

  document.querySelector('#viewMode').addEventListener('change', (e) => {
    state.view.mode = e.target.value;
    renderAll();
  });
  document.querySelector('#viewMonth').addEventListener('change', (e) => {
    state.view.month = e.target.value || todayMonth();
    renderAll();
  });
  document.querySelector('#viewYear').addEventListener('change', (e) => {
    state.view.year = String(e.target.value || new Date().getFullYear());
    renderAll();
  });
  document.querySelector('#reloadButton').addEventListener('click', () =>
    loadData()
      .then(() => {
        renderExpenseCategoryList();
        renderAll();
      })
      .catch((err) => showToast(err.message, true)),
  );

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
  document.querySelector('#backupButton').addEventListener('click', exportJson);
  document.querySelector('#restoreInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await restoreJson(file);
      renderExpenseCategoryList();
      renderAll();
      showToast('Backup restored.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      e.target.value = '';
    }
  });
}

async function main() {
  renderShell();
  bindEvents();
  await loadData();

  const session = loadJson(SESSION_UNLOCK_KEY, null);
  if (session?.user && ALLOWED_SESSION_NAMES.has(String(session.user))) {
    state.user = String(session.user);
    state.unlocked = true;
    setVisibleView('#appView');
    resetExpenseForm();
    resetIncomeForm();
    renderExpenseCategoryList();
    renderAll();
    startPolling();
  } else {
    setVisibleView('#gateView');
  }
}

main().catch((err) => showToast(err.message, true));
