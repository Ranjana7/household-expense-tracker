import { createClient } from '@supabase/supabase-js';
import { utils, writeFileXLSX } from 'xlsx';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CATEGORY_OPTIONS = ['Groceries', 'Utilities', 'Transport', 'Dining', 'Health', 'Shopping', 'Home', 'Kids', 'Mortgage', 'Insurance', 'Subscriptions', 'Other'];
const EXPENSE_CLASSIFICATIONS = [
  { value: 'essential', label: 'Essential' },
  { value: 'reducible', label: 'Reducible' },
  { value: 'optional', label: 'Optional' },
];
const INCOME_TYPES = ['salary', 'other'];
const CADENCE_OPTIONS = ['weekly', 'monthly', 'yearly'];
const LOCALE = 'en-IE';
const CURRENCY = 'EUR';

const state = {
  session: null,
  profile: null,
  household: null,
  inviteCode: '',
  members: [],
  expenses: [],
  incomes: [],
  recurringExpenses: [],
  recurringIncomes: [],
  monthlyBudget: 0,
  categoryBudgets: [],
  editingExpenseId: null,
  editingIncomeId: null,
  editingRecurringExpenseId: null,
  editingRecurringIncomeId: null,
  filters: { search: '', category: '', paidBy: '', month: '' },
  scenario: {
    mode: 'both',
    selectedMemberA: '',
    selectedMemberB: '',
    customIncome: 0,
    optionalReductionPercent: 0,
  },
};

let supabase = null;
let householdChannel = null;

