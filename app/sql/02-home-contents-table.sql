create table if not exists public.home_contents (
  id text primary key,
  title text not null default '',
  description text not null default '',
  tag text not null default '',
  image text,
  link text not null default '',
  sort integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
