\connect expense_tracker
create extension if not exists pgcrypto;
set role app_user;

create schema if not exists app;

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (position('@' in email) > 1),
  password_hash text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table if not exists public.household_invites (
  household_id uuid primary key references public.households(id) on delete cascade,
  invite_code text not null unique check (char_length(invite_code) between 6 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.monthly_budgets (
  household_id uuid primary key references public.households(id) on delete cascade,
  amount_eur numeric(12, 2) not null default 0 check (amount_eur >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  paid_by uuid not null references public.app_users(id) on delete restrict,
  notes text,
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

drop trigger if exists budget_updated_at on public.monthly_budgets;
create trigger budget_updated_at
before update on public.monthly_budgets
for each row execute function public.set_updated_at();

create or replace function public.make_invite_code()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.household_invites where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

alter table public.app_users enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.expenses enable row level security;

alter table public.households force row level security;
alter table public.household_members force row level security;
alter table public.household_invites force row level security;
alter table public.monthly_budgets force row level security;
alter table public.expenses force row level security;

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
for select
using (
  id = app.current_user_id()
  or exists (
    select 1
    from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    where me.user_id = app.current_user_id()
      and them.user_id = app_users.id
  )
);

drop policy if exists app_users_update on public.app_users;
create policy app_users_update on public.app_users
for update
using (id = app.current_user_id())
with check (id = app.current_user_id());

drop policy if exists households_select on public.households;
create policy households_select on public.households
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = households.id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists households_insert on public.households;
create policy households_insert on public.households
for insert
with check (created_by = app.current_user_id());

drop policy if exists households_update on public.households;
create policy households_update on public.households
for update
using (created_by = app.current_user_id())
with check (created_by = app.current_user_id());

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members
for select
using (
  user_id = app.current_user_id()
  or exists (
    select 1 from public.household_members hm
    where hm.household_id = household_members.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists members_insert on public.household_members;
create policy members_insert on public.household_members
for insert
with check (user_id = app.current_user_id());

drop policy if exists invites_select on public.household_invites;
create policy invites_select on public.household_invites
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = household_invites.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists budget_select on public.monthly_budgets;
create policy budget_select on public.monthly_budgets
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = monthly_budgets.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists budget_insert on public.monthly_budgets;
create policy budget_insert on public.monthly_budgets
for insert
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = monthly_budgets.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists budget_update on public.monthly_budgets;
create policy budget_update on public.monthly_budgets
for update
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = monthly_budgets.household_id
      and hm.user_id = app.current_user_id()
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = monthly_budgets.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
for select
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = expenses.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
for insert
with check (
  created_by = app.current_user_id()
  and exists (
    select 1 from public.household_members hm
    where hm.household_id = expenses.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
for update
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = expenses.household_id
      and hm.user_id = app.current_user_id()
  )
)
with check (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = expenses.household_id
      and hm.user_id = app.current_user_id()
  )
);

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
for delete
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = expenses.household_id
      and hm.user_id = app.current_user_id()
  )
);
