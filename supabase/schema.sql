create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.authorized_users (
  email text primary key check (position('@' in email) > 1),
  display_name text not null check (char_length(display_name) between 1 and 80),
  dob_hash text not null check (char_length(dob_hash) = 64),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.enforce_authorized_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is null then
    raise exception 'Email sign-in is required';
  end if;

  if not exists (
    select 1
    from public.authorized_users au
    where lower(au.email) = lower(new.email)
  ) then
    raise exception 'This email is not authorised for this household tracker';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_authorized_user_email on auth.users;
create trigger enforce_authorized_user_email
before insert on auth.users
for each row execute function public.enforce_authorized_user_email();

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
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

create table if not exists public.category_budgets (
  household_id uuid not null references public.households(id) on delete cascade,
  category text not null,
  amount_eur numeric(12, 2) not null default 0 check (amount_eur >= 0),
  updated_at timestamptz not null default now(),
  primary key (household_id, category)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  category text not null,
  classification text not null default 'reducible' check (classification in ('essential', 'reducible', 'optional')),
  description text not null,
  paid_by uuid not null references public.profiles(user_id) on delete restrict,
  notes text,
  is_irregular_annual boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  income_date date not null default current_date,
  source text not null,
  income_type text not null default 'other' check (income_type in ('salary', 'other')),
  received_by uuid not null references public.profiles(user_id) on delete restrict,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  cadence text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  next_due_date date not null,
  notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  amount numeric(12, 2) not null check (amount > 0),
  income_type text not null default 'other' check (income_type in ('salary', 'other')),
  cadence text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  next_due_date date not null,
  received_by uuid not null references public.profiles(user_id) on delete restrict,
  notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
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

drop trigger if exists set_updated_at_expenses on public.expenses;
create trigger set_updated_at_expenses before update on public.expenses for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_incomes on public.incomes;
create trigger set_updated_at_incomes before update on public.incomes for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_budgets on public.monthly_budgets;
create trigger set_updated_at_budgets before update on public.monthly_budgets for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_category_budgets on public.category_budgets;
create trigger set_updated_at_category_budgets before update on public.category_budgets for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_recurring_expenses on public.recurring_expenses;
create trigger set_updated_at_recurring_expenses before update on public.recurring_expenses for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_recurring_incomes on public.recurring_incomes;
create trigger set_updated_at_recurring_incomes before update on public.recurring_incomes for each row execute function public.set_updated_at();

create or replace function public.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household
      and hm.user_id = auth.uid()
  );
$$;

create or replace function public.create_household(p_name text, p_budget numeric default 0)
returns table (household_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  new_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_name is null or char_length(trim(p_name)) = 0 then raise exception 'Household name is required'; end if;

  insert into public.households (name, created_by) values (trim(p_name), auth.uid()) returning id into new_household_id;
  insert into public.household_members (household_id, user_id) values (new_household_id, auth.uid()) on conflict do nothing;
  insert into public.monthly_budgets (household_id, amount_eur)
  values (new_household_id, greatest(coalesce(p_budget, 0), 0))
  on conflict (household_id) do update set amount_eur = excluded.amount_eur, updated_at = now();

  loop
    new_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    begin
      insert into public.household_invites (household_id, invite_code) values (new_household_id, new_code);
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  return query select new_household_id, new_code;
end;
$$;

create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_household uuid;
  member_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_code is null or char_length(trim(p_code)) = 0 then raise exception 'Invite code is required'; end if;

  select household_id into target_household from public.household_invites where invite_code = upper(trim(p_code));
  if target_household is null then raise exception 'Invalid invite code'; end if;

  select count(*) into member_count from public.household_members where household_id = target_household;
  if member_count >= 2 and not exists (
    select 1 from public.household_members hm where hm.household_id = target_household and hm.user_id = auth.uid()
  ) then
    raise exception 'This household already has two authorised users';
  end if;

  insert into public.household_members (household_id, user_id) values (target_household, auth.uid()) on conflict do nothing;
  return target_household;
end;
$$;

create or replace function public.bootstrap_household_for_authorized_user(p_household_name text default 'Our Household')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  authorized_name text;
  existing_household_id uuid;
  members_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select lower(u.email) into user_email
  from auth.users u
  where u.id = auth.uid();

  select au.display_name into authorized_name
  from public.authorized_users au
  where lower(au.email) = user_email;

  if authorized_name is null then
    raise exception 'This account is not authorised for this household tracker';
  end if;

  update public.profiles
  set display_name = authorized_name
  where user_id = auth.uid() and display_name <> authorized_name;

  select hm.household_id into existing_household_id
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if existing_household_id is not null then
    return existing_household_id;
  end if;

  select h.id into existing_household_id
  from public.households h
  order by h.created_at
  limit 1;

  if existing_household_id is null then
    insert into public.households (name, created_by)
    values (coalesce(nullif(trim(p_household_name), ''), 'Our Household'), auth.uid())
    returning id into existing_household_id;

    insert into public.monthly_budgets (household_id, amount_eur)
    values (existing_household_id, 0)
    on conflict (household_id) do nothing;
  end if;

  select count(*) into members_count
  from public.household_members
  where household_id = existing_household_id;

  if members_count >= 2 then
    raise exception 'This household already has two authorised users';
  end if;

  insert into public.household_members (household_id, user_id)
  values (existing_household_id, auth.uid())
  on conflict do nothing;

  return existing_household_id;
end;
$$;

create or replace function public.verify_access_dob(p_dob date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  expected_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_dob is null then return false; end if;

  select lower(u.email) into user_email
  from auth.users u
  where u.id = auth.uid();

  select au.dob_hash into expected_hash
  from public.authorized_users au
  where lower(au.email) = user_email;

  if expected_hash is null then
    return false;
  end if;

  return expected_hash = encode(digest(p_dob::text, 'sha256'), 'hex');
end;
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.category_budgets enable row level security;
alter table public.expenses enable row level security;
alter table public.incomes enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.recurring_incomes enable row level security;

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy on public.profiles
for select using (
  user_id = auth.uid()
  or exists (
    select 1 from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    where me.user_id = auth.uid() and them.user_id = profiles.user_id
  )
);

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy on public.profiles
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists households_select_policy on public.households;
create policy households_select_policy on public.households for select using (public.is_household_member(id));

drop policy if exists households_insert_policy on public.households;
create policy households_insert_policy on public.households for insert with check (created_by = auth.uid());

drop policy if exists households_update_policy on public.households;
create policy households_update_policy on public.households for update using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists household_members_select_policy on public.household_members;
create policy household_members_select_policy on public.household_members for select using (public.is_household_member(household_id));

drop policy if exists household_members_insert_policy on public.household_members;
create policy household_members_insert_policy on public.household_members for insert with check (user_id = auth.uid());

drop policy if exists household_invites_select_policy on public.household_invites;
create policy household_invites_select_policy on public.household_invites for select using (public.is_household_member(household_id));

drop policy if exists budgets_select_policy on public.monthly_budgets;
create policy budgets_select_policy on public.monthly_budgets for select using (public.is_household_member(household_id));

drop policy if exists budgets_insert_policy on public.monthly_budgets;
create policy budgets_insert_policy on public.monthly_budgets for insert with check (public.is_household_member(household_id));

drop policy if exists budgets_update_policy on public.monthly_budgets;
create policy budgets_update_policy on public.monthly_budgets for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists category_budgets_select_policy on public.category_budgets;
create policy category_budgets_select_policy on public.category_budgets for select using (public.is_household_member(household_id));

drop policy if exists category_budgets_insert_policy on public.category_budgets;
create policy category_budgets_insert_policy on public.category_budgets for insert with check (public.is_household_member(household_id));

drop policy if exists category_budgets_update_policy on public.category_budgets;
create policy category_budgets_update_policy on public.category_budgets for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists category_budgets_delete_policy on public.category_budgets;
create policy category_budgets_delete_policy on public.category_budgets for delete using (public.is_household_member(household_id));

drop policy if exists expenses_select_policy on public.expenses;
create policy expenses_select_policy on public.expenses for select using (public.is_household_member(household_id));

drop policy if exists expenses_insert_policy on public.expenses;
create policy expenses_insert_policy on public.expenses for insert with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists expenses_update_policy on public.expenses;
create policy expenses_update_policy on public.expenses for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists expenses_delete_policy on public.expenses;
create policy expenses_delete_policy on public.expenses for delete using (public.is_household_member(household_id));

drop policy if exists incomes_select_policy on public.incomes;
create policy incomes_select_policy on public.incomes for select using (public.is_household_member(household_id));

drop policy if exists incomes_insert_policy on public.incomes;
create policy incomes_insert_policy on public.incomes for insert with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists incomes_update_policy on public.incomes;
create policy incomes_update_policy on public.incomes for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists incomes_delete_policy on public.incomes;
create policy incomes_delete_policy on public.incomes for delete using (public.is_household_member(household_id));

drop policy if exists recurring_expenses_select_policy on public.recurring_expenses;
create policy recurring_expenses_select_policy on public.recurring_expenses for select using (public.is_household_member(household_id));

drop policy if exists recurring_expenses_insert_policy on public.recurring_expenses;
create policy recurring_expenses_insert_policy on public.recurring_expenses for insert with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists recurring_expenses_update_policy on public.recurring_expenses;
create policy recurring_expenses_update_policy on public.recurring_expenses for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists recurring_expenses_delete_policy on public.recurring_expenses;
create policy recurring_expenses_delete_policy on public.recurring_expenses for delete using (public.is_household_member(household_id));

drop policy if exists recurring_incomes_select_policy on public.recurring_incomes;
create policy recurring_incomes_select_policy on public.recurring_incomes for select using (public.is_household_member(household_id));

drop policy if exists recurring_incomes_insert_policy on public.recurring_incomes;
create policy recurring_incomes_insert_policy on public.recurring_incomes for insert with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists recurring_incomes_update_policy on public.recurring_incomes;
create policy recurring_incomes_update_policy on public.recurring_incomes for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

drop policy if exists recurring_incomes_delete_policy on public.recurring_incomes;
create policy recurring_incomes_delete_policy on public.recurring_incomes for delete using (public.is_household_member(household_id));

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
revoke all on function public.create_household(text, numeric) from public;
grant execute on function public.create_household(text, numeric) to authenticated;
revoke all on function public.join_household(text) from public;
grant execute on function public.join_household(text) to authenticated;
revoke all on function public.bootstrap_household_for_authorized_user(text) from public;
grant execute on function public.bootstrap_household_for_authorized_user(text) to authenticated;
revoke all on function public.verify_access_dob(date) from public;
grant execute on function public.verify_access_dob(date) to authenticated;

revoke all on table public.authorized_users from anon, authenticated;
