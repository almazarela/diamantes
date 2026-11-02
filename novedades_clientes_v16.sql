-- Zarela · v16: respuestas rápidas de la administradora (solo ella puede verlas y editarlas).
-- Pegar TODO en Supabase > SQL Editor > Run. Se puede correr más de una vez.
create table if not exists public.respuestas_rapidas (
  id bigint generated always as identity primary key,
  titulo text not null check (char_length(titulo) between 1 and 60),
  texto  text not null check (char_length(texto) between 1 and 1000),
  orden  int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.respuestas_rapidas enable row level security;
drop policy if exists rr_solo_admin on public.respuestas_rapidas;
create policy rr_solo_admin on public.respuestas_rapidas for all to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email','')) = 'almita.zarela@gmail.com')
  with check (lower(coalesce(auth.jwt() ->> 'email','')) = 'almita.zarela@gmail.com');
grant select, insert, update, delete on public.respuestas_rapidas to authenticated;
