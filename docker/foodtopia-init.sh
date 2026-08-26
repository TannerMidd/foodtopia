#!/bin/sh
set -eu

psql_base="psql -X -h db -U postgres -d postgres -v ON_ERROR_STOP=1"

$psql_base <<'SQL'
create table if not exists public._foodtopia_local_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
revoke all on public._foodtopia_local_migrations from anon, authenticated;
SQL

apply() {
  name="$1"
  file="$2"
  if [ "$($psql_base -Atc "select count(*) from public._foodtopia_local_migrations where name = '$name'")" = "1" ]; then
    return
  fi
  echo "Applying $name"
  if [ "${3:-transaction}" = "transaction" ]; then
    $psql_base --single-transaction -f "$file"
  else
    $psql_base -f "$file"
  fi
  $psql_base -c "insert into public._foodtopia_local_migrations (name) values ('$name')"
}

for file in /foodtopia/migrations/*.sql; do
  apply "$(basename "$file")" "$file"
done
apply "seed.sql" /foodtopia/seed.sql own-transaction
apply "local-recipes.sql" /foodtopia/local-recipes.sql own-transaction
apply "local-bootstrap.sql" /foodtopia/local-bootstrap.sql

$psql_base -c "notify pgrst, 'reload schema'"
