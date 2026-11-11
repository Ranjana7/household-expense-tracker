import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import pkg from 'pg';

const { Pool } = pkg;

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required.');
}
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const pool = new Pool({ connectionString: DATABASE_URL });

const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN.split(',').map((x) => x.trim()), credentials: false }));
app.use(express.json({ limit: '1mb' }));

function makeToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

async function withUserTx(userId, callback) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function getBootstrap(client, userId) {
  const profileResult = await client.query(
    `select id, email, display_name
     from public.app_users
     where id = $1`,
    [userId],
  );
  if (!profileResult.rowCount) {
    throw new Error('Profile not found.');
  }

  const householdResult = await client.query(
    `select h.id, h.name
     from public.households h
     join public.household_members hm on hm.household_id = h.id
     where hm.user_id = $1
     limit 1`,
    [userId],
  );
  if (!householdResult.rowCount) {
    return {
      profile: {
        id: profileResult.rows[0].id,
        email: profileResult.rows[0].email,
        displayName: profileResult.rows[0].display_name,
      },
      household: null,
      inviteCode: '',
      budget: 0,
      members: [],
      expenses: [],
    };
  }

  const household = householdResult.rows[0];
  const [inviteResult, budgetResult, membersResult, expensesResult] = await Promise.all([
    client.query('select invite_code from public.household_invites where household_id = $1', [household.id]),
    client.query('select amount_eur from public.monthly_budgets where household_id = $1', [household.id]),
    client.query(
      `select au.id, au.display_name
       from public.household_members hm
       join public.app_users au on au.id = hm.user_id
       where hm.household_id = $1
       order by au.display_name asc`,
      [household.id],
    ),
    client.query(
      `select id, amount, expense_date, category, description, paid_by, notes
       from public.expenses
       where household_id = $1
       order by expense_date desc, created_at desc`,
      [household.id],
    ),
  ]);

  return {
    profile: {
      id: profileResult.rows[0].id,
      email: profileResult.rows[0].email,
      displayName: profileResult.rows[0].display_name,
    },
    household: { id: household.id, name: household.name },
    inviteCode: inviteResult.rows[0]?.invite_code || '',
    budget: Number(budgetResult.rows[0]?.amount_eur || 0),
    members: membersResult.rows.map((row) => ({ id: row.id, displayName: row.display_name })),
    expenses: expensesResult.rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      expenseDate: row.expense_date,
      category: row.category,
      description: row.description,
      paidBy: row.paid_by,
      notes: row.notes || '',
    })),
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const displayName = String(req.body.displayName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!displayName || !email || password.length < 8) {
      res.status(400).json({ error: 'Name, email, and password (min 8 chars) are required.' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `insert into public.app_users (email, password_hash, display_name)
       values ($1, $2, $3)
       returning id`,
      [email, passwordHash, displayName],
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const result = await pool.query(
      `select id, email, password_hash
       from public.app_users
       where email = $1`,
      [email],
    );
    if (!result.rowCount) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    res.json({ token: makeToken(user) });
  } catch {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/bootstrap', authMiddleware, async (req, res) => {
  try {
    const payload = await withUserTx(req.user.id, (client) => getBootstrap(client, req.user.id));
    res.json(payload);
  } catch {
    res.status(500).json({ error: 'Failed to load data.' });
  }
});

app.post('/api/household/create', authMiddleware, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const budget = Number(req.body.budget || 0);
    if (!name) {
      res.status(400).json({ error: 'Household name is required.' });
      return;
    }
    await withUserTx(req.user.id, async (client) => {
      const existing = await client.query('select household_id from public.household_members where user_id = $1 limit 1', [req.user.id]);
      if (existing.rowCount) {
        throw new Error('You already belong to a household.');
      }
      const household = await client.query(
        `insert into public.households (name, created_by)
         values ($1, $2)
         returning id`,
        [name, req.user.id],
      );
      const householdId = household.rows[0].id;
      await client.query('insert into public.household_members (household_id, user_id) values ($1, $2)', [householdId, req.user.id]);
      await client.query(
        `insert into public.monthly_budgets (household_id, amount_eur)
         values ($1, $2)
         on conflict (household_id) do update set amount_eur = excluded.amount_eur, updated_at = now()`,
        [householdId, Number.isFinite(budget) && budget >= 0 ? budget : 0],
      );
      await client.query('insert into public.household_invites (household_id, invite_code) values ($1, public.make_invite_code())', [householdId]);
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to create household.' });
  }
});

app.post('/api/household/join', authMiddleware, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: 'Invite code is required.' });
      return;
    }
    await withUserTx(req.user.id, async (client) => {
      const existing = await client.query('select household_id from public.household_members where user_id = $1 limit 1', [req.user.id]);
      if (existing.rowCount) {
        throw new Error('You already belong to a household.');
      }
      const target = await client.query('select household_id from public.household_invites where invite_code = $1', [code]);
      if (!target.rowCount) {
        throw new Error('Invalid invite code.');
      }
      await client.query(
        `insert into public.household_members (household_id, user_id)
         values ($1, $2)
         on conflict (household_id, user_id) do nothing`,
        [target.rows[0].household_id, req.user.id],
      );
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to join household.' });
  }
});