function renderShell() {
  document.querySelector('#app').innerHTML = `
    <main class="container">
      <section id="configError" class="card danger hidden"></section>
      <section id="toast" class="card hidden"></section>

      <section id="authView" class="card">
        <h1>Household Expense Tracker</h1>
        <p class="muted">Simple, secure household cash-flow tracker. No bank integrations or card/account data.</p>
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
          <p class="muted">Create a household, then let your husband join via invite code. Max 2 authorised users.</p>
          <div class="split">
            <form id="createHouseholdForm" class="stack">
              <h3>Create household</h3>
              <label>Household name<input name="name" required maxlength="80" /></label>
              <label>Optional monthly budget (EUR)<input name="budget" type="number" min="0" step="0.01" value="0" /></label>
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
            <p class="muted">Signed in as <strong id="signedInName"></strong>. Invite code: <code id="inviteCodeText"></code></p>
          </div>
          <button id="signOutButton" class="secondary">Sign out</button>
        </div>

        <section class="card">
          <h3>Financial dashboard</h3>
          <div class="grid cards5">
            <article class="card stat"><p class="muted">Monthly household income</p><h3 id="monthlyIncomeCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Monthly household expenses</p><h3 id="monthlyExpenseCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Essential monthly expenses</p><h3 id="monthlyEssentialCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Reducible monthly expenses</p><h3 id="monthlyReducibleCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Optional monthly expenses</p><h3 id="monthlyOptionalCard">€0.00</h3></article>
          </div>
          <div class="grid cards4">
            <article class="card stat"><p class="muted">Monthly surplus / shortfall</p><h3 id="monthlySurplusCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">This week spend</p><h3 id="weekSpendCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">This year spend</p><h3 id="yearSpendCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Upcoming recurring (30d)</p><h3 id="upcomingRecurringCount">0</h3></article>
          </div>
        </section>

        <div class="grid cards3">
          <section class="card"><h3>Spending by category</h3><div id="categoryBreakdown" class="bars"></div></section>
          <section class="card"><h3>Spending by classification</h3><div id="classificationBreakdown" class="bars"></div></section>
          <section class="card"><h3>Spending by person</h3><div id="personBreakdown" class="bars"></div></section>
        </div>

        <div class="grid cards2">
          <section class="card"><h3>Monthly expense trend (12 months)</h3><div id="monthlyExpenseTrend" class="bars"></div></section>
          <section class="card"><h3>Monthly income trend (12 months)</h3><div id="monthlyIncomeTrend" class="bars"></div></section>
        </div>

        <section class="card">
          <h3>What If? (one-income scenario planner)</h3>
          <div class="grid scenario-grid">
            <label>Scenario
              <select id="scenarioMode">
                <option value="both">Both incomes continuing</option>
                <option value="member-a">Only one member income</option>
                <option value="member-b">Only the other member income</option>
                <option value="custom">Custom household income</option>
              </select>
            </label>
            <label>Member A
              <select id="scenarioMemberA"></select>
            </label>
            <label>Member B
              <select id="scenarioMemberB"></select>
            </label>
            <label>Custom monthly income (EUR)
              <input id="scenarioCustomIncome" type="number" min="0" step="0.01" value="0" />
            </label>
            <label>Optional expense reduction %
              <input id="scenarioOptionalReduction" type="range" min="0" max="100" value="0" />
            </label>
            <p class="muted" id="scenarioOptionalReductionLabel">0%</p>
          </div>
          <div class="grid cards5">
            <article class="card stat"><p class="muted">Available monthly income</p><h3 id="scenarioIncomeCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Essential expenses</p><h3 id="scenarioEssentialCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Current lifestyle expenses</p><h3 id="scenarioLifestyleCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Potential optional savings</p><h3 id="scenarioSavingsCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Projected surplus / shortfall</p><h3 id="scenarioSurplusCard">€0.00</h3></article>
          </div>
        </section>

        <section class="card">
          <h3>Discover household budget (from actual data)</h3>
          <div class="grid cards5">
            <article class="card stat"><p class="muted">Average monthly spending (actual)</p><h3 id="avgMonthlySpendingCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Minimum essential monthly spending</p><h3 id="minEssentialCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Average optional spending</p><h3 id="avgOptionalCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Irregular annual expenses / month</p><h3 id="annualEquivalentCard">€0.00</h3></article>
            <article class="card stat"><p class="muted">Suggested monthly target</p><h3 id="suggestedTargetCard">€0.00</h3></article>
          </div>
          <p class="muted">Actual values come from recorded entries. Suggested targets are estimates based on your history.</p>
        </section>

        <section class="card">
          <h3>Annual irregular expenses view</h3>
          <p class="muted">Use this for holidays, insurance renewals, Christmas, school costs, and other non-monthly costs.</p>
          <div id="annualExpenseList" class="simple-list"></div>
        </section>

        <section class="card">
          <h3>Category monthly budgets (optional)</h3>
          <form id="categoryBudgetForm" class="inline-form">
            <label>Category
              <select name="category" required>
                ${CATEGORY_OPTIONS.map((category) => `<option value="${category}">${category}</option>`).join('')}
              </select>
            </label>
            <label>Budget (EUR)<input name="amount" type="number" min="0" step="0.01" required /></label>
            <button type="submit">Save category budget</button>
          </form>
          <div id="categoryBudgetList" class="simple-list"></div>
        </section>

        <section class="card">
          <h3 id="expenseFormTitle">Quick expense entry</h3>
          <form id="expenseForm" class="grid-form">
            <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
            <label>Date<input name="expenseDate" type="date" required /></label>
            <label>Category
              <select name="category" required>
                ${CATEGORY_OPTIONS.map((category) => `<option value="${category}">${category}</option>`).join('')}
              </select>
            </label>
            <label>Classification
              <select name="classification" required>
                ${EXPENSE_CLASSIFICATIONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join('')}
              </select>
            </label>
            <label>Description<input name="description" required maxlength="120" /></label>
            <label>Who paid
              <select name="paidBy" id="paidBySelect" required></select>
            </label>
            <label class="checkbox-inline"><input type="checkbox" name="isIrregularAnnual" /> Mark as irregular annual expense</label>
            <label class="wide">Optional notes<textarea name="notes" maxlength="500"></textarea></label>
            <div class="actions">
              <button type="submit" id="saveExpenseButton">Add expense</button>
              <button type="button" id="cancelExpenseEditButton" class="secondary hidden">Cancel edit</button>
            </div>
          </form>
        </section>

        <section class="card">
          <h3 id="incomeFormTitle">Income entry</h3>
          <form id="incomeForm" class="grid-form">
            <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
            <label>Date<input name="incomeDate" type="date" required /></label>
            <label>Source<input name="source" required maxlength="80" placeholder="Salary, bonus, freelance..." /></label>
            <label>Type
              <select name="incomeType" required>
                ${INCOME_TYPES.map((item) => `<option value="${item}">${item}</option>`).join('')}
              </select>
            </label>
            <label>Received by
              <select name="receivedBy" id="receivedBySelect" required></select>
            </label>
            <label class="wide">Optional notes<textarea name="notes" maxlength="300"></textarea></label>
            <div class="actions">
              <button type="submit" id="saveIncomeButton">Add income</button>
              <button type="button" id="cancelIncomeEditButton" class="secondary hidden">Cancel edit</button>
            </div>
          </form>
        </section>

        <div class="grid cards2">
          <section class="card">
            <h3 id="recurringExpenseFormTitle">Recurring expenses</h3>
            <form id="recurringExpenseForm" class="grid-form">
              <label>Title<input name="title" required maxlength="80" /></label>
              <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
              <label>Category
                <select name="category" required>
                  ${CATEGORY_OPTIONS.map((category) => `<option value="${category}">${category}</option>`).join('')}
                </select>
              </label>
              <label>Cadence
                <select name="cadence" required>
                  ${CADENCE_OPTIONS.map((cadence) => `<option value="${cadence}">${cadence}</option>`).join('')}
                </select>
              </label>
              <label>Next due<input name="nextDueDate" type="date" required /></label>
              <label class="wide">Notes<textarea name="notes" maxlength="300"></textarea></label>
              <div class="actions">
                <button type="submit" id="saveRecurringExpenseButton">Add recurring expense</button>
                <button type="button" id="cancelRecurringExpenseEditButton" class="secondary hidden">Cancel edit</button>
              </div>
            </form>
            <div id="recurringExpenseList" class="simple-list"></div>
          </section>

          <section class="card">
            <h3 id="recurringIncomeFormTitle">Recurring incomes</h3>
            <form id="recurringIncomeForm" class="grid-form">
              <label>Title<input name="title" required maxlength="80" /></label>
              <label>Amount (EUR)<input name="amount" type="number" step="0.01" min="0.01" required /></label>
              <label>Type
                <select name="incomeType" required>
                  ${INCOME_TYPES.map((item) => `<option value="${item}">${item}</option>`).join('')}
                </select>
              </label>
              <label>Cadence
                <select name="cadence" required>
                  ${CADENCE_OPTIONS.map((cadence) => `<option value="${cadence}">${cadence}</option>`).join('')}
                </select>
              </label>
              <label>Next expected<input name="nextDueDate" type="date" required /></label>
              <label>Received by<select name="receivedBy" id="recurringIncomeReceivedBy" required></select></label>
              <label class="wide">Notes<textarea name="notes" maxlength="300"></textarea></label>
              <div class="actions">
                <button type="submit" id="saveRecurringIncomeButton">Add recurring income</button>
                <button type="button" id="cancelRecurringIncomeEditButton" class="secondary hidden">Cancel edit</button>
              </div>
            </form>
            <div id="recurringIncomeList" class="simple-list"></div>
          </section>
        </div>

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
            <label>Search<input name="search" placeholder="description, notes, source..." /></label>
            <label>Category
              <select name="categoryFilter">
                <option value="">All</option>
                ${CATEGORY_OPTIONS.map((category) => `<option value="${category}">${category}</option>`).join('')}
              </select>
            </label>
            <label>Who paid
              <select name="paidByFilter" id="paidByFilter"></select>
            </label>
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

        <section class="card">
          <h3>Incomes</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Source</th><th>Type</th><th>Received by</th><th>Actions</th></tr></thead>
              <tbody id="incomeTableBody"></tbody>
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
  if (isError) toast.classList.add('danger');
  toast.textContent = message;
  window.setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('danger');
  }, 3500);
}

function formatCurrency(value) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(LOCALE).format(new Date(`${value}T00:00:00`));
}

function monthKey(value) {
  const d = new Date(`${value}T00:00:00`);
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

function setVisibleView(view) {
  ['#authView', '#onboardingView', '#appView'].forEach((id) => document.querySelector(id).classList.add('hidden'));
  document.querySelector(view).classList.remove('hidden');
}

function ensureSupabaseConfigured() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return true;
  const error = document.querySelector('#configError');
  error.classList.remove('hidden');
  error.innerHTML = 'Missing <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>.';
  setVisibleView('#configError');
  return false;
}

function memberName(userId) {
  return state.members.find((x) => x.user_id === userId)?.display_name || 'Unknown';
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('user_id, display_name').eq('user_id', state.session.user.id).single();
  if (error) throw error;
  state.profile = data;
}

async function loadHousehold() {
  const { data: membership, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', state.session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!membership) {
    state.household = null;
    state.inviteCode = '';
    return;
  }
  const householdId = membership.household_id;
  const { data: household, error: householdError } = await supabase.from('households').select('id, name').eq('id', householdId).single();
  if (householdError) throw householdError;
  state.household = household;
  const { data: invite, error: inviteError } = await supabase.from('household_invites').select('invite_code').eq('household_id', householdId).maybeSingle();
  if (inviteError) throw inviteError;
  state.inviteCode = invite?.invite_code || '';
}

async function loadMembers() {
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, profiles!inner(display_name)')
    .eq('household_id', state.household.id)
    .order('user_id');
  if (error) throw error;
  state.members = data.map((row) => ({ user_id: row.user_id, display_name: row.profiles.display_name }));
}

async function loadBudgets() {
  const [monthlyBudgetResult, categoryBudgetResult] = await Promise.all([
    supabase.from('monthly_budgets').select('amount_eur').eq('household_id', state.household.id).maybeSingle(),
    supabase.from('category_budgets').select('category, amount_eur').eq('household_id', state.household.id).order('category'),
  ]);
  if (monthlyBudgetResult.error) throw monthlyBudgetResult.error;
  if (categoryBudgetResult.error) throw categoryBudgetResult.error;
  state.monthlyBudget = Number(monthlyBudgetResult.data?.amount_eur || 0);
  state.categoryBudgets = categoryBudgetResult.data.map((row) => ({ category: row.category, amount: Number(row.amount_eur) }));
}

async function loadExpenses() {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, amount, expense_date, category, classification, description, paid_by, notes, is_irregular_annual')
    .eq('household_id', state.household.id)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  state.expenses = data.map((row) => ({ ...row, amount: Number(row.amount) }));
}

async function loadIncomes() {
  const { data, error } = await supabase
    .from('incomes')
    .select('id, amount, income_date, source, income_type, received_by, notes')
    .eq('household_id', state.household.id)
    .order('income_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  state.incomes = data.map((row) => ({ ...row, amount: Number(row.amount) }));
}

async function loadRecurring() {
  const [recExp, recInc] = await Promise.all([
    supabase
      .from('recurring_expenses')
      .select('id, title, amount, category, cadence, next_due_date, notes, active')
      .eq('household_id', state.household.id)
      .order('next_due_date'),
    supabase
      .from('recurring_incomes')
      .select('id, title, amount, income_type, cadence, next_due_date, received_by, notes, active')
      .eq('household_id', state.household.id)
      .order('next_due_date'),
  ]);
  if (recExp.error) throw recExp.error;
  if (recInc.error) throw recInc.error;
  state.recurringExpenses = recExp.data.map((row) => ({ ...row, amount: Number(row.amount) }));
  state.recurringIncomes = recInc.data.map((row) => ({ ...row, amount: Number(row.amount) }));
}

function monthsFromHistory() {
  const keys = new Set();
  state.expenses.forEach((x) => keys.add(monthKey(x.expense_date)));
  state.incomes.forEach((x) => keys.add(monthKey(x.income_date)));
  return Array.from(keys).sort();
}

function monthlyAmount(data, dateField, amountField, month, extraFilter = () => true) {
  return data
    .filter((item) => monthKey(item[dateField]) === month)
    .filter(extraFilter)
    .reduce((sum, item) => sum + Number(item[amountField]), 0);
}

function averageMonthly(data, dateField, amountField, extraFilter = () => true) {
  const keys = Array.from(new Set(data.map((x) => monthKey(x[dateField])))).sort();
  if (!keys.length) return 0;
  const total = keys.reduce((sum, month) => sum + monthlyAmount(data, dateField, amountField, month, extraFilter), 0);
  return total / keys.length;
}

function computeFinancialMetrics() {
  const today = todayIso();
  const thisMonth = monthKey(today);
  const now = new Date(`${today}T00:00:00`);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const thisYear = now.getFullYear();

  const monthlyIncome = monthlyAmount(state.incomes, 'income_date', 'amount', thisMonth);
  const monthlyExpense = monthlyAmount(state.expenses, 'expense_date', 'amount', thisMonth);
  const essential = monthlyAmount(state.expenses, 'expense_date', 'amount', thisMonth, (x) => x.classification === 'essential');
  const reducible = monthlyAmount(state.expenses, 'expense_date', 'amount', thisMonth, (x) => x.classification === 'reducible');
  const optional = monthlyAmount(state.expenses, 'expense_date', 'amount', thisMonth, (x) => x.classification === 'optional');
  const weekSpend = state.expenses.filter((x) => x.expense_date >= weekStartIso && x.expense_date <= today).reduce((s, x) => s + x.amount, 0);
  const yearSpend = state.expenses.filter((x) => new Date(`${x.expense_date}T00:00:00`).getFullYear() === thisYear).reduce((s, x) => s + x.amount, 0);

  const keys = monthsFromHistory();
  const monthlyExpenseSeries = keys.map((month) => ({ label: month, value: monthlyAmount(state.expenses, 'expense_date', 'amount', month) }));
  const monthlyIncomeSeries = keys.map((month) => ({ label: month, value: monthlyAmount(state.incomes, 'income_date', 'amount', month) }));

  const avgMonthlySpending = averageMonthly(state.expenses, 'expense_date', 'amount');
  const avgOptionalSpending = averageMonthly(state.expenses, 'expense_date', 'amount', (x) => x.classification === 'optional');
  const minEssentialMonthly = keys.length
    ? Math.min(...keys.map((month) => monthlyAmount(state.expenses, 'expense_date', 'amount', month, (x) => x.classification === 'essential')))
    : 0;
  const annualEquivalent = state.expenses.filter((x) => x.is_irregular_annual).reduce((s, x) => s + x.amount, 0) / 12;
  const suggestedMonthlyTarget = minEssentialMonthly + avgOptionalSpending * 0.6 + annualEquivalent;

  return {
    monthlyIncome,
    monthlyExpense,
    essential,
    reducible,
    optional,
    monthlySurplus: monthlyIncome - monthlyExpense,
    weekSpend,
    yearSpend,
    monthlyExpenseSeries,
    monthlyIncomeSeries,
    avgMonthlySpending,
    avgOptionalSpending,
    minEssentialMonthly,
    annualEquivalent,
    suggestedMonthlyTarget,
  };
}

function renderBars(containerId, rows, denominator = 0) {
  const root = document.querySelector(containerId);
  if (!rows.length) {
    root.innerHTML = '<p class="muted">No data yet.</p>';
    return;
  }
  const max = denominator > 0 ? denominator : Math.max(...rows.map((x) => x.value), 1);
  root.innerHTML = rows
    .map((row) => {
      const width = Math.round((row.value / max) * 100);
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
  const metrics = computeFinancialMetrics();
  document.querySelector('#monthlyIncomeCard').textContent = formatCurrency(metrics.monthlyIncome);
  document.querySelector('#monthlyExpenseCard').textContent = formatCurrency(metrics.monthlyExpense);
  document.querySelector('#monthlyEssentialCard').textContent = formatCurrency(metrics.essential);
  document.querySelector('#monthlyReducibleCard').textContent = formatCurrency(metrics.reducible);
  document.querySelector('#monthlyOptionalCard').textContent = formatCurrency(metrics.optional);
  document.querySelector('#monthlySurplusCard').textContent = formatCurrency(metrics.monthlySurplus);
  document.querySelector('#weekSpendCard').textContent = formatCurrency(metrics.weekSpend);
  document.querySelector('#yearSpendCard').textContent = formatCurrency(metrics.yearSpend);

  const byCategory = new Map();
  const byPerson = new Map();
  const byClass = new Map([
    ['essential', 0],
    ['reducible', 0],
    ['optional', 0],
  ]);
  const month = monthKey(todayIso());
  state.expenses
    .filter((x) => monthKey(x.expense_date) === month)
    .forEach((expense) => {
      byCategory.set(expense.category, (byCategory.get(expense.category) || 0) + expense.amount);
      byPerson.set(memberName(expense.paid_by), (byPerson.get(memberName(expense.paid_by)) || 0) + expense.amount);
      byClass.set(expense.classification, (byClass.get(expense.classification) || 0) + expense.amount);
    });

  renderBars(
    '#categoryBreakdown',
    Array.from(byCategory.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    metrics.monthlyExpense || 1,
  );
  renderBars(
    '#personBreakdown',
    Array.from(byPerson.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    metrics.monthlyExpense || 1,
  );
  renderBars(
    '#classificationBreakdown',
    EXPENSE_CLASSIFICATIONS.map((x) => ({ label: x.label, value: byClass.get(x.value) || 0 })),
    metrics.monthlyExpense || 1,
  );

  renderBars(
    '#monthlyExpenseTrend',
    metrics.monthlyExpenseSeries.slice(-12).map((x) => ({ label: x.label, value: x.value })),
  );
  renderBars(
    '#monthlyIncomeTrend',
    metrics.monthlyIncomeSeries.slice(-12).map((x) => ({ label: x.label, value: x.value })),
  );

  document.querySelector('#avgMonthlySpendingCard').textContent = formatCurrency(metrics.avgMonthlySpending);
  document.querySelector('#minEssentialCard').textContent = formatCurrency(metrics.minEssentialMonthly);
  document.querySelector('#avgOptionalCard').textContent = formatCurrency(metrics.avgOptionalSpending);
  document.querySelector('#annualEquivalentCard').textContent = formatCurrency(metrics.annualEquivalent);
  document.querySelector('#suggestedTargetCard').textContent = formatCurrency(metrics.suggestedMonthlyTarget);
}

function renderAnnualIrregularExpenses() {
  const root = document.querySelector('#annualExpenseList');
  const annualExpenses = state.expenses.filter((x) => x.is_irregular_annual);
  if (!annualExpenses.length) {
    root.innerHTML = '<p class="muted">No irregular annual expenses marked yet.</p>';
    return;
  }
  root.innerHTML = annualExpenses
    .slice(0, 20)
    .map(
      (expense) => `
    <div class="list-row">
      <div>
        <strong>${escapeHtml(expense.description)}</strong>
        <p class="muted">${formatDate(expense.expense_date)} • ${escapeHtml(expense.category)} • ${formatCurrency(expense.amount)}</p>
      </div>
    </div>
  `,
    )
    .join('');
}

function renderWhatIf() {
  const metrics = computeFinancialMetrics();
  const mode = state.scenario.mode;
  const memberA = state.scenario.selectedMemberA || state.members[0]?.user_id || '';
  const memberB = state.scenario.selectedMemberB || state.members[1]?.user_id || state.members[0]?.user_id || '';
  const avgIncomeAll = averageMonthly(state.incomes, 'income_date', 'amount');
  const avgIncomeA = averageMonthly(state.incomes, 'income_date', 'amount', (x) => x.received_by === memberA);
  const avgIncomeB = averageMonthly(state.incomes, 'income_date', 'amount', (x) => x.received_by === memberB);

  let scenarioIncome = avgIncomeAll;
  if (mode === 'member-a') scenarioIncome = avgIncomeA;
  if (mode === 'member-b') scenarioIncome = avgIncomeB;
  if (mode === 'custom') scenarioIncome = Number(state.scenario.customIncome || 0);

  const avgEssential = averageMonthly(state.expenses, 'expense_date', 'amount', (x) => x.classification === 'essential');
  const avgReducible = averageMonthly(state.expenses, 'expense_date', 'amount', (x) => x.classification === 'reducible');
  const avgOptional = averageMonthly(state.expenses, 'expense_date', 'amount', (x) => x.classification === 'optional');
  const optionalReductionValue = avgOptional * (state.scenario.optionalReductionPercent / 100);
  const projectedLifestyle = avgEssential + avgReducible + (avgOptional - optionalReductionValue);
  const projectedSurplus = scenarioIncome - projectedLifestyle;

  document.querySelector('#scenarioIncomeCard').textContent = formatCurrency(scenarioIncome);
  document.querySelector('#scenarioEssentialCard').textContent = formatCurrency(avgEssential);
  document.querySelector('#scenarioLifestyleCard').textContent = formatCurrency(avgEssential + avgReducible + avgOptional);
  document.querySelector('#scenarioSavingsCard').textContent = formatCurrency(optionalReductionValue);
  document.querySelector('#scenarioSurplusCard').textContent = formatCurrency(projectedSurplus);
  document.querySelector('#scenarioOptionalReductionLabel').textContent = `${state.scenario.optionalReductionPercent}%`;

  const month = monthKey(todayIso());
  const upcomingRecurring = state.recurringExpenses.filter((x) => {
    const due = new Date(`${x.next_due_date}T00:00:00`);
    const diff = Math.floor((due - new Date(`${todayIso()}T00:00:00`)) / 86400000);
    return x.active && diff >= 0 && diff <= 30;
  });
  document.querySelector('#upcomingRecurringCount').textContent = String(upcomingRecurring.length);

  if (!state.scenario.selectedMemberA && state.members[0]) state.scenario.selectedMemberA = state.members[0].user_id;
  if (!state.scenario.selectedMemberB && state.members[1]) state.scenario.selectedMemberB = state.members[1].user_id;
  if (!state.scenario.selectedMemberB && state.members[0]) state.scenario.selectedMemberB = state.members[0].user_id;
  document.querySelector('#scenarioMode').value = state.scenario.mode;
  document.querySelector('#scenarioMemberA').value = state.scenario.selectedMemberA;
  document.querySelector('#scenarioMemberB').value = state.scenario.selectedMemberB;
  document.querySelector('#scenarioCustomIncome').value = Number(state.scenario.customIncome || 0).toFixed(2);
  document.querySelector('#scenarioOptionalReduction').value = String(state.scenario.optionalReductionPercent);

  const targetBudget = state.monthlyBudget > 0 ? state.monthlyBudget : metrics.suggestedMonthlyTarget;
  const categoryBudgetRoot = document.querySelector('#categoryBudgetList');
  if (!state.categoryBudgets.length) {
    categoryBudgetRoot.innerHTML = `<p class="muted">No category budgets set. Suggested baseline: ${formatCurrency(targetBudget)}</p>`;
  } else {
    const monthExpense = state.expenses.filter((x) => monthKey(x.expense_date) === month);
    const spentByCategory = new Map();
    monthExpense.forEach((x) => spentByCategory.set(x.category, (spentByCategory.get(x.category) || 0) + x.amount));
    categoryBudgetRoot.innerHTML = state.categoryBudgets
      .map((item) => {
        const spent = spentByCategory.get(item.category) || 0;
        const remaining = item.amount - spent;
        const statusClass = remaining < 0 ? 'danger-text' : remaining < item.amount * 0.2 ? 'warn-text' : '';
        return `
          <div class="list-row">
            <div>
              <strong>${escapeHtml(item.category)}</strong>
              <p class="muted">${formatCurrency(spent)} spent / ${formatCurrency(item.amount)} budget</p>
              <p class="muted ${statusClass}">${formatCurrency(Math.abs(remaining))} ${remaining >= 0 ? 'remaining' : 'over budget'}</p>
            </div>
            <button class="small danger" type="button" data-action="delete-category-budget" data-category="${escapeHtml(item.category)}">Delete</button>
          </div>
        `;
      })
      .join('');
  }
}

function renderSelects() {
  const options = state.members.map((x) => `<option value="${x.user_id}">${escapeHtml(x.display_name)}</option>`).join('');
  document.querySelector('#paidBySelect').innerHTML = options;
  document.querySelector('#paidByFilter').innerHTML = `<option value="">All</option>${options}`;
  document.querySelector('#receivedBySelect').innerHTML = options;
  document.querySelector('#recurringIncomeReceivedBy').innerHTML = options;
  document.querySelector('#scenarioMemberA').innerHTML = options;
  document.querySelector('#scenarioMemberB').innerHTML = options;
  if (state.profile) {
    document.querySelector('#paidBySelect').value = state.profile.user_id;
    document.querySelector('#receivedBySelect').value = state.profile.user_id;
    document.querySelector('#recurringIncomeReceivedBy').value = state.profile.user_id;
  }
}

function filteredExpenses() {
  const q = state.filters.search.trim().toLowerCase();
  return state.expenses.filter((x) => {
    const bySearch =
      q.length === 0 ||
      x.description.toLowerCase().includes(q) ||
      (x.notes || '').toLowerCase().includes(q) ||
      x.category.toLowerCase().includes(q);
    const byCategory = !state.filters.category || x.category === state.filters.category;
    const byPaidBy = !state.filters.paidBy || x.paid_by === state.filters.paidBy;
    const byMonth = !state.filters.month || monthKey(x.expense_date) === state.filters.month;
    return bySearch && byCategory && byPaidBy && byMonth;
  });
}

function renderExpensesTable() {
  const body = document.querySelector('#expenseTableBody');
  const rows = filteredExpenses();
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">No expenses match filters.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(
      (x) => `
    <tr>
      <td>${formatDate(x.expense_date)}</td>
      <td>${formatCurrency(x.amount)}</td>
      <td>${escapeHtml(x.category)}</td>
      <td>${escapeHtml(EXPENSE_CLASSIFICATIONS.find((c) => c.value === x.classification)?.label || x.classification)}</td>
      <td>${escapeHtml(x.description)}</td>
      <td>${escapeHtml(memberName(x.paid_by))}</td>
      <td>
        <div class="table-actions">
          <button class="small secondary" type="button" data-action="edit-expense" data-id="${x.id}">Edit</button>
          <button class="small danger" type="button" data-action="delete-expense" data-id="${x.id}">Delete</button>
        </div>
      </td>
    </tr>
  `,
    )
    .join('');
}

function renderIncomesTable() {
  const body = document.querySelector('#incomeTableBody');
  if (!state.incomes.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No income records yet.</td></tr>';
    return;
  }
  body.innerHTML = state.incomes
    .map(
      (x) => `
    <tr>
      <td>${formatDate(x.income_date)}</td>
      <td>${formatCurrency(x.amount)}</td>
      <td>${escapeHtml(x.source)}</td>
      <td>${escapeHtml(x.income_type)}</td>
      <td>${escapeHtml(memberName(x.received_by))}</td>
      <td>
        <div class="table-actions">
          <button class="small secondary" type="button" data-action="edit-income" data-id="${x.id}">Edit</button>
          <button class="small danger" type="button" data-action="delete-income" data-id="${x.id}">Delete</button>
        </div>
      </td>
    </tr>
  `,
    )
    .join('');
}

function renderRecurringLists() {
  const expRoot = document.querySelector('#recurringExpenseList');
  const incRoot = document.querySelector('#recurringIncomeList');

  expRoot.innerHTML = state.recurringExpenses.length
    ? state.recurringExpenses
        .map(
          (x) => `
      <div class="list-row">
        <div>
          <strong>${escapeHtml(x.title)}</strong>
          <p class="muted">${formatCurrency(x.amount)} • ${escapeHtml(x.category)} • ${escapeHtml(x.cadence)} • due ${formatDate(x.next_due_date)} • ${x.active ? 'Active' : 'Paused'}</p>
        </div>
        <div class="table-actions">
          <button class="small secondary" type="button" data-action="edit-rec-exp" data-id="${x.id}">Edit</button>
          <button class="small secondary" type="button" data-action="toggle-rec-exp" data-id="${x.id}">${x.active ? 'Pause' : 'Activate'}</button>
          <button class="small danger" type="button" data-action="delete-rec-exp" data-id="${x.id}">Delete</button>
        </div>
      </div>
    `,
        )
        .join('')
    : '<p class="muted">No recurring expenses.</p>';

  incRoot.innerHTML = state.recurringIncomes.length
    ? state.recurringIncomes
        .map(
          (x) => `
      <div class="list-row">
        <div>
          <strong>${escapeHtml(x.title)}</strong>
          <p class="muted">${formatCurrency(x.amount)} • ${escapeHtml(x.income_type)} • ${escapeHtml(x.cadence)} • next ${formatDate(x.next_due_date)} • ${x.active ? 'Active' : 'Paused'}</p>
        </div>
        <div class="table-actions">
          <button class="small secondary" type="button" data-action="edit-rec-inc" data-id="${x.id}">Edit</button>
          <button class="small secondary" type="button" data-action="toggle-rec-inc" data-id="${x.id}">${x.active ? 'Pause' : 'Activate'}</button>
          <button class="small danger" type="button" data-action="delete-rec-inc" data-id="${x.id}">Delete</button>
        </div>
      </div>
    `,
        )
        .join('')
    : '<p class="muted">No recurring incomes.</p>';
}

function resetExpenseForm() {
  state.editingExpenseId = null;
  const form = document.querySelector('#expenseForm');
  form.reset();
  form.expenseDate.value = todayIso();
  form.classification.value = 'reducible';
  if (state.profile) form.paidBy.value = state.profile.user_id;
  document.querySelector('#expenseFormTitle').textContent = 'Quick expense entry';
  document.querySelector('#saveExpenseButton').textContent = 'Add expense';
  document.querySelector('#cancelExpenseEditButton').classList.add('hidden');
}

function resetIncomeForm() {
  state.editingIncomeId = null;
  const form = document.querySelector('#incomeForm');
  form.reset();
  form.incomeDate.value = todayIso();
  form.incomeType.value = 'salary';
  if (state.profile) form.receivedBy.value = state.profile.user_id;
  document.querySelector('#incomeFormTitle').textContent = 'Income entry';
  document.querySelector('#saveIncomeButton').textContent = 'Add income';
  document.querySelector('#cancelIncomeEditButton').classList.add('hidden');
}

function resetRecurringForms() {
  state.editingRecurringExpenseId = null;
  state.editingRecurringIncomeId = null;
  const expenseForm = document.querySelector('#recurringExpenseForm');
  const incomeForm = document.querySelector('#recurringIncomeForm');
  expenseForm.reset();
  incomeForm.reset();
  expenseForm.nextDueDate.value = todayIso();
  incomeForm.nextDueDate.value = todayIso();
  if (state.profile) {
    incomeForm.receivedBy.value = state.profile.user_id;
  }
  document.querySelector('#recurringExpenseFormTitle').textContent = 'Recurring expenses';
  document.querySelector('#saveRecurringExpenseButton').textContent = 'Add recurring expense';
  document.querySelector('#cancelRecurringExpenseEditButton').classList.add('hidden');
  document.querySelector('#recurringIncomeFormTitle').textContent = 'Recurring incomes';
  document.querySelector('#saveRecurringIncomeButton').textContent = 'Add recurring income';
  document.querySelector('#cancelRecurringIncomeEditButton').classList.add('hidden');
}

function renderHeader() {
  document.querySelector('#householdTitle').textContent = state.household?.name || '';
  document.querySelector('#signedInName').textContent = state.profile?.display_name || '';
  document.querySelector('#inviteCodeText').textContent = state.inviteCode || 'Unavailable';
}

function renderAll() {
  renderHeader();
  renderSelects();
  renderDashboard();
  renderAnnualIrregularExpenses();
  renderWhatIf();
  renderExpensesTable();
  renderIncomesTable();
  renderRecurringLists();
  resetExpenseForm();
  resetIncomeForm();
  resetRecurringForms();
}

async function refreshData() {
  await Promise.all([loadMembers(), loadBudgets(), loadExpenses(), loadIncomes(), loadRecurring()]);
  renderAll();
}

function setupRealtime() {
  if (householdChannel) {
    supabase.removeChannel(householdChannel);
    householdChannel = null;
  }
  if (!state.household) return;
  const refresh = () => refreshData().catch((error) => showToast(error.message, true));
  householdChannel = supabase
    .channel(`household-${state.household.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `household_id=eq.${state.household.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incomes', filter: `household_id=eq.${state.household.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_budgets', filter: `household_id=eq.${state.household.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'category_budgets', filter: `household_id=eq.${state.household.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_expenses', filter: `household_id=eq.${state.household.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_incomes', filter: `household_id=eq.${state.household.id}` }, refresh)
    .subscribe();
}

async function handleSignIn(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email')).trim(),
    password: String(form.get('password')),
  });
  if (error) throw error;
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
  if (error) throw error;
  showToast('Account created. Confirm email if prompted, then sign in.');
}

async function handleCreateHousehold(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const budget = Number(form.get('budget'));
  const { error } = await supabase.rpc('create_household', {
    p_name: String(form.get('name')).trim(),
    p_budget: Number.isFinite(budget) ? budget : 0,
  });
  if (error) throw error;
  await loadHousehold();
  await refreshData();
  setupRealtime();
  setVisibleView('#appView');
}

async function handleJoinHousehold(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const { error } = await supabase.rpc('join_household', { p_code: String(form.get('code')).trim() });
  if (error) throw error;
  await loadHousehold();
  await refreshData();
  setupRealtime();
  setVisibleView('#appView');
}

async function handleCategoryBudgetSave(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const category = String(form.get('category'));
  const amount = Number(form.get('amount'));
  if (!category || !Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid category budget.');
  const { error } = await supabase
    .from('category_budgets')
    .upsert({ household_id: state.household.id, category, amount_eur: amount }, { onConflict: 'household_id,category' });
  if (error) throw error;
  await loadBudgets();
  renderWhatIf();
}

async function handleExpenseSave(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    household_id: state.household.id,
    amount: Number(form.get('amount')),
    expense_date: String(form.get('expenseDate')),
    category: String(form.get('category')),
    classification: String(form.get('classification')),
    description: String(form.get('description')).trim(),
    paid_by: String(form.get('paidBy')),
    notes: String(form.get('notes')).trim(),
    is_irregular_annual: form.get('isIrregularAnnual') === 'on',
  };
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error('Amount must be greater than zero.');

  let result;
  if (state.editingExpenseId) {
    result = await supabase.from('expenses').update(payload).eq('id', state.editingExpenseId).eq('household_id', state.household.id);
  } else {
    result = await supabase.from('expenses').insert(payload);
  }
  if (result.error) throw result.error;
  await loadExpenses();
  renderDashboard();
  renderExpensesTable();
  renderAnnualIrregularExpenses();
  renderWhatIf();
  resetExpenseForm();
}

async function handleIncomeSave(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    household_id: state.household.id,
    amount: Number(form.get('amount')),
    income_date: String(form.get('incomeDate')),
    source: String(form.get('source')).trim(),
    income_type: String(form.get('incomeType')),
    received_by: String(form.get('receivedBy')),
    notes: String(form.get('notes')).trim(),
  };
  if (!Number.isFinite(payload.amount) || payload.amount <= 0 || !payload.source) throw new Error('Enter a valid income record.');

  let result;
  if (state.editingIncomeId) {
    result = await supabase.from('incomes').update(payload).eq('id', state.editingIncomeId).eq('household_id', state.household.id);
  } else {
    result = await supabase.from('incomes').insert(payload);
  }
  if (result.error) throw result.error;
  await loadIncomes();
  renderDashboard();
  renderIncomesTable();
  renderWhatIf();
  resetIncomeForm();
}

async function handleRecurringExpenseSave(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    household_id: state.household.id,
    title: String(form.get('title')).trim(),
    amount: Number(form.get('amount')),
    category: String(form.get('category')),
    cadence: String(form.get('cadence')),
    next_due_date: String(form.get('nextDueDate')),
    notes: String(form.get('notes')).trim(),
    active: true,
  };
  if (!payload.title || !Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error('Enter a valid recurring expense.');

  let result;
  if (state.editingRecurringExpenseId) {
    result = await supabase
      .from('recurring_expenses')
      .update(payload)
      .eq('id', state.editingRecurringExpenseId)
      .eq('household_id', state.household.id);
  } else {
    result = await supabase.from('recurring_expenses').insert(payload);
  }
  if (result.error) throw result.error;
  await loadRecurring();
  renderRecurringLists();
  renderWhatIf();
  resetRecurringForms();
}

async function handleRecurringIncomeSave(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    household_id: state.household.id,
    title: String(form.get('title')).trim(),
    amount: Number(form.get('amount')),
    income_type: String(form.get('incomeType')),
    cadence: String(form.get('cadence')),
    next_due_date: String(form.get('nextDueDate')),
    received_by: String(form.get('receivedBy')),
    notes: String(form.get('notes')).trim(),
    active: true,
  };
  if (!payload.title || !Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error('Enter a valid recurring income.');
  let result;
  if (state.editingRecurringIncomeId) {
    result = await supabase
      .from('recurring_incomes')
      .update(payload)
      .eq('id', state.editingRecurringIncomeId)
      .eq('household_id', state.household.id);
  } else {
    result = await supabase.from('recurring_incomes').insert(payload);
  }
  if (result.error) throw result.error;
  await loadRecurring();
  renderRecurringLists();
  resetRecurringForms();
}

async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('household_id', state.household.id);
  if (error) throw error;
  await loadExpenses();
  renderExpensesTable();
  renderDashboard();
  renderWhatIf();
}

async function deleteIncome(id) {
  const { error } = await supabase.from('incomes').delete().eq('id', id).eq('household_id', state.household.id);
  if (error) throw error;
  await loadIncomes();
  renderIncomesTable();
  renderDashboard();
  renderWhatIf();
}

async function toggleRecurring(table, id, current) {
  const { error } = await supabase.from(table).update({ active: !current.active }).eq('id', id).eq('household_id', state.household.id);
  if (error) throw error;
  await loadRecurring();
  renderRecurringLists();
  renderWhatIf();
}

async function deleteRecurring(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id).eq('household_id', state.household.id);
  if (error) throw error;
  await loadRecurring();
  renderRecurringLists();
  renderWhatIf();
}

async function deleteCategoryBudget(category) {
  const { error } = await supabase.from('category_budgets').delete().eq('household_id', state.household.id).eq('category', category);
  if (error) throw error;
  await loadBudgets();
  renderWhatIf();
}

function handleExpenseActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === 'edit-expense') {
    const row = state.expenses.find((x) => x.id === id);
    if (!row) return;
    state.editingExpenseId = id;
    const form = document.querySelector('#expenseForm');
    form.amount.value = row.amount.toFixed(2);
    form.expenseDate.value = row.expense_date;
    form.category.value = row.category;
    form.classification.value = row.classification;
    form.description.value = row.description;
    form.paidBy.value = row.paid_by;
    form.notes.value = row.notes || '';
    form.isIrregularAnnual.checked = Boolean(row.is_irregular_annual);
    document.querySelector('#expenseFormTitle').textContent = 'Edit expense';
    document.querySelector('#saveExpenseButton').textContent = 'Update expense';
    document.querySelector('#cancelExpenseEditButton').classList.remove('hidden');
    return;
  }

  if (action === 'delete-expense' && window.confirm('Delete this expense?')) {
    deleteExpense(id).catch((error) => showToast(error.message, true));
  }
}

function handleIncomeActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === 'edit-income') {
    const row = state.incomes.find((x) => x.id === id);
    if (!row) return;
    state.editingIncomeId = id;
    const form = document.querySelector('#incomeForm');
    form.amount.value = row.amount.toFixed(2);
    form.incomeDate.value = row.income_date;
    form.source.value = row.source;
    form.incomeType.value = row.income_type;
    form.receivedBy.value = row.received_by;
    form.notes.value = row.notes || '';
    document.querySelector('#incomeFormTitle').textContent = 'Edit income';
    document.querySelector('#saveIncomeButton').textContent = 'Update income';
    document.querySelector('#cancelIncomeEditButton').classList.remove('hidden');
    return;
  }

  if (action === 'delete-income' && window.confirm('Delete this income record?')) {
    deleteIncome(id).catch((error) => showToast(error.message, true));
  }
}

function handleRecurringActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === 'delete-category-budget') {
    deleteCategoryBudget(button.dataset.category).catch((error) => showToast(error.message, true));
    return;
  }

  if (action === 'edit-rec-exp') {
    const row = state.recurringExpenses.find((x) => x.id === id);
    if (!row) return;
    state.editingRecurringExpenseId = id;
    const form = document.querySelector('#recurringExpenseForm');
    form.title.value = row.title;
    form.amount.value = row.amount.toFixed(2);
    form.category.value = row.category;
    form.cadence.value = row.cadence;
    form.nextDueDate.value = row.next_due_date;
    form.notes.value = row.notes || '';
    document.querySelector('#recurringExpenseFormTitle').textContent = 'Edit recurring expense';
    document.querySelector('#saveRecurringExpenseButton').textContent = 'Update recurring expense';
    document.querySelector('#cancelRecurringExpenseEditButton').classList.remove('hidden');
    return;
  }
  if (action === 'toggle-rec-exp') {
    const row = state.recurringExpenses.find((x) => x.id === id);
    if (!row) return;
    toggleRecurring('recurring_expenses', id, row).catch((error) => showToast(error.message, true));
    return;
  }
  if (action === 'delete-rec-exp' && window.confirm('Delete recurring expense?')) {
    deleteRecurring('recurring_expenses', id).catch((error) => showToast(error.message, true));
    return;
  }

  if (action === 'edit-rec-inc') {
    const row = state.recurringIncomes.find((x) => x.id === id);
    if (!row) return;
    state.editingRecurringIncomeId = id;
    const form = document.querySelector('#recurringIncomeForm');
    form.title.value = row.title;
    form.amount.value = row.amount.toFixed(2);
    form.incomeType.value = row.income_type;
    form.cadence.value = row.cadence;
    form.nextDueDate.value = row.next_due_date;
    form.receivedBy.value = row.received_by;
    form.notes.value = row.notes || '';
    document.querySelector('#recurringIncomeFormTitle').textContent = 'Edit recurring income';
    document.querySelector('#saveRecurringIncomeButton').textContent = 'Update recurring income';
    document.querySelector('#cancelRecurringIncomeEditButton').classList.remove('hidden');
    return;
  }
  if (action === 'toggle-rec-inc') {
    const row = state.recurringIncomes.find((x) => x.id === id);
    if (!row) return;
    toggleRecurring('recurring_incomes', id, row).catch((error) => showToast(error.message, true));
    return;
  }
  if (action === 'delete-rec-inc' && window.confirm('Delete recurring income?')) {
    deleteRecurring('recurring_incomes', id).catch((error) => showToast(error.message, true));
  }
}

function exportCsv() {
  const expenseRows = filteredExpenses().map((x) => ({
    date: x.expense_date,
    amount_eur: x.amount.toFixed(2),
    category: x.category,
    classification: x.classification,
    description: x.description,
    paid_by: memberName(x.paid_by),
    irregular_annual: x.is_irregular_annual ? 'yes' : 'no',
    notes: x.notes || '',
  }));
  const incomeRows = state.incomes.map((x) => ({
    date: x.income_date,
    amount_eur: x.amount.toFixed(2),
    source: x.source,
    type: x.income_type,
    received_by: memberName(x.received_by),
    notes: x.notes || '',
  }));

  const toCsv = (rows) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    return [headers.join(','), ...rows.map((row) => headers.map((h) => `"${String(row[h]).replaceAll('"', '""')}"`).join(','))].join('\n');
  };

  const csv = `EXPENSES\n${toCsv(expenseRows)}\n\nINCOMES\n${toCsv(incomeRows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-finance-${todayIso()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportExcel() {
  const wb = utils.book_new();
  const expenseData = state.expenses.map((x) => ({
    Date: x.expense_date,
    Amount_EUR: Number(x.amount.toFixed(2)),
    Category: x.category,
    Classification: x.classification,
    Description: x.description,
    Paid_By: memberName(x.paid_by),
    Irregular_Annual: x.is_irregular_annual ? 'Yes' : 'No',
    Notes: x.notes || '',
  }));
  const incomeData = state.incomes.map((x) => ({
    Date: x.income_date,
    Amount_EUR: Number(x.amount.toFixed(2)),
    Source: x.source,
    Type: x.income_type,
    Received_By: memberName(x.received_by),
    Notes: x.notes || '',
  }));
  const recExpData = state.recurringExpenses.map((x) => ({
    Title: x.title,
    Amount_EUR: Number(x.amount.toFixed(2)),
    Category: x.category,
    Cadence: x.cadence,
    Next_Due: x.next_due_date,
    Active: x.active ? 'Yes' : 'No',
    Notes: x.notes || '',
  }));
  const recIncData = state.recurringIncomes.map((x) => ({
    Title: x.title,
    Amount_EUR: Number(x.amount.toFixed(2)),
    Type: x.income_type,
    Cadence: x.cadence,
    Next_Due: x.next_due_date,
    Received_By: memberName(x.received_by),
    Active: x.active ? 'Yes' : 'No',
    Notes: x.notes || '',
  }));
  utils.book_append_sheet(wb, utils.json_to_sheet(expenseData), 'Expenses');
  utils.book_append_sheet(wb, utils.json_to_sheet(incomeData), 'Incomes');
  utils.book_append_sheet(wb, utils.json_to_sheet(recExpData), 'Recurring_Expenses');
  utils.book_append_sheet(wb, utils.json_to_sheet(recIncData), 'Recurring_Incomes');
  writeFileXLSX(wb, `household-finance-${todayIso()}.xlsx`);
}

function backupJson() {
  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    householdId: state.household.id,
    monthlyBudget: state.monthlyBudget,
    categoryBudgets: state.categoryBudgets,
    expenses: state.expenses,
    incomes: state.incomes,
    recurringExpenses: state.recurringExpenses,
    recurringIncomes: state.recurringIncomes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `household-finance-backup-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function restoreJson(file) {
  const payload = JSON.parse(await file.text());
  if (!payload || payload.householdId !== state.household.id) throw new Error('Invalid or mismatched backup.');

  if (Number.isFinite(Number(payload.monthlyBudget))) {
    const { error } = await supabase
      .from('monthly_budgets')
      .upsert({ household_id: state.household.id, amount_eur: Number(payload.monthlyBudget) }, { onConflict: 'household_id' });
    if (error) throw error;
  }
  if (Array.isArray(payload.categoryBudgets) && payload.categoryBudgets.length) {
    const rows = payload.categoryBudgets.map((x) => ({ household_id: state.household.id, category: x.category, amount_eur: Number(x.amount || 0) }));
    const { error } = await supabase.from('category_budgets').upsert(rows, { onConflict: 'household_id,category' });
    if (error) throw error;
  }
  if (Array.isArray(payload.expenses) && payload.expenses.length) {
    const rows = payload.expenses.map((x) => ({
      id: x.id,
      household_id: state.household.id,
      amount: Number(x.amount),
      expense_date: String(x.expense_date),
      category: String(x.category),
      classification: String(x.classification || 'reducible'),
      description: String(x.description),
      paid_by: String(x.paid_by),
      notes: String(x.notes || ''),
      is_irregular_annual: Boolean(x.is_irregular_annual),
    }));
    const { error } = await supabase.from('expenses').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  if (Array.isArray(payload.incomes) && payload.incomes.length) {
    const rows = payload.incomes.map((x) => ({
      id: x.id,
      household_id: state.household.id,
      amount: Number(x.amount),
      income_date: String(x.income_date),
      source: String(x.source),
      income_type: String(x.income_type || 'other'),
      received_by: String(x.received_by),
      notes: String(x.notes || ''),
    }));
    const { error } = await supabase.from('incomes').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  if (Array.isArray(payload.recurringExpenses) && payload.recurringExpenses.length) {
    const rows = payload.recurringExpenses.map((x) => ({
      id: x.id,
      household_id: state.household.id,
      title: String(x.title),
      amount: Number(x.amount),
      category: String(x.category),
      cadence: String(x.cadence),
      next_due_date: String(x.next_due_date),
      notes: String(x.notes || ''),
      active: Boolean(x.active),
    }));
    const { error } = await supabase.from('recurring_expenses').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  if (Array.isArray(payload.recurringIncomes) && payload.recurringIncomes.length) {
    const rows = payload.recurringIncomes.map((x) => ({
      id: x.id,
      household_id: state.household.id,
      title: String(x.title),
      amount: Number(x.amount),
      income_type: String(x.income_type),
      cadence: String(x.cadence),
      next_due_date: String(x.next_due_date),
      received_by: String(x.received_by),
      notes: String(x.notes || ''),
      active: Boolean(x.active),
    }));
    const { error } = await supabase.from('recurring_incomes').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
}

function bindScenarioEvents() {
  const mode = document.querySelector('#scenarioMode');
  const memberA = document.querySelector('#scenarioMemberA');
  const memberB = document.querySelector('#scenarioMemberB');
  const customIncome = document.querySelector('#scenarioCustomIncome');
  const reduction = document.querySelector('#scenarioOptionalReduction');

  mode.addEventListener('change', () => {
    state.scenario.mode = mode.value;
    renderWhatIf();
  });
  memberA.addEventListener('change', () => {
    state.scenario.selectedMemberA = memberA.value;
    renderWhatIf();
  });
  memberB.addEventListener('change', () => {
    state.scenario.selectedMemberB = memberB.value;
    renderWhatIf();
  });
  customIncome.addEventListener('input', () => {
    state.scenario.customIncome = Number(customIncome.value || 0);
    renderWhatIf();
  });
  reduction.addEventListener('input', () => {
    state.scenario.optionalReductionPercent = Number(reduction.value || 0);
    renderWhatIf();
  });
}

function bindEvents() {
  document.querySelector('#signInForm').addEventListener('submit', (e) => handleSignIn(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#signUpForm').addEventListener('submit', (e) => handleSignUp(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#createHouseholdForm').addEventListener('submit', (e) => handleCreateHousehold(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#joinHouseholdForm').addEventListener('submit', (e) => handleJoinHousehold(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#categoryBudgetForm').addEventListener('submit', (e) => handleCategoryBudgetSave(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#expenseForm').addEventListener('submit', (e) => handleExpenseSave(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#incomeForm').addEventListener('submit', (e) => handleIncomeSave(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#recurringExpenseForm').addEventListener('submit', (e) => handleRecurringExpenseSave(e).catch((err) => showToast(err.message, true)));
  document.querySelector('#recurringIncomeForm').addEventListener('submit', (e) => handleRecurringIncomeSave(e).catch((err) => showToast(err.message, true)));

  document.querySelector('#cancelExpenseEditButton').addEventListener('click', resetExpenseForm);
  document.querySelector('#cancelIncomeEditButton').addEventListener('click', resetIncomeForm);
  document.querySelector('#cancelRecurringExpenseEditButton').addEventListener('click', resetRecurringForms);
  document.querySelector('#cancelRecurringIncomeEditButton').addEventListener('click', resetRecurringForms);

  document.querySelector('#expenseTableBody').addEventListener('click', handleExpenseActions);
  document.querySelector('#incomeTableBody').addEventListener('click', handleIncomeActions);
  document.querySelector('#recurringExpenseList').addEventListener('click', handleRecurringActions);
  document.querySelector('#recurringIncomeList').addEventListener('click', handleRecurringActions);
  document.querySelector('#categoryBudgetList').addEventListener('click', handleRecurringActions);

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

  document.querySelector('#exportCsvButton').addEventListener('click', exportCsv);
  document.querySelector('#exportExcelButton').addEventListener('click', exportExcel);
  document.querySelector('#backupButton').addEventListener('click', backupJson);
  document.querySelector('#restoreInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await restoreJson(file);
      await refreshData();
      showToast('Backup restored.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      event.target.value = '';
    }
  });
  document.querySelector('#signOutButton').addEventListener('click', () => {
    supabase.auth.signOut().catch((err) => showToast(err.message, true));
  });

  bindScenarioEvents();
}

async function applySession(session) {
  state.session = session;
  if (!session) {
    state.profile = null;
    state.household = null;
    if (householdChannel) {
      supabase.removeChannel(householdChannel);
      householdChannel = null;
    }
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
  setupRealtime();
  setVisibleView('#appView');
}

async function main() {
  renderShell();
  if (!ensureSupabaseConfigured()) return;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  bindEvents();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  await applySession(data.session);
  document.querySelector('#expenseForm input[name="expenseDate"]').value = todayIso();
  document.querySelector('#incomeForm input[name="incomeDate"]').value = todayIso();
  document.querySelector('#recurringExpenseForm input[name="nextDueDate"]').value = todayIso();
  document.querySelector('#recurringIncomeForm input[name="nextDueDate"]').value = todayIso();
  supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session).catch((err) => showToast(err.message, true));
  });
}

main().catch((error) => showToast(error.message, true));
