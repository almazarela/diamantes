-- ============================================================================
--  v18 · Stock más fácil: revisar PIN repetidos ANTES de cargar, últimos 10 subidos y buscador de PIN
--  Ejecutar UNA vez en Supabase > SQL Editor (se puede repetir sin problema).
--  Todo es SOLO para el administrador. Nunca se devuelve un PIN completo: solo los últimos 6 caracteres.
-- ============================================================================

-- 1) Revisa lo pegado: cuántos son nuevos, cuáles ya estaban (y en qué paquete) y cuáles se repiten en el mismo pegado
create or replace function public.admin_revisar_pines(p_paquete_id text, p_pines text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens   text[];
  v_validos  text[] := '{}';
  v_invalid  integer := 0;
  v_c        text;
  v_distintos integer;
  v_nuevos   integer;
  v_ya       integer;
  v_ya_mismo integer;
  v_ya_otro  jsonb;
begin
  if not (public.is_admin() or lower(coalesce(auth.jwt() ->> 'email', '')) = 'almita.zarela@gmail.com') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select coalesce(array_agg(x), '{}') into v_tokens
    from unnest(regexp_split_to_array(coalesce(p_pines, ''), '[\s,;]+')) as x where length(btrim(x)) > 0;
  if coalesce(array_length(v_tokens, 1), 0) > 2000 then raise exception 'DEMASIADOS_PINES'; end if;
  select count(distinct x) into v_distintos from unnest(v_tokens) x;
  foreach v_c in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_tokens) x) loop
    if v_c ~ '^[A-Za-z0-9-]{8,64}$' then v_validos := v_validos || v_c; else v_invalid := v_invalid + 1; end if;
  end loop;

  select count(*), count(*) filter (where s.paquete_id = p_paquete_id)
    into v_ya, v_ya_mismo
    from public.pines_stock s where s.codigo_pin = any(v_validos);
  v_nuevos := coalesce(array_length(v_validos, 1), 0) - v_ya;

  select coalesce(jsonb_agg(jsonb_build_object('fin', right(s.codigo_pin, 6), 'paquete_id', s.paquete_id, 'usado', s.is_used) ), '[]'::jsonb)
    into v_ya_otro
    from (select * from public.pines_stock s2 where s2.codigo_pin = any(v_validos) order by s2.id desc limit 5) s;

  return jsonb_build_object(
    'total',        coalesce(array_length(v_tokens, 1), 0),
    'repetidos_pegado', coalesce(array_length(v_tokens, 1), 0) - v_distintos,
    'invalidos',    v_invalid,
    'nuevos',       v_nuevos,
    'ya_cargados',  v_ya,
    'ya_en_este_paquete', v_ya_mismo,
    'ya_ejemplos',  v_ya_otro
  );
end;
$$;

-- 2) Últimos PIN subidos (máximo 10)
create or replace function public.admin_ultimos_pines(p_limite integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or lower(coalesce(auth.jwt() ->> 'email', '')) = 'almita.zarela@gmail.com') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('fin', right(t.codigo_pin, 6), 'paquete_id', t.paquete_id, 'usado', t.is_used, 'creado', t.created_at, 'usado_at', t.used_at) order by t.created_at desc, t.id desc)
      from (select * from public.pines_stock order by created_at desc, id desc limit least(greatest(coalesce(p_limite, 10), 1), 10)) t
  ), '[]'::jsonb);
end;
$$;

-- 3) Buscar un PIN (pegá todo el código o un pedazo de al menos 4 caracteres): dice en qué paquete está y si ya se usó
create or replace function public.admin_buscar_pin(p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t text := lower(btrim(coalesce(p_texto, '')));
begin
  if not (public.is_admin() or lower(coalesce(auth.jwt() ->> 'email', '')) = 'almita.zarela@gmail.com') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if length(v_t) < 4 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('fin', right(t.codigo_pin, 6), 'paquete_id', t.paquete_id, 'usado', t.is_used, 'creado', t.created_at, 'usado_at', t.used_at, 'orden_id', t.orden_id))
      from (select * from public.pines_stock where position(v_t in lower(codigo_pin)) > 0 order by id desc limit 5) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_revisar_pines(text, text) from public, anon;
revoke all on function public.admin_ultimos_pines(integer) from public, anon;
revoke all on function public.admin_buscar_pin(text) from public, anon;
grant execute on function public.admin_revisar_pines(text, text) to authenticated;
grant execute on function public.admin_ultimos_pines(integer) to authenticated;
grant execute on function public.admin_buscar_pin(text) to authenticated;