app.put('/api/budget', authMiddleware, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: 'Budget amount must be non-negative.' });
      return;
    }
    await withUserTx(req.user.id, async (client) => {
      const household = await client.query('select household_id from public.household_members where user_id = $1 limit 1', [req.user.id]);
      if (!household.rowCount) {
        throw new Error('No household found.');
      }
      await client.query(
        `insert into public.monthly_budgets (household_id, amount_eur)
         values ($1, $2)
         on conflict (household_id) do update set amount_eur = excluded.amount_eur, updated_at = now()`,
        [household.rows[0].household_id, amount],
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update budget.' });
  }
});

app.post('/api/expenses', authMiddleware, async (req, res) => {
  try {
    await withUserTx(req.user.id, async (client) => {
      const household = await client.query('select household_id from public.household_members where user_id = $1 limit 1', [req.user.id]);
      if (!household.rowCount) {
        throw new Error('No household found.');
      }
      const payload = req.body;
      await client.query(
        `insert into public.expenses (household_id, amount, expense_date, category, description, paid_by, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          household.rows[0].household_id,
          Number(payload.amount),
          String(payload.expenseDate),
          String(payload.category),
          String(payload.description),
          String(payload.paidBy),
          String(payload.notes || ''),
          req.user.id,
        ],
      );
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to add expense.' });
  }
});

app.put('/api/expenses/:id', authMiddleware, async (req, res) => {
  try {
    await withUserTx(req.user.id, async (client) => {
      const payload = req.body;
      const result = await client.query(
        `update public.expenses
         set amount = $2,
             expense_date = $3,
             category = $4,
             description = $5,
             paid_by = $6,
             notes = $7,
             updated_at = now()
         where id = $1`,
        [
          req.params.id,
          Number(payload.amount),
          String(payload.expenseDate),
          String(payload.category),
          String(payload.description),
          String(payload.paidBy),
          String(payload.notes || ''),
        ],
      );
      if (!result.rowCount) {
        throw new Error('Expense not found.');
      }
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update expense.' });
  }
});

app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
  try {
    await withUserTx(req.user.id, async (client) => {
      const result = await client.query('delete from public.expenses where id = $1', [req.params.id]);
      if (!result.rowCount) {
        throw new Error('Expense not found.');
      }
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to delete expense.' });
  }
});

app.post('/api/backup/restore', authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};
    await withUserTx(req.user.id, async (client) => {
      const household = await client.query('select household_id from public.household_members where user_id = $1 limit 1', [req.user.id]);
      if (!household.rowCount) {
        throw new Error('No household found.');
      }
      const householdId = household.rows[0].household_id;
      if (payload.householdId !== householdId) {
        throw new Error('Backup belongs to a different household.');
      }

      const budget = Number(payload.budget ?? 0);
      if (Number.isFinite(budget) && budget >= 0) {
        await client.query(
          `insert into public.monthly_budgets (household_id, amount_eur)
           values ($1, $2)
           on conflict (household_id) do update set amount_eur = excluded.amount_eur, updated_at = now()`,
          [householdId, budget],
        );
      }

      const expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
      for (const expense of expenses) {
        await client.query(
          `insert into public.expenses (id, household_id, amount, expense_date, category, description, paid_by, notes, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (id) do update
             set amount = excluded.amount,
                 expense_date = excluded.expense_date,
                 category = excluded.category,
                 description = excluded.description,
                 paid_by = excluded.paid_by,
                 notes = excluded.notes,
                 updated_at = now()`,
          [
            String(expense.id),
            householdId,
            Number(expense.amount),
            String(expense.expenseDate),
            String(expense.category),
            String(expense.description),
            String(expense.paidBy),
            String(expense.notes || ''),
            req.user.id,
          ],
        );
      }
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to restore backup.' });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API running on port ${PORT}`);
});
