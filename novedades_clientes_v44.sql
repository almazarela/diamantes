-- v44: Un Me gusta por día por persona, portada con foto propia, historias libres o con aprobación.
-- Requiere v43. Se puede correr más de una vez.

-- ===== 1) Me gusta: uno por día a cada persona =====
alter table public.profile_likes add column if not exists dia date not null default current_date;
update public.profile_likes set dia = created_at::date where dia = current_date and created_at::date <> current_date;
do $$ begin
  alter table public.profile_likes drop constraint if exists profile_likes_pkey;
  alter table public.profile_likes add primary key (de, para, dia);
exception when others then raise notice 'likes pk: %', sqlerrm; end $$;

create or replace function public.perfil_like(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if p_user = uid then raise exception 'PROPIO'; end if;
  if exists (select 1 from public.profile_likes where de = uid and para = p_user and dia = current_date) then raise exception 'YA_HOY'; end if;
  insert into public.profile_likes (de, para, dia) values (uid, p_user, current_date);
  return jsonb_build_object('mi_like', true, 'likes', (select count(*) from public.profile_likes where para = p_user));
end $$;
grant execute on function public.perfil_like(uuid) to authenticated;

-- ===== 2) Portada con foto propia =====
alter table public.profiles add column if not exists portada text;
alter table public.perfil_soporte add column if not exists portada text;

