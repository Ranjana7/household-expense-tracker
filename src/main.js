import { utils, writeFileXLSX } from 'xlsx';
import './style.css';

const STORAGE_KEY = 'household-finance-v2';
const SESSION_UNLOCK_KEY = 'household-finance-session-v2';
const APPROVED_NAMES = ['ranjana', 'ranjana garg', 'ak', 'ak sharma'];
const LOCALE = 'en-IE';
const CURRENCY = 'EUR';
const FREQUENCIES = ['one-time', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom-months'];
const EXPENSE_CLASSES = ['mandatory', 'reducible', 'optional'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DEFAULT_DATA = {
  monthlyBudget: 0,
  categories: ['Groceries', 'Utilities', 'Mortgage', 'Insurance', 'Maintenance', 'Salary', 'Rental Income', 'Subscriptions', 'Transport', 'Other'],
  groups: [
    { id: 'general-household', name: 'General Household' },
    { id: 'main-residence', name: 'Main Residence' },
    { id: 'rental-property-1', name: 'Rental Property 1' },
  ],
  transactions: [],
};

const state = {
  user: '',
  unlocked: false,
  tab: 'dashboard',
  data: structuredClone(DEFAULT_DATA),
  filters: { q: '', type: '', groupId: '', month: '' },
  editingId: null,
  scenario: {
    removedIncomeIds: [],
    incomeOverrides: {},
    optionalReductionPct: 0,
  },
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function formatCurrency(value) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(Number(value || 0));
}

function formatDate(iso) {
  return new Intl.DateTimeFormat(LOCALE).format(new Date(`${iso}T00:00:00`));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function endOfMonth(ym) {
  const [year, month] = ym.split('-').map(Number);
  const d = new Date(year, month, 0);
  return d.toISOString().slice(0, 10);
}

function dateInRange(iso, startIso, endIso) {
  if (startIso && iso < startIso) return false;
  if (endIso && iso > endIso) return false;
  return true;
}

function normaliseTransaction(raw) {
  return {
    id: raw.id || crypto.randomUUID(),
    type: raw.type === 'income' ? 'income' : 'expense',
    amount: Number(raw.amount || 0),
    category: String(raw.category || 'Other'),
    groupId: String(raw.groupId || 'general-household'),
    date: String(raw.date || todayIso()),
    frequency: FREQUENCIES.includes(raw.frequency) ? raw.frequency : 'one-time',
    startDate: raw.startDate ? String(raw.startDate) : '',
    endDate: raw.endDate ? String(raw.endDate) : '',
    customMonths: Array.isArray(raw.customMonths) ? raw.customMonths.map(Number).filter((x) => x >= 1 && x <= 12) : [],
    classification: EXPENSE_CLASSES.includes(raw.classification) ? raw.classification : 'reducible',
    description: String(raw.description || ''),
    createdAt: Number(raw.createdAt || Date.now()),
  };
}

function migrateData(oldData) {
  if (!oldData || typeof oldData !== 'object') return structuredClone(DEFAULT_DATA);
  if (Array.isArray(oldData.transactions)) {
    return {
      monthlyBudget: Number(oldData.monthlyBudget || 0),
      categories: Array.isArray(oldData.categories) && oldData.categories.length ? oldData.categories.map(String) : structuredClone(DEFAULT_DATA.categories),
      groups: Array.isArray(oldData.groups) && oldData.groups.length ? oldData.groups.map((g) => ({ id: String(g.id), name: String(g.name) })) : structuredClone(DEFAULT_DATA.groups),
      transactions: oldData.transactions.map(normaliseTransaction).filter((t) => t.amount > 0),
    };
  }

  const legacyExpenses = Array.isArray(oldData.expenses) ? oldData.expenses : [];
  return {
    monthlyBudget: Number(oldData.monthlyBudget || 0),
    categories: structuredClone(DEFAULT_DATA.categories),
    groups: structuredClone(DEFAULT_DATA.groups),
    transactions: legacyExpenses.map((x) =>
      normaliseTransaction({
        id: x.id,
        type: 'expense',
        amount: x.amount,
        category: x.category || 'Other',
        groupId: 'general-household',
        date: x.expense_date || todayIso(),
        frequency: 'one-time',
        classification: x.classification || 'reducible',
        description: x.description || x.notes || '',
        createdAt: Date.now(),
      }),
    ),
  };
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

function txStart(tx) {
  return tx.startDate || tx.date;
}

function txEnd(tx) {
  return tx.endDate || '';
}

function countOccurrencesInRange(tx, rangeStart, rangeEnd) {
  const start = txStart(tx);
  const end = txEnd(tx);
  if (!dateInRange(rangeStart, start, end) && !dateInRange(rangeEnd, start, end) && rangeEnd < start) return 0;

  if (tx.frequency === 'one-time') {
    return tx.date >= rangeStart && tx.date <= rangeEnd ? 1 : 0;
  }

  if (tx.frequency === 'custom-months') {
    const months = tx.customMonths.length ? tx.customMonths : [parseIsoDate(tx.date).getMonth() + 1];
    let count = 0;
    const startDate = parseIsoDate(rangeStart);
    const endDate = parseIsoDate(rangeEnd);
    for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y += 1) {
      for (const m of months) {
        const day = parseIsoDate(tx.date).getDate();
        const maxDay = new Date(y, m, 0).getDate();
        const occ = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
        if (occ >= rangeStart && occ <= rangeEnd && dateInRange(occ, start, end)) count += 1;
      }
    }
    return count;
  }

  let count = 0;
  let current = parseIsoDate(start);
  const endRange = parseIsoDate(rangeEnd);
  const startRange = parseIsoDate(rangeStart);
  const step = tx.frequency === 'weekly' ? 'weekly' : tx.frequency === 'monthly' ? 'monthly' : tx.frequency === 'quarterly' ? 'quarterly' : 'yearly';
  while (current <= endRange) {
    const iso = current.toISOString().slice(0, 10);
    if (iso >= rangeStart && iso <= rangeEnd && dateInRange(iso, start, end)) count += 1;
    if (step === 'weekly') current = addDays(current, 7);
    if (step === 'monthly') current = addMonths(current, 1);
    if (step === 'quarterly') current = addMonths(current, 3);
    if (step === 'yearly') current = addMonths(current, 12);
    if (current < startRange && step !== 'weekly') break;
  }
  return count;
}

function actualAmountForMonth(tx, ym) {
  const start = `${ym}-01`;
  const end = endOfMonth(ym);
  return tx.amount * countOccurrencesInRange(tx, start, end);
}

function actualAmountForYear(tx, year) {
  return tx.amount * countOccurrencesInRange(tx, `${year}-01-01`, `${year}-12-31`);
}

function normalisedMonthlyAmount(tx) {
  if (tx.frequency === 'weekly') return (tx.amount * 52) / 12;
  if (tx.frequency === 'monthly') return tx.amount;
  if (tx.frequency === 'quarterly') return tx.amount / 3;
  if (tx.frequency === 'yearly') return tx.amount / 12;
  if (tx.frequency === 'custom-months') {
    const months = tx.customMonths.length ? tx.customMonths.length : 1;
    return (tx.amount * months) / 12;
  }
  return 0;
}

function groupName(id) {
  return state.data.groups.find((g) => g.id === id)?.name || 'Unknown group';
}

function uniqueMonthsFromActuals() {
  const set = new Set();
  const today = todayIso();
  set.add(monthKey(today));
  state.data.transactions.forEach((tx) => {
    const start = txStart(tx) || tx.date;
    const end = txEnd(tx) || today;
    set.add(monthKey(start));
    set.add(monthKey(end));
  });
  return Array.from(set).sort();
}

function computeMonthlySeries(months = 12) {
  const now = new Date(`${todayIso()}T00:00:00`);
  const keys = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = addMonths(now, -i);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys.map((ym) => {
    let income = 0;
    let expense = 0;
    state.data.transactions.forEach((tx) => {
      const value = actualAmountForMonth(tx, ym);
      if (tx.type === 'income') income += value;
      else expense += value;
    });
    return { ym, income, expense, net: income - expense };
  });
}

function filteredTransactions() {
  const q = state.filters.q.trim().toLowerCase();
  return state.data.transactions.filter((t) => {
    const byQ = !q || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || groupName(t.groupId).toLowerCase().includes(q);
    const byType = !state.filters.type || t.type === state.filters.type;
    const byGroup = !state.filters.groupId || t.groupId === state.filters.groupId;
    const byMonth = !state.filters.month || actualAmountForMonth(t, state.filters.month) > 0;
    return byQ && byType && byGroup && byMonth;
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

function computeDashboardMetrics() {
  const today = todayIso();
  const ym = monthKey(today);
  const year = Number(ym.slice(0, 4));

  let actualMonthlyIncome = 0;
  let actualMonthlyExpense = 0;
  let actualYearlyIncome = 0;
  let actualYearlyExpense = 0;
  let normalisedIncome = 0;
  let normalisedExpense = 0;
  let normalisedMandatory = 0;
  let normalisedOptional = 0;
  let normalisedReducible = 0;

  const groups = new Map(state.data.groups.map((g) => [g.id, { id: g.id, name: g.name, monthIncome: 0, monthExpense: 0, yearIncome: 0, yearExpense: 0 }]));

  state.data.transactions.forEach((tx) => {
    const monthValue = actualAmountForMonth(tx, ym);
    const yearValue = actualAmountForYear(tx, year);
    const norm = normalisedMonthlyAmount(tx);
    const group = groups.get(tx.groupId);

    if (tx.type === 'income') {
      actualMonthlyIncome += monthValue;
      actualYearlyIncome += yearValue;
      normalisedIncome += norm;
      if (group) {
        group.monthIncome += monthValue;
        group.yearIncome += yearValue;
      }
    } else {
      actualMonthlyExpense += monthValue;
      actualYearlyExpense += yearValue;
      normalisedExpense += norm;
      if (tx.classification === 'mandatory') normalisedMandatory += norm;
      if (tx.classification === 'optional') normalisedOptional += norm;
      if (tx.classification === 'reducible') normalisedReducible += norm;
      if (group) {
        group.monthExpense += monthValue;
        group.yearExpense += yearValue;
      }
    }
  });

  const series = computeMonthlySeries(12);
  const avgMonthlyCost = series.length ? series.reduce((s, x) => s + x.expense, 0) / series.length : 0;
  const annualCommitments = normalisedExpense * 12;

  return {
    ym,
    year,
    actualMonthlyIncome,
    actualMonthlyExpense,
    actualMonthlyNet: actualMonthlyIncome - actualMonthlyExpense,
    actualYearlyIncome,
    actualYearlyExpense,
    actualYearlyNet: actualYearlyIncome - actualYearlyExpense,
    normalisedIncome,
    normalisedExpense,
    normalisedNet: normalisedIncome - normalisedExpense,
    normalisedMandatory,
    normalisedReducible,
    normalisedOptional,
    avgMonthlyCost,
    annualCommitments,
    groupRows: Array.from(groups.values()),
    series,
  };
}

function renderDashboardTab() {
  const m = computeDashboardMetrics();
  document.querySelector('#dashActualIncome').textContent = formatCurrency(m.actualMonthlyIncome);
  document.querySelector('#dashActualExpense').textContent = formatCurrency(m.actualMonthlyExpense);
  document.querySelector('#dashActualNet').textContent = formatCurrency(m.actualMonthlyNet);
  document.querySelector('#dashNormIncome').textContent = formatCurrency(m.normalisedIncome);
  document.querySelector('#dashNormExpense').textContent = formatCurrency(m.normalisedExpense);
  document.querySelector('#dashNormNet').textContent = formatCurrency(m.normalisedNet);
  document.querySelector('#dashMandatory').textContent = formatCurrency(m.normalisedMandatory);
  document.querySelector('#dashOptional').textContent = formatCurrency(m.normalisedOptional);
  document.querySelector('#dashAvgCost').textContent = formatCurrency(m.avgMonthlyCost);
  document.querySelector('#dashAnnualCommit').textContent = formatCurrency(m.annualCommitments);
  document.querySelector('#dashYearIncome').textContent = formatCurrency(m.actualYearlyIncome);
  document.querySelector('#dashYearExpense').textContent = formatCurrency(m.actualYearlyExpense);

  const budgetFill = document.querySelector('#budgetFill');
  const budgetStatus = document.querySelector('#budgetStatus');
  document.querySelector('#budgetAmount').value = Number(state.data.monthlyBudget || 0).toFixed(2);
  if (state.data.monthlyBudget > 0) {
    const ratio = (m.actualMonthlyExpense / state.data.monthlyBudget) * 100;
    budgetFill.style.width = `${Math.min(Math.round(ratio), 100)}%`;
    budgetFill.className = ratio >= 100 ? 'danger-fill' : ratio >= 80 ? 'warn-fill' : '';
    budgetStatus.textContent =
      ratio >= 100
        ? `Over budget by ${formatCurrency(m.actualMonthlyExpense - state.data.monthlyBudget)}`
        : `Remaining budget: ${formatCurrency(state.data.monthlyBudget - m.actualMonthlyExpense)}`;
  } else {
    budgetFill.style.width = '0%';
    budgetFill.className = '';
    budgetStatus.textContent = 'Set a monthly budget if you want overspend alerts.';
  }

  const categorySums = new Map();
  const groupSums = new Map();
  state.data.transactions.forEach((tx) => {
    if (tx.type !== 'expense') return;
    const value = actualAmountForMonth(tx, m.ym);
    categorySums.set(tx.category, (categorySums.get(tx.category) || 0) + value);
    groupSums.set(groupName(tx.groupId), (groupSums.get(groupName(tx.groupId)) || 0) + value);
  });
  renderBars('#dashCategoryBars', Array.from(categorySums.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value));
  renderBars('#dashGroupBars', Array.from(groupSums.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value));

  renderBars(
    '#dashTrendBars',
    m.series.map((x) => ({ label: x.ym, value: x.expense })),
  );

  const groupBody = document.querySelector('#groupPerfBody');
  groupBody.innerHTML = m.groupRows
    .map((g) => {
      const monthNet = g.monthIncome - g.monthExpense;
      const yearNet = g.yearIncome - g.yearExpense;
      return `<tr>
        <td>${escapeHtml(g.name)}</td>
        <td>${formatCurrency(g.monthIncome)}</td>
        <td>${formatCurrency(g.monthExpense)}</td>
        <td>${formatCurrency(monthNet)}</td>
        <td>${formatCurrency(g.yearIncome)}</td>
        <td>${formatCurrency(g.yearExpense)}</td>
        <td>${formatCurrency(yearNet)}</td>
      </tr>`;
    })
    .join('');
}

function renderTransactionsTab() {
  const categoryOptions = state.data.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const groupOptions = state.data.groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
  document.querySelector('#txCategory').innerHTML = categoryOptions;
  document.querySelector('#txGroup').innerHTML = groupOptions;
  document.querySelector('#filterGroup').innerHTML = `<option value="">All groups</option>${groupOptions}`;
  document.querySelector('#filterMonth').innerHTML = `<option value="">All months</option>${uniqueMonthsFromActuals().map((x) => `<option value="${x}">${x}</option>`).join('')}`;
  document.querySelector('#filterType').value = state.filters.type;
  document.querySelector('#filterGroup').value = state.filters.groupId;
  document.querySelector('#filterMonth').value = state.filters.month;
  document.querySelector('#filterQ').value = state.filters.q;
  if (!state.editingId) {
    document.querySelector('#txGroup').value = 'general-household';
  }

  const body = document.querySelector('#txTableBody');
  const rows = filteredTransactions();
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11" class="muted">No transactions.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`))
    .map((tx) => {
      const amountLabel = tx.type === 'income' ? formatCurrency(tx.amount) : `-${formatCurrency(tx.amount)}`;
      return `<tr>
        <td>${escapeHtml(tx.type)}</td>
        <td>${amountLabel}</td>
        <td>${escapeHtml(tx.category)}</td>
        <td>${escapeHtml(groupName(tx.groupId))}</td>
        <td>${formatDate(tx.date)}</td>
        <td>${escapeHtml(tx.frequency)}</td>
        <td>${escapeHtml(tx.startDate || '-')}</td>
        <td>${escapeHtml(tx.endDate || '-')}</td>
        <td>${escapeHtml(tx.classification || '-')}</td>
        <td>${escapeHtml(tx.description || '-')}</td>
        <td><div class="table-actions"><button class="small secondary" data-action="edit" data-id="${tx.id}" type="button">Edit</button><button class="small danger" data-action="delete" data-id="${tx.id}" type="button">Delete</button></div></td>
      </tr>`;
    })
    .join('');
}

function renderGroupsTab() {
  const rows = state.data.groups
    .map((g) => {
      const tx = state.data.transactions.filter((x) => x.groupId === g.id);
      return `<tr>
        <td>${escapeHtml(g.name)}</td>
        <td>${tx.filter((x) => x.type === 'income').length}</td>
        <td>${tx.filter((x) => x.type === 'expense').length}</td>
        <td>${tx.length}</td>
        <td><div class="table-actions"><button class="small secondary" data-action="rename-group" data-id="${g.id}" type="button">Rename</button><button class="small danger" data-action="delete-group" data-id="${g.id}" type="button">Delete</button></div></td>
      </tr>`;
    })
    .join('');
  document.querySelector('#groupsTableBody').innerHTML = rows || '<tr><td colspan="5" class="muted">No groups.</td></tr>';

  const catRows = state.data.categories
    .map((c) => `<tr><td>${escapeHtml(c)}</td><td><button class="small danger" data-action="delete-category" data-name="${escapeHtml(c)}" type="button">Delete</button></td></tr>`)
    .join('');
  document.querySelector('#categoriesTableBody').innerHTML = catRows || '<tr><td colspan="2" class="muted">No categories.</td></tr>';
}

function scenarioMonthlyIncome(tx) {
  const removed = state.scenario.removedIncomeIds.includes(tx.id);
  if (removed) return 0;
  const override = state.scenario.incomeOverrides[tx.id];
  if (override !== undefined && Number.isFinite(Number(override)) && Number(override) >= 0) return Number(override);
  return normalisedMonthlyAmount(tx);
}

function renderWhatIfTab() {
  const incomeTx = state.data.transactions.filter((x) => x.type === 'income');
  const expTx = state.data.transactions.filter((x) => x.type === 'expense');
  const monthlyIncome = incomeTx.reduce((s, tx) => s + scenarioMonthlyIncome(tx), 0);
  const mandatory = expTx.filter((x) => x.classification === 'mandatory').reduce((s, tx) => s + normalisedMonthlyAmount(tx), 0);
  const reducible = expTx.filter((x) => x.classification === 'reducible').reduce((s, tx) => s + normalisedMonthlyAmount(tx), 0);
  const optionalRaw = expTx.filter((x) => x.classification === 'optional').reduce((s, tx) => s + normalisedMonthlyAmount(tx), 0);
  const optionalAfter = optionalRaw * (1 - state.scenario.optionalReductionPct / 100);
  const monthlyExpense = mandatory + reducible + optionalAfter;
  const monthlyNet = monthlyIncome - monthlyExpense;
  const annualNet = monthlyNet * 12;

  document.querySelector('#whatIfIncome').textContent = formatCurrency(monthlyIncome);
  document.querySelector('#whatIfMandatory').textContent = formatCurrency(mandatory);
  document.querySelector('#whatIfOptional').textContent = formatCurrency(optionalAfter);
  document.querySelector('#whatIfExpense').textContent = formatCurrency(monthlyExpense);
  document.querySelector('#whatIfNetMonth').textContent = formatCurrency(monthlyNet);
  document.querySelector('#whatIfNetYear').textContent = formatCurrency(annualNet);
  document.querySelector('#optionalReductionLabel').textContent = `${state.scenario.optionalReductionPct}%`;
  document.querySelector('#optionalReduction').value = String(state.scenario.optionalReductionPct);

  const body = document.querySelector('#whatIfIncomeBody');
  body.innerHTML = incomeTx
    .map((tx) => {
      const checked = state.scenario.removedIncomeIds.includes(tx.id) ? '' : 'checked';
      const override = state.scenario.incomeOverrides[tx.id];
      const base = normalisedMonthlyAmount(tx);
      return `<tr>
        <td><input type="checkbox" data-action="toggle-income" data-id="${tx.id}" ${checked} /></td>
        <td>${escapeHtml(tx.description || tx.category)}</td>
        <td>${escapeHtml(groupName(tx.groupId))}</td>
        <td>${formatCurrency(base)}</td>
        <td><input type="number" min="0" step="0.01" data-action="override-income" data-id="${tx.id}" value="${override !== undefined ? Number(override).toFixed(2) : ''}" placeholder="Use base" /></td>
      </tr>`;
    })
    .join('');
}

function renderActiveTab() {
  document.querySelectorAll('[data-tab]').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tabTarget === state.tab));
  document.querySelector(`#tab-${state.tab}`).classList.remove('hidden');
  if (state.tab === 'dashboard') renderDashboardTab();
  if (state.tab === 'transactions') renderTransactionsTab();
  if (state.tab === 'groups') renderGroupsTab();
  if (state.tab === 'whatif') renderWhatIfTab();
}

function renderShell() {
  const monthChecks = MONTH_NAMES.map((m, i) => `<label class="month-item"><input type="checkbox" name="customMonths" value="${i + 1}" /> ${m}</label>`).join('');
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <section id="toast" class="card hidden"></section>

      <section id="gateView" class="card">
        <h1>Household Finance Tracker</h1>
        <p class="muted">Public GitHub-hosted app with a playful entry screen (not security/authentication).</p>
        <form id="unlockForm" class="stack">
          <label>Name <input name="name" required maxlength="60" /></label>
          <label>Date of birth <input name="dob" type="date" required /></label>
          <p class="muted">For this setup, DOB must be today’s date.</p>
          <button type="submit">Enter</button>
        </form>
      </section>

      <section id="appView" class="hidden">
        <div class="card topbar">
          <div>
            <h2>Household Finance</h2>
            <p class="muted">Opened by <strong id="signedInName"></strong></p>
          </div>
          <button id="lockButton" class="secondary">Lock</button>
        </div>

        <section class="card tabs">
          <button class="tab-btn active" data-tab-target="dashboard" type="button">Dashboard</button>
          <button class="tab-btn" data-tab-target="transactions" type="button">Transactions</button>
          <button class="tab-btn" data-tab-target="groups" type="button">Financial Groups</button>
          <button class="tab-btn" data-tab-target="whatif" type="button">What If?</button>
        </section>

        <section class="card" id="tab-dashboard" data-tab>
          <h3>Actual cash flow (this month)</h3>
          <div class="grid cards3">
            <article class="card stat"><p class="muted">Income</p><h3 id="dashActualIncome">€0.00</h3></article>
            <article class="card stat"><p class="muted">Expenses</p><h3 id="dashActualExpense">€0.00</h3></article>
            <article class="card stat"><p class="muted">Net cash flow</p><h3 id="dashActualNet">€0.00</h3></article>
          </div>
          <h3 class="section-title">Normalised monthly view</h3>
          <div class="grid cards3">
            <article class="card stat"><p class="muted">Normalised income</p><h3 id="dashNormIncome">€0.00</h3></article>
            <article class="card stat"><p class="muted">Normalised expenses</p><h3 id="dashNormExpense">€0.00</h3></article>
            <article class="card stat"><p class="muted">Normalised net</p><h3 id="dashNormNet">€0.00</h3></article>
          </div>
          <div class="grid cards4">
            <article class="card stat"><p class="muted">Mandatory expenses</p><h3 id="dashMandatory">€0.00</h3></article>
            <article class="card stat"><p class="muted">Optional expenses</p><h3 id="dashOptional">€0.00</h3></article>
            <article class="card stat"><p class="muted">Avg monthly costs</p><h3 id="dashAvgCost">€0.00</h3></article>
            <article class="card stat"><p class="muted">Estimated annual commitments</p><h3 id="dashAnnualCommit">€0.00</h3></article>
          </div>
          <div class="grid cards2">
            <article class="card stat"><p class="muted">Actual yearly income</p><h3 id="dashYearIncome">€0.00</h3></article>
            <article class="card stat"><p class="muted">Actual yearly expenses</p><h3 id="dashYearExpense">€0.00</h3></article>
          </div>
          <h3 class="section-title">Budget</h3>
          <form id="budgetForm" class="inline-form">
            <label>Monthly budget (EUR)<input id="budgetAmount" name="budget" type="number" min="0" step="0.01" required /></label>
            <button type="submit">Save budget</button>
          </form>
          <div class="progress"><span id="budgetFill"></span></div>
          <p class="muted" id="budgetStatus"></p>

          <div class="grid cards3">
            <section class="card"><h3>Expense by category (month)</h3><div id="dashCategoryBars" class="bars"></div></section>
            <section class="card"><h3>Expense by group (month)</h3><div id="dashGroupBars" class="bars"></div></section>
            <section class="card"><h3>Income vs expense trend</h3><div id="dashTrendBars" class="bars"></div></section>
          </div>

          <section class="card">
            <h3>Financial group performance (actual)</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Group</th><th>Month income</th><th>Month expense</th><th>Month net</th><th>Year income</th><th>Year expense</th><th>Year net</th></tr></thead>
                <tbody id="groupPerfBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="card hidden" id="tab-transactions" data-tab>
          <h3>Add Income / Add Expense</h3>
          <div class="toolbar">
            <button id="quickAddIncomeButton" type="button">Add Income</button>
            <button id="quickAddExpenseButton" class="secondary" type="button">Add Expense</button>
          </div>
          <form id="txForm" class="grid-form">
            <label>Type
              <select name="type" id="txType">
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </label>
            <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
            <label>Date<input name="date" type="date" required /></label>
            <label>Frequency
              <select name="frequency" id="txFrequency">${FREQUENCIES.map((f) => `<option value="${f}">${f}</option>`).join('')}</select>
            </label>
            <label>Start date<input name="startDate" type="date" /></label>
            <label>End date<input name="endDate" type="date" /></label>
            <label>Category
              <select name="category" id="txCategory"></select>
            </label>
            <label>Financial group
              <select name="groupId" id="txGroup"></select>
            </label>
            <label id="classificationWrap">Expense class
              <select name="classification" id="txClassification">${EXPENSE_CLASSES.map((x) => `<option value="${x}">${x}</option>`).join('')}</select>
            </label>
            <label class="wide">Description (optional)<textarea name="description" maxlength="300"></textarea></label>
            <fieldset id="customMonthsWrap" class="wide hidden">
              <legend>Months (for custom-months)</legend>
              <div class="month-grid">${monthChecks}</div>
            </fieldset>
            <div class="actions">
              <button type="submit" id="saveTxButton">Save transaction</button>
              <button type="button" id="cancelTxEditButton" class="secondary hidden">Cancel edit</button>
            </div>
          </form>

          <div class="split">
            <form id="addCategoryForm" class="stack">
              <h3>Add category</h3>
              <label>Category name<input name="name" maxlength="60" required /></label>
              <button type="submit">Add category</button>
            </form>
            <form id="addGroupQuickForm" class="stack">
              <h3>Add financial group</h3>
              <label>Group name<input name="name" maxlength="80" required /></label>
              <button type="submit">Add group</button>
            </form>
          </div>

          <section class="card">
            <h3>Search & filter</h3>
            <form id="txFilterForm" class="filters">
              <label>Search<input id="filterQ" name="q" placeholder="category, description, group..." /></label>
              <label>Type<select id="filterType" name="type"><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option></select></label>
              <label>Group<select id="filterGroup" name="groupId"></select></label>
              <label>Month<select id="filterMonth" name="month"></select></label>
              <button type="button" id="clearTxFilters" class="secondary">Clear</button>
            </form>
          </section>

          <section class="card">
            <div class="section-head">
              <h3>Transactions</h3>
              <div class="toolbar">
                <button id="exportCsvButton" class="secondary" type="button">Export CSV</button>
                <button id="exportExcelButton" class="secondary" type="button">Export Excel</button>
                <button id="backupButton" class="secondary" type="button">Backup JSON</button>
                <label class="file-label secondary">Restore JSON<input id="restoreInput" type="file" accept=".json,application/json" /></label>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Type</th><th>Amount</th><th>Category</th><th>Group</th><th>Date</th><th>Frequency</th><th>Start</th><th>End</th><th>Class</th><th>Description</th><th>Actions</th></tr></thead>
                <tbody id="txTableBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="card hidden" id="tab-groups" data-tab>
          <div class="split">
            <form id="addGroupForm" class="stack">
              <h3>Add financial group</h3>
              <label>Group name<input name="name" required maxlength="80" /></label>
              <button type="submit">Add group</button>
            </form>
            <form id="addCategoryForm2" class="stack">
              <h3>Add category</h3>
              <label>Category name<input name="name" required maxlength="60" /></label>
              <button type="submit">Add category</button>
            </form>
          </div>
          <section class="card">
            <h3>Financial groups</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Income streams</th><th>Expense streams</th><th>Total streams</th><th>Actions</th></tr></thead>
                <tbody id="groupsTableBody"></tbody>
              </table>
            </div>
          </section>
          <section class="card">
            <h3>Categories</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Actions</th></tr></thead>
                <tbody id="categoriesTableBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="card hidden" id="tab-whatif" data-tab>
          <h3>Scenario planner (does not change saved records)</h3>
          <label>Reduce optional expenses %
            <input id="optionalReduction" type="range" min="0" max="100" step="5" value="0" />
          </label>
          <p class="muted">Optional reduction: <strong id="optionalReductionLabel">0%</strong></p>

          <div class="grid cards3">
            <article class="card stat"><p class="muted">Scenario monthly income</p><h3 id="whatIfIncome">€0.00</h3></article>
            <article class="card stat"><p class="muted">Mandatory monthly expenses</p><h3 id="whatIfMandatory">€0.00</h3></article>
            <article class="card stat"><p class="muted">Optional monthly expenses (after reduction)</p><h3 id="whatIfOptional">€0.00</h3></article>
          </div>
          <div class="grid cards3">
            <article class="card stat"><p class="muted">Scenario monthly expenses</p><h3 id="whatIfExpense">€0.00</h3></article>
            <article class="card stat"><p class="muted">Monthly surplus / shortfall</p><h3 id="whatIfNetMonth">€0.00</h3></article>
            <article class="card stat"><p class="muted">Annual surplus / shortfall</p><h3 id="whatIfNetYear">€0.00</h3></article>
          </div>

          <section class="card">
            <h3>Adjust income streams</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Use</th><th>Income stream</th><th>Group</th><th>Base normalised/month</th><th>Override/month (optional)</th></tr></thead>
                <tbody id="whatIfIncomeBody"></tbody>
              </table>
            </div>
          </section>
        </section>
      </section>
    </main>
  `;
}

function resetTxForm() {
  state.editingId = null;
  const form = document.querySelector('#txForm');
  form.reset();
  form.date.value = todayIso();
  form.frequency.value = 'one-time';
  form.type.value = 'expense';
  form.groupId.value = 'general-household';
  form.classification.value = 'reducible';
  updateTxFormVisibility();
  document.querySelectorAll('#customMonthsWrap input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  document.querySelector('#saveTxButton').textContent = 'Save transaction';
  document.querySelector('#cancelTxEditButton').classList.add('hidden');
}

function updateTxFormVisibility() {
  const form = document.querySelector('#txForm');
  const isExpense = form.type.value === 'expense';
  const isCustom = form.frequency.value === 'custom-months';
  document.querySelector('#classificationWrap').classList.toggle('hidden', !isExpense);
  document.querySelector('#customMonthsWrap').classList.toggle('hidden', !isCustom);
}

function toSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function addCategory(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) throw new Error('Enter a category name.');
  if (state.data.categories.some((c) => c.toLowerCase() === cleaned.toLowerCase())) throw new Error('Category already exists.');
  state.data.categories.push(cleaned);
  state.data.categories.sort((a, b) => a.localeCompare(b));
  saveData();
}

function addGroup(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) throw new Error('Enter a group name.');
  if (state.data.groups.some((g) => g.name.toLowerCase() === cleaned.toLowerCase())) throw new Error('Group already exists.');
  const id = toSlug(cleaned) || crypto.randomUUID();
  state.data.groups.push({ id, name: cleaned });
  saveData();
}

function handleTxSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const tx = normaliseTransaction({
    id: state.editingId || crypto.randomUUID(),
    type: form.get('type'),
    amount: Number(form.get('amount')),
    category: form.get('category'),
    groupId: String(form.get('groupId') || 'general-household'),
    date: form.get('date'),
    frequency: form.get('frequency'),
    startDate: form.get('startDate'),
    endDate: form.get('endDate'),
    customMonths: form.getAll('customMonths').map(Number),
    classification: form.get('classification'),
    description: String(form.get('description') || '').trim(),
    createdAt: Date.now(),
  });
  if (!Number.isFinite(tx.amount) || tx.amount <= 0) throw new Error('Amount must be greater than zero.');
  if (!tx.category) throw new Error('Select a category.');
  if (!tx.groupId) tx.groupId = 'general-household';
  if (tx.endDate && tx.startDate && tx.endDate < tx.startDate) throw new Error('End date must be after start date.');
  if (tx.frequency === 'custom-months' && !tx.customMonths.length) throw new Error('Select at least one month for custom-months.');

  if (state.editingId) {
    state.data.transactions = state.data.transactions.map((x) => (x.id === state.editingId ? tx : x));
  } else {
    state.data.transactions.unshift(tx);
  }
  saveData();
  resetTxForm();
  renderActiveTab();
}

function handleTxActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === 'delete') {
    if (!window.confirm('Delete this transaction?')) return;
    state.data.transactions = state.data.transactions.filter((x) => x.id !== id);
    saveData();
    renderActiveTab();
    return;
  }

  const tx = state.data.transactions.find((x) => x.id === id);
  if (!tx) return;
  state.tab = 'transactions';
  renderActiveTab();
  state.editingId = tx.id;
  const form = document.querySelector('#txForm');
  form.type.value = tx.type;
  form.amount.value = tx.amount.toFixed(2);
  form.category.value = tx.category;
  form.groupId.value = tx.groupId;
  form.date.value = tx.date;
  form.frequency.value = tx.frequency;
  form.startDate.value = tx.startDate || '';
  form.endDate.value = tx.endDate || '';
  form.classification.value = tx.classification || 'reducible';
  form.description.value = tx.description || '';
  document.querySelectorAll('#customMonthsWrap input[type="checkbox"]').forEach((cb) => {
    cb.checked = tx.customMonths.includes(Number(cb.value));
  });
  updateTxFormVisibility();
  document.querySelector('#saveTxButton').textContent = 'Update transaction';
  document.querySelector('#cancelTxEditButton').classList.remove('hidden');
}

function exportCsv() {
  const rows = state.data.transactions.map((tx) => ({
    type: tx.type,
    amount_eur: tx.amount.toFixed(2),
    category: tx.category,
    financial_group: groupName(tx.groupId),
    date: tx.date,
    frequency: tx.frequency,
    start_date: tx.startDate || '',
    end_date: tx.endDate || '',
    custom_months: tx.customMonths.join('|'),
    expense_classification: tx.type === 'expense' ? tx.classification : '',
    description: tx.description || '',
  }));
  if (!rows.length) throw new Error('No transactions to export.');
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
  const rows = state.data.transactions.map((tx) => ({
    Type: tx.type,
    Amount_EUR: Number(tx.amount.toFixed(2)),
    Category: tx.category,
    Financial_Group: groupName(tx.groupId),
    Date: tx.date,
    Frequency: tx.frequency,
    Start_Date: tx.startDate || '',
    End_Date: tx.endDate || '',
    Custom_Months: tx.customMonths.join('|'),
    Expense_Classification: tx.type === 'expense' ? tx.classification : '',
    Description: tx.description || '',
  }));
  if (!rows.length) throw new Error('No transactions to export.');
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Transactions');
  writeFileXLSX(wb, `household-finance-${todayIso()}.xlsx`);
}

function backupJson() {
  const payload = { exportedAt: new Date().toISOString(), data: state.data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-finance-backup-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function restoreJson(file) {
  const payload = JSON.parse(await file.text());
  if (!payload || !payload.data || !Array.isArray(payload.data.transactions)) throw new Error('Invalid backup file.');
  state.data = migrateData(payload.data);
  saveData();
  resetTxForm();
  renderActiveTab();
}

function bindEvents() {
  document.querySelector('#unlockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const nameRaw = String(form.get('name') || '').trim();
    const name = nameRaw.toLowerCase();
    const dob = String(form.get('dob') || '').trim();
    if (!name || !dob) return showToast('Enter name and DOB.', true);
    if (!APPROVED_NAMES.includes(name)) return showToast('Name is not approved.', true);
    if (dob !== todayIso()) return showToast("DOB must match today's date for this access rule.", true);
    state.user = nameRaw;
    state.unlocked = true;
    sessionStorage.setItem(SESSION_UNLOCK_KEY, JSON.stringify({ user: state.user, ts: Date.now() }));
    setVisibleView('#appView');
    renderActiveTab();
    resetTxForm();
  });

  document.querySelector('#lockButton').addEventListener('click', () => {
    state.unlocked = false;
    state.user = '';
    sessionStorage.removeItem(SESSION_UNLOCK_KEY);
    setVisibleView('#gateView');
  });

  document.querySelectorAll('.tab-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tabTarget;
      renderActiveTab();
    }),
  );

  document.querySelector('#txForm').addEventListener('submit', (e) => {
    try {
      handleTxSubmit(e);
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.querySelector('#quickAddIncomeButton').addEventListener('click', () => {
    const form = document.querySelector('#txForm');
    form.type.value = 'income';
    updateTxFormVisibility();
    form.amount.focus();
  });
  document.querySelector('#quickAddExpenseButton').addEventListener('click', () => {
    const form = document.querySelector('#txForm');
    form.type.value = 'expense';
    updateTxFormVisibility();
    form.amount.focus();
  });
  document.querySelector('#txType').addEventListener('change', updateTxFormVisibility);
  document.querySelector('#txFrequency').addEventListener('change', updateTxFormVisibility);
  document.querySelector('#cancelTxEditButton').addEventListener('click', resetTxForm);
  document.querySelector('#txTableBody').addEventListener('click', handleTxActions);

  document.querySelector('#budgetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number(new FormData(e.target).get('budget'));
    if (!Number.isFinite(amount) || amount < 0) return showToast('Enter a valid budget.', true);
    state.data.monthlyBudget = amount;
    saveData();
    renderDashboardTab();
  });

  const addCategoryHandler = (e) => {
    e.preventDefault();
    try {
      addCategory(new FormData(e.target).get('name'));
      e.target.reset();
      renderActiveTab();
    } catch (err) {
      showToast(err.message, true);
    }
  };
  document.querySelector('#addCategoryForm').addEventListener('submit', addCategoryHandler);
  document.querySelector('#addCategoryForm2').addEventListener('submit', addCategoryHandler);

  const addGroupHandler = (e) => {
    e.preventDefault();
    try {
      addGroup(new FormData(e.target).get('name'));
      e.target.reset();
      renderActiveTab();
    } catch (err) {
      showToast(err.message, true);
    }
  };
  document.querySelector('#addGroupQuickForm').addEventListener('submit', addGroupHandler);
  document.querySelector('#addGroupForm').addEventListener('submit', addGroupHandler);

  document.querySelector('#groupsTableBody').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const group = state.data.groups.find((g) => g.id === id);
    if (!group) return;

    if (button.dataset.action === 'rename-group') {
      const next = window.prompt('New group name:', group.name);
      if (!next) return;
      group.name = next.trim();
      saveData();
      renderActiveTab();
      return;
    }

    if (button.dataset.action === 'delete-group') {
      const inUse = state.data.transactions.some((t) => t.groupId === id);
      if (inUse) return showToast('Group is used by transactions. Reassign them first.', true);
      state.data.groups = state.data.groups.filter((g) => g.id !== id);
      saveData();
      renderActiveTab();
    }
  });

  document.querySelector('#categoriesTableBody').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const name = String(button.dataset.name || '');
    if (button.dataset.action !== 'delete-category') return;
    const inUse = state.data.transactions.some((t) => t.category === name);
    if (inUse) return showToast('Category is used by transactions. Reassign first.', true);
    state.data.categories = state.data.categories.filter((c) => c !== name);
    saveData();
    renderActiveTab();
  });

  document.querySelector('#txFilterForm').addEventListener('input', (e) => {
    const form = e.currentTarget;
    state.filters.q = String(form.q.value || '');
    state.filters.type = String(form.type.value || '');
    state.filters.groupId = String(form.groupId.value || '');
    state.filters.month = String(form.month.value || '');
    renderTransactionsTab();
  });

  document.querySelector('#clearTxFilters').addEventListener('click', () => {
    state.filters = { q: '', type: '', groupId: '', month: '' };
    document.querySelector('#txFilterForm').reset();
    renderTransactionsTab();
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

  document.querySelector('#optionalReduction').addEventListener('input', (e) => {
    state.scenario.optionalReductionPct = Number(e.target.value || 0);
    renderWhatIfTab();
  });
  document.querySelector('#whatIfIncomeBody').addEventListener('input', (e) => {
    const target = e.target;
    if (target.dataset.action === 'toggle-income') {
      const id = target.dataset.id;
      const keep = target.checked;
      state.scenario.removedIncomeIds = keep ? state.scenario.removedIncomeIds.filter((x) => x !== id) : [...new Set([...state.scenario.removedIncomeIds, id])];
      renderWhatIfTab();
      return;
    }
    if (target.dataset.action === 'override-income') {
      const id = target.dataset.id;
      const value = String(target.value || '').trim();
      if (!value) {
        delete state.scenario.incomeOverrides[id];
      } else {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric >= 0) state.scenario.incomeOverrides[id] = numeric;
      }
      renderWhatIfTab();
    }
  });
}

function main() {
  state.data = migrateData(loadJson(STORAGE_KEY, structuredClone(DEFAULT_DATA)));
  renderShell();
  bindEvents();

  const session = loadJson(SESSION_UNLOCK_KEY, null);
  if (session?.user) {
    state.user = String(session.user);
    state.unlocked = true;
    setVisibleView('#appView');
    renderActiveTab();
    resetTxForm();
  } else {
    setVisibleView('#gateView');
  }
}

main();
