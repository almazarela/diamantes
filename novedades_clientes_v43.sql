-- v43: PERFILES públicos + Me gusta, INSIGNIA ✔ de verificación, fotos libres en chats privados con aviso para vos,
--      reacciones en chats privados, nombres actuales en opiniones, avisos agrupados.
-- Requiere v39 a v42. Se puede correr más de una vez.

-- ===== 0) Fotos en chats privados: LIBRES (sin aprobación). Vos recibís aviso =====
update public.novedades_config set valor = 'on' where clave = 'dm_fotos';
alter table public.dm_mensajes add column if not exists visto_admin boolean not null default false;

-- ===== 1) Perfil =====
alter table public.profiles add column if not exists bio text, add column if not exists fondo text;
alter table public.perfil_soporte add column if not exists bio text, add column if not exists fondo text, add column if not exists titulo text;
create table if not exists public.profile_likes (de uuid not null, para uuid not null, created_at timestamptz not null default now(), primary key (de, para), check (de <> para));
alter table public.profile_likes enable row level security;

-- ===== 2) Verificación ✔ =====
create table if not exists public.verificaciones (user_id uuid primary key, desde timestamptz not null default now(), hasta timestamptz, nota text);
alter table public.verificaciones enable row level security;
create table if not exists public.verif_pedidos (user_id uuid primary key, created_at timestamptz not null default now(), nota text);
alter table public.verif_pedidos enable row level security;
insert into public.novedades_config (clave, valor) values
  ('f_verif', 'off'), ('verif_precio_ars', '0'), ('verif_precio_usd', '0'), ('verif_dias', '0'), ('verif_min_recargas', '3')
on conflict (clave) do nothing;

create or replace function public._verificado(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.verificaciones v where v.user_id = uid and (v.hasta is null or v.hasta > now()))
$$;

-- Switches de novedades (se agregan las claves nuevas)
create or replace function public.admin_nov_config(p_clave text, p_valor text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_valor, ''));
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  if p_clave in ('f_historias','f_cupones','f_referidos','f_puntos','f_verif') then
    if v not in ('on','off','pronto') then raise exception 'VALOR_INVALIDO'; end if;
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

-- ===== 3) Datos públicos de varios usuarios (nombre actual, foto, ✔) =====
create or replace function public.perfiles_publicos(p_ids uuid[]) returns table (id uuid, nombre text, foto text, num_id bigint, verificado boolean, es_soporte boolean)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(trim(p.full_name),''), nullif(trim(p.alias),''), 'Cliente'),
         case when s.user_id = p.id and s.avatar_url is not null then s.avatar_url else p.avatar_url end, p.num_id, public._verificado(p.id),
         (s.user_id = p.id or coalesce(p.is_admin,false) or lower(coalesce(p.email,'')) = 'almita.zarela@gmail.com')
    from public.profiles p left join public.perfil_soporte s on s.id = 1
   where p.id = any (p_ids[1:300])
$$;
grant execute on function public.perfiles_publicos(uuid[]) to anon, authenticated;

-- ===== 4) Perfil completo =====
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
    'mi_like', exists (select 1 from public.profile_likes l where l.para = p.id and l.de = yo),
    'amigos', (select count(*) from public.amigos z where z.estado = 'aceptada' and p.id in (z.a, z.b)),
    'relacion', rel, 'yo', (yo = p.id));
end $$;
grant execute on function public.perfil_publico(uuid) to anon, authenticated;

