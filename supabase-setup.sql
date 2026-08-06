create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  perfil text not null default 'usuario' check (perfil in ('usuario', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  conversation_id text not null,
  content text not null,
  created_at timestamptz not null default now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN full_name TO nome;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN role TO perfil;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN created_at timestamptz not null default now();
  END IF;
END$$;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

create policy if not exists "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy if not exists "Profiles are updatable by their owner"
  on public.profiles for update
  using (auth.uid() = id);

create policy if not exists "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid() and p.perfil = 'admin'
    )
  );

create policy if not exists "Admins can update all profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid() and p.perfil = 'admin'
    )
  );

create policy if not exists "Service role can manage profiles"
  on public.profiles for all
  using (auth.jwt() ->> 'role' = 'service_role');

create policy if not exists "Authenticated users can insert messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy if not exists "Users can read their own messages"
  on public.messages for select
  using (auth.uid() = user_id);

create policy if not exists "Admins can read all messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.profiles as p
      where p.id = auth.uid() and p.perfil = 'admin'
    )
  );

create policy if not exists "Service role can manage messages"
  on public.messages for all
  using (auth.jwt() ->> 'role' = 'service_role');

create function if not exists public.prevent_perfil_change() returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'UPDATE' and old.perfil <> new.perfil then
    if not exists (
      select 1 from public.profiles as p
      where p.id = auth.uid() and p.perfil = 'admin'
    ) then
      raise exception 'Não autorizado a alterar o perfil.';
    end if;
  end if;
  return new;
end;
$$;

create trigger if not exists prevent_perfil_change_trigger
  before update on public.profiles
  for each row execute function public.prevent_perfil_change();
