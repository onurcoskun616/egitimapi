-- Shorts Stüdyosu tablosu. Sunucu açılışında otomatik uygulanır (psql, kendi sunucu modunda).
create table if not exists shorts_projects (
  id uuid primary key default gen_random_uuid(),
  title text, topic text not null, opts jsonb not null default '{}',
  stage text not null default 'plan', status text not null default 'idle',
  progress text, error text,
  plan jsonb, sources jsonb, previews jsonb, voice jsonb, final jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
notify pgrst, 'reload schema';