create or replace function public.perfil_like(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ya boolean;
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if p_user = uid then raise exception 'PROPIO'; end if;
  select exists (select 1 from public.profile_likes where de = uid and para = p_user) into ya;
  if ya then delete from public.profile_likes where de = uid and para = p_user; else insert into public.profile_likes (de, para) values (uid, p_user); end if;
  return jsonb_build_object('mi_like', not ya, 'likes', (select count(*) from public.profile_likes where para = p_user));
end $$;
grant execute on function public.perfil_like(uuid) to authenticated;

create or replace function public.mi_perfil_guardar(p_bio text, p_fondo text, p_titulo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b text := regexp_replace(trim(coalesce(p_bio,'')), '\s+', ' ', 'g'); l text; f text := nullif(trim(coalesce(p_fondo,'')), '');
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if length(b) > 140 then raise exception 'TEXTO_INVALIDO'; end if;
  if f is not null and f !~ '^[a-z0-9_-]{1,20}$' then raise exception 'FONDO_INVALIDO'; end if;
  if public._chat_admin() then
    update public.perfil_soporte set bio = nullif(b,''), fondo = f, titulo = nullif(left(trim(coalesce(p_titulo,'')),40),''), updated_at = now() where id = 1;
    return;
  end if;
  l := lower(translate(b, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  if l ~ '(https?:|www\.|\.com|\.net|\.org|\.xyz|\.me\b|\.ar\b|bit\.ly|t\.me|wa\.me|discord|whatsapp|wsp|telegram|instagram|tiktok|@[a-z0-9_.]{3,}|\malias\M|\mcvu\M|[a-z0-9_]{3,}\.[a-z0-9_]{2,})' then raise exception 'LINK'; end if;
  if regexp_replace(l, '[^0-9]', '', 'g') ~ '[0-9]{8,}' then raise exception 'TELEFONO'; end if;
  if l ~ '(vendo|vendemos|revendo|compro diamantes|diamantes baratos|transferime|puta|mierda|pelotud|boludo|idiota|imbecil|\mhdp\M|forro|concha|verga|sexo|desnud)' then raise exception 'VENTA'; end if;
  update public.profiles set bio = nullif(b,''), fondo = f where id = uid;
end $$;
grant execute on function public.mi_perfil_guardar(text, text, text) to authenticated;

-- ===== 5) Verificación: lo que ve el cliente y lo que hacés vos =====
create or replace function public.verif_estado() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); c jsonb; rec bigint := 0; v public.verificaciones;
begin
  select coalesce(jsonb_object_agg(clave, valor), '{}'::jsonb) into c from public.novedades_config where clave in ('f_verif','verif_precio_ars','verif_precio_usd','verif_dias','verif_min_recargas');
  if uid is not null then
    select count(*) into rec from public.ordenes_recarga where user_id = uid and estado = 'completada';
    select * into v from public.verificaciones where user_id = uid;
  end if;
  return jsonb_build_object('cfg', c, 'recargas', rec, 'activo', public._verificado(uid), 'hasta', v.hasta,
    'pedido', exists (select 1 from public.verif_pedidos where user_id = uid));
end $$;
grant execute on function public.verif_estado() to anon, authenticated;

create or replace function public.verif_pedir() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); min int := public._cfg_num('verif_min_recargas', 3)::int; rec bigint;
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not public.nov_on('f_verif') then raise exception 'NO_DISPONIBLE'; end if;
  select count(*) into rec from public.ordenes_recarga where user_id = uid and estado = 'completada';
  if rec < min then raise exception 'REQUISITO'; end if;
  insert into public.verif_pedidos (user_id) values (uid) on conflict do nothing;
end $$;
grant execute on function public.verif_pedir() to authenticated;

create or replace function public.admin_verif_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  select jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', q.user_id, 'nombre', public._chat_nombre(q.user_id), 'num_id', p.num_id, 'cuando', q.created_at,
        'recargas', (select count(*) from public.ordenes_recarga o where o.user_id = q.user_id and o.estado = 'completada')) order by q.created_at)
        from public.verif_pedidos q left join public.profiles p on p.id = q.user_id), '[]'::jsonb),
    'activos', coalesce((select jsonb_agg(jsonb_build_object('id', v.user_id, 'nombre', public._chat_nombre(v.user_id), 'num_id', p.num_id, 'desde', v.desde, 'hasta', v.hasta) order by v.desde desc)
        from public.verificaciones v left join public.profiles p on p.id = v.user_id), '[]'::jsonb)) into r;
  return r;
end $$;
grant execute on function public.admin_verif_listar() to authenticated;

-- buscar a un cliente por # de ID o por nombre, para darle el ✔ directo
create or replace function public.admin_verif_buscar(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(regexp_replace(trim(coalesce(p_q,'')), '^#', '')); r jsonb;
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  if length(q) < 2 and q !~ '^[0-9]+$' then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', public._chat_nombre(p.id), 'num_id', p.num_id, 'verificado', public._verificado(p.id),
      'recargas', (select count(*) from public.ordenes_recarga o where o.user_id = p.id and o.estado = 'completada'))), '[]'::jsonb) into r
  from (select * from public.profiles where (q ~ '^[0-9]+$' and num_id = q::bigint) or lower(coalesce(alias,'')) like '%' || q || '%' or lower(coalesce(full_name,'')) like '%' || q || '%' order by num_id limit 8) p;
  return r;
end $$;
grant execute on function public.admin_verif_buscar(text) to authenticated;

-- dar el ✔ (p_dias = 0: sin vencimiento; si no, vence en esa cantidad de días)
create or replace function public.admin_verif_dar(p_user uuid, p_dias integer default 0) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  insert into public.verificaciones (user_id, desde, hasta) values (p_user, now(), case when coalesce(p_dias,0) > 0 then now() + make_interval(days => p_dias) end)
  on conflict (user_id) do update set desde = now(), hasta = excluded.hasta;
  delete from public.verif_pedidos where user_id = p_user;
end $$;
grant execute on function public.admin_verif_dar(uuid, integer) to authenticated;