drop function if exists public.mi_perfil_guardar(text, text, text);
create or replace function public.mi_perfil_guardar(p_bio text, p_fondo text, p_titulo text default null, p_portada text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b text := regexp_replace(trim(coalesce(p_bio,'')), '\s+', ' ', 'g'); l text; f text := nullif(trim(coalesce(p_fondo,'')), '');
        por text := case when p_portada is null then null when p_portada = '' then '' else p_portada end;
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if length(b) > 140 then raise exception 'TEXTO_INVALIDO'; end if;
  if f is not null and f !~ '^[a-z0-9_-]{1,20}$' then raise exception 'FONDO_INVALIDO'; end if;
  if por is not null and por <> '' and por not like uid::text || '/%' then raise exception 'RUTA_INVALIDA'; end if;
  if public._chat_admin() then
    update public.perfil_soporte set bio = nullif(b,''), fondo = f, titulo = nullif(left(trim(coalesce(p_titulo,'')),40),''),
      portada = case when por is null then portada else nullif(por,'') end, updated_at = now() where id = 1;
    return;
  end if;
  l := lower(translate(b, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  if l ~ '(https?:|www\.|\.com|\.net|\.org|\.xyz|\.me\b|\.ar\b|bit\.ly|t\.me|wa\.me|discord|whatsapp|wsp|telegram|instagram|tiktok|@[a-z0-9_.]{3,}|\malias\M|\mcvu\M|[a-z0-9_]{3,}\.[a-z0-9_]{2,})' then raise exception 'LINK'; end if;
  if regexp_replace(l, '[^0-9]', '', 'g') ~ '[0-9]{8,}' then raise exception 'TELEFONO'; end if;
  if l ~ '(vendo|vendemos|revendo|compro diamantes|diamantes baratos|transferime|puta|mierda|pelotud|boludo|idiota|imbecil|\mhdp\M|forro|concha|verga|sexo|desnud)' then raise exception 'VENTA'; end if;
  update public.profiles set bio = nullif(b,''), fondo = f, portada = case when por is null then portada else nullif(por,'') end where id = uid;
end $$;
grant execute on function public.mi_perfil_guardar(text, text, text, text) to authenticated;

-- vos podés sacarle la portada a alguien si no corresponde
create or replace function public.admin_perfil_quitar_portada(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  update public.profiles set portada = null where id = p_user;
end $$;
grant execute on function public.admin_perfil_quitar_portada(uuid) to authenticated;

-- ===== 3) Perfil público (ahora con portada y Me gusta del día) =====
create or replace function public.perfil_publico(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; s public.perfil_soporte; yo uuid := auth.uid(); sop boolean; rel text := 'ninguna';
begin
  select * into p from public.profiles where id = p_id; if not found then return null; end if;
  select * into s from public.perfil_soporte where id = 1;
  sop := (s.user_id = p.id) or coalesce(p.is_admin,false) or lower(coalesce(p.email,'')) = 'almita.zarela@gmail.com';
  if yo is not null and yo <> p.id then
    rel := case when exists (select 1 from public.amigos z where z.estado = 'aceptada' and ((z.a = yo and z.b = p.id) or (z.b = yo and z.a = p.id))) then 'amigos'
                when exists (select 1 from public.amigos z where z.estado = 'pendiente' and z.a = yo and z.b = p.id) then 'enviada'
                when exists (select 1 from public.amigos z where z.estado = 'pendiente' and z.b = yo and z.a = p.id) then 'recibida' else 'ninguna' end;
  end if;
  return jsonb_build_object(
    'id', p.id, 'es_soporte', sop, 'num_id', p.num_id,
    'nombre', case when sop then coalesce(s.nombre, 'Alma Zarela') else coalesce(nullif(trim(p.full_name),''), nullif(trim(p.alias),''), 'Cliente') end,
    'foto', case when sop and s.avatar_url is not null then s.avatar_url else p.avatar_url end,
    'fondo', case when sop then s.fondo else p.fondo end,
    'bio', case when sop then s.bio else p.bio end,
    'titulo', case when sop then s.titulo end,
    'verificado', public._verificado(p.id) or sop,
    'desde', p.created_at,
    'recargas', (select count(*) from public.ordenes_recarga o where (sop or o.user_id = p.id) and o.estado = 'completada'),
    'diamantes', (select coalesce(sum(o.diamantes),0) from public.ordenes_recarga o where (sop or o.user_id = p.id) and o.estado = 'completada'),
    'likes', (select count(*) from public.profile_likes l where l.para = p.id),
    'portada', case when sop then s.portada else p.portada end,
    'mi_like', exists (select 1 from public.profile_likes l where l.para = p.id and l.de = yo and l.dia = current_date),
    'amigos', (select count(*) from public.amigos z where z.estado = 'aceptada' and p.id in (z.a, z.b)),
    'relacion', rel, 'yo', (yo = p.id));
end $$;
grant execute on function public.perfil_publico(uuid) to anon, authenticated;

-- ===== 4) Historias: libres o con aprobación =====
insert into public.novedades_config (clave, valor) values ('hist_modo', 'aprobacion') on conflict (clave) do nothing;
create or replace function public.admin_nov_config(p_clave text, p_valor text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_valor, ''));
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  if p_clave in ('f_historias','f_cupones','f_referidos','f_puntos','f_verif') then
    if v not in ('on','off','pronto') then raise exception 'VALOR_INVALIDO'; end if;
  elsif p_clave = 'hist_modo' then
    if v not in ('aprobacion','libre') then raise exception 'VALOR_INVALIDO'; end if;
  elsif p_clave = 'dm_fotos' then
    if v not in ('off','primeras','on') then raise exception 'VALOR_INVALIDO'; end if;
  elsif p_clave in ('f_historias_hora','f_cupones_hora','f_referidos_hora','f_puntos_hora','f_verif_hora') then
    if v <> '' then perform v::timestamptz; end if;
  elsif p_clave in ('ref_amigo_pct','ref_amigo_tope_ars','ref_amigo_tope_usd','ref_puntos','pts_unidad_ars','pts_unidad_usd','pts_valor_ars','pts_min','verif_precio_ars','verif_precio_usd','verif_dias','verif_min_recargas') then
    if v !~ '^[0-9]+(\.[0-9]+)?$' or v::numeric > 1000000 then raise exception 'VALOR_INVALIDO'; end if;
  else raise exception 'CLAVE_INVALIDA'; end if;
  insert into public.novedades_config (clave, valor) values (p_clave, v) on conflict (clave) do update set valor = excluded.valor;
end $$;
grant execute on function public.admin_nov_config(text, text) to authenticated;

create or replace function public.historia_publicar(p_texto text, p_path text, p_color integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); adm boolean := public._chat_admin(); t text := regexp_replace(trim(coalesce(p_texto,'')), '\s+', ' ', 'g'); l text; est text; nid bigint; conf boolean;
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not (adm or public.nov_on('f_historias')) then raise exception 'PROXIMAMENTE'; end if;
  if not adm and not public.he_recargado(uid) then raise exception 'SOLO_CLIENTES'; end if;
  if length(t) > 80 then raise exception 'TEXTO_INVALIDO'; end if;
  if coalesce(p_path,'') = '' and length(t) < 2 then raise exception 'TEXTO_INVALIDO'; end if;
  if coalesce(p_path,'') <> '' and p_path not like uid::text || '/%' then raise exception 'RUTA_INVALIDA'; end if;
  if not adm then
    if (select count(*) from public.historias where user_id = uid and created_at > now() - interval '24 hours') >= 3 then raise exception 'LIMITE'; end if;
    l := lower(translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
    if l ~ '(https?:|www\.|\.com|\.net|\.org|\.xyz|\.me\b|\.ar\b|bit\.ly|t\.me|wa\.me|discord|whatsapp|wsp|telegram|instagram|tiktok|@[a-z0-9_.]{3,}|vendo|vendemos|revendo|estaf|chanta|ladron|fraude|scam|puta|mierda|pelotud|boludo|idiota|imbecil|hdp|forro|concha|verga)' or regexp_replace(l,'[^0-9]','','g') ~ '[0-9]{8,}' then raise exception 'TEXTO_NO_PERMITIDO'; end if;
  end if;
  select exists (select 1 from public.historias_confiables where user_id = uid) into conf;
  est := case when adm or coalesce(p_path,'') = '' or conf or coalesce((select valor from public.novedades_config where clave = 'hist_modo'), 'aprobacion') = 'libre' then 'aprobada' else 'pendiente' end;
  insert into public.historias (user_id, nombre, texto, imagen_path, color, estado, oficial)
  values (uid, case when adm then 'Zarela' else public._chat_nombre(uid) end, nullif(t,''), nullif(p_path,''), coalesce(p_color,0) % 6, est, adm) returning id into nid;
  return jsonb_build_object('id', nid, 'estado', est);
end $$;
grant execute on function public.historia_publicar(text, text, integer) to authenticated;
