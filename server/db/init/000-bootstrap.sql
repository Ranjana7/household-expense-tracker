select 'create role app_user login password ''change_me_dev_password'' nosuperuser nocreatedb nocreaterole noinherit'
where not exists (select 1 from pg_roles where rolname = 'app_user')
\gexec

select 'create database expense_tracker'
where not exists (select 1 from pg_database where datname = 'expense_tracker')
\gexec

\connect expense_tracker
grant connect on database expense_tracker to app_user;
grant usage, create on schema public to app_user;
