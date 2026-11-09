-- Sinematik film modülü tablosu. Sunucu açılışında otomatik uygulanır (psql, kendi sunucu modunda).
create table if not exists sinema_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  title text, topic text not null, opts jsonb not null default '{}',
  stage text not null default 'script', status text not null default 'idle',
  progress jsonb, error text, auto boolean default false,
  script jsonb, characters jsonb, scenes jsonb, audio jsonb, final jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
notify pgrst, 'reload schema';