create or replace function public.admin_verif_quitar(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  delete from public.verificaciones where user_id = p_user;
  delete from public.verif_pedidos where user_id = p_user;
end $$;
grant execute on function public.admin_verif_quitar(uuid) to authenticated;

-- ===== 6) Fotos de chats privados: aviso para vos =====
create or replace function public.admin_dm_fotos_nuevas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  select coalesce(jsonb_agg(x order by x.ult desc), '[]'::jsonb) into r from (
    select m.de as u1, m.para as u2, public._chat_nombre(m.de) as n1, public._chat_nombre(m.para) as n2, count(*) as fotos, max(m.created_at) as ult
      from public.dm_mensajes m
     where m.tipo = 'foto' and not m.visto_admin and m.estado = 'ok' and m.created_at > now() - interval '14 days'
       and not exists (select 1 from public.profiles a where a.id = m.de and (coalesce(a.is_admin,false) or lower(coalesce(a.email,'')) = 'almita.zarela@gmail.com'))
     group by m.de, m.para order by max(m.created_at) desc limit 40) x;
  return r;
end $$;
grant execute on function public.admin_dm_fotos_nuevas() to authenticated;

create or replace function public.admin_dm_fotos_vistas(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._chat_admin() then raise exception 'no autorizado'; end if;
  update public.dm_mensajes set visto_admin = true where tipo = 'foto' and ((de = p_a and para = p_b) or (de = p_b and para = p_a));
end $$;
grant execute on function public.admin_dm_fotos_vistas(uuid, uuid) to authenticated;

-- ===== 7) Reacciones en chats privados + lista de mensajes con reacciones =====
create table if not exists public.dm_reacciones (msg_id bigint not null references public.dm_mensajes(id) on delete cascade, user_id uuid not null, emoji text not null, primary key (msg_id, user_id));
alter table public.dm_reacciones enable row level security;

create or replace function public.dm_reaccionar(p_id bigint, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.dm_mensajes; ant text;
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if p_emoji not in ('❤️','🔥','😂','😮','👏','👍') then raise exception 'EMOJI_INVALIDO'; end if;
  select * into m from public.dm_mensajes where id = p_id;
  if not found or uid not in (m.de, m.para) or m.estado <> 'ok' then return; end if;
  select emoji into ant from public.dm_reacciones where msg_id = p_id and user_id = uid;
  if ant = p_emoji then delete from public.dm_reacciones where msg_id = p_id and user_id = uid;
  else insert into public.dm_reacciones (msg_id, user_id, emoji) values (p_id, uid, p_emoji) on conflict (msg_id, user_id) do update set emoji = excluded.emoji; end if;
end $$;
grant execute on function public.dm_reaccionar(bigint, text) to authenticated;

drop function if exists public.dm_lista(uuid);
create or replace function public.dm_lista(p_con uuid) returns table (id bigint, mio boolean, tipo text, texto text, foto_path text, estado text, leido boolean, created_at timestamptz, rx jsonb)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NO_AUTENTICADO'; end if;
  if not public._son_amigos(uid, p_con) then return; end if;
  update public.dm_mensajes d set leido = true where d.de = p_con and d.para = uid and not d.leido and d.estado = 'ok';
  return query select m.id, (m.de = uid), m.tipo, m.texto, m.foto_path, m.estado, m.leido, m.created_at,
      (select coalesce(jsonb_agg(jsonb_build_object('e', z.e, 'n', z.n, 'mia', z.mia)), '[]'::jsonb) from (
         select r.emoji as e, count(*) as n, bool_or(r.user_id = uid) as mia from public.dm_reacciones r where r.msg_id = m.id group by r.emoji) z)
    from public.dm_mensajes m where ((m.de = uid and m.para = p_con) or (m.de = p_con and m.para = uid)) and (m.estado = 'ok' or m.de = uid)
    order by m.id desc limit 80;
end $$;
grant execute on function public.dm_lista(uuid) to authenticated;

-- ===== 8) Avisos con el celular/PC cerrado: mensaje privado y fotos =====
create or replace function public.push_tg_dm() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare nom text := public._chat_nombre(new.de);
begin
  if new.estado = 'ok' then
    perform public.push_enviar(jsonb_build_object('user_ids', jsonb_build_array(new.para), 'titulo', nom,
      'cuerpo', case new.tipo when 'foto' then '📷 Foto' when 'id' then '🎮 ID de Free Fire' else left(coalesce(new.texto,''), 140) end, 'tag', 'dm-' || new.de));
  end if;
  if new.tipo = 'foto' and not public._chat_admin_de(new.de) then
    perform public.push_enviar(jsonb_build_object('para_admin', true, 'titulo', '📷 Foto en un chat privado', 'cuerpo', nom || ' envió una foto', 'tag', 'dmfoto'));
  end if;
  return new;
exception when others then return new;
end $$;
create or replace function public._chat_admin_de(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and (coalesce(p.is_admin,false) or lower(coalesce(p.email,'')) = 'almita.zarela@gmail.com'))
$$;
drop trigger if exists push_dm_tg on public.dm_mensajes;
create trigger push_dm_tg after insert on public.dm_mensajes for each row execute function public.push_tg_dm();
