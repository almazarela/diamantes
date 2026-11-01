-- Zarela · v15: últimas 30 compras para el slide "Últimas compras" del carrusel.
-- Pegar TODO en Supabase > SQL Editor > Run. Se puede correr más de una vez.
-- Solo muestra nombre + inicial, foto, diamantes y hora. Nunca IDs ni mails.
create or replace function public.compras_recientes_30()
returns table(nombre text, avatar text, diamantes int, hace_seg int)
language sql security definer set search_path = public as $$
  select
    initcap(split_part(coalesce(nullif(trim(p.full_name),''), 'Cliente'), ' ', 1))
      || coalesce(' ' || upper(left(nullif(split_part(trim(p.full_name),' ',2),''),1)) || '.', ''),
    p.avatar_url,
    o.diamantes::int,
    extract(epoch from (now() - o.created_at))::int
  from ordenes_recarga o
  left join profiles p on p.id = o.user_id
  where o.estado = 'completada'
  order by o.created_at desc
  limit 30;
$$;
grant execute on function public.compras_recientes_30() to anon, authenticated;
