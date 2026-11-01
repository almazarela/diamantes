-- v12: tildes tipo WhatsApp (enviado / entregado / visto) y Top de recargas con 10 puestos
alter table public.messages add column if not exists entregado boolean not null default false;

-- El cliente abrió la página: los mensajes de Alma Zarela le fueron entregados
create or replace function public.cliente_marcar_entregados()
returns void language sql security definer set search_path = public as $$
  update public.messages set entregado = true
   where user_id::text = auth.uid()::text and sender_id is not null and sender_id::text <> user_id::text and not coalesce(entregado,false);
$$;
-- El cliente abrió el chat: los vio
create or replace function public.cliente_marcar_leidos()
returns void language sql security definer set search_path = public as $$
  update public.messages set is_read = true, entregado = true
   where user_id::text = auth.uid()::text and sender_id is not null and sender_id::text <> user_id::text and not (coalesce(is_read,false) and coalesce(entregado,false));
$$;
-- La administradora tiene el panel abierto: los mensajes de clientes le llegaron
create or replace function public.admin_marcar_entregados()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin_zarela() then return; end if;
  update public.messages set entregado = true
   where (sender_id is null or sender_id::text = user_id::text) and not coalesce(entregado,false);
end $$;
grant execute on function public.cliente_marcar_entregados() to authenticated;
grant execute on function public.cliente_marcar_leidos() to authenticated;
grant execute on function public.admin_marcar_entregados() to authenticated;

-- Top de recargas: ahora devuelve 10 (el carrusel muestra los 5 primeros)
create or replace function public.top_compradores()
returns table(nombre text, avatar text, es_soporte boolean, diamantes bigint, compras bigint)
language sql security definer set search_path = public as $$
  select coalesce(nullif(trim(p.full_name),''), 'Cliente'),
         p.avatar_url,
         coalesce(p.is_admin, false) or lower(coalesce(p.email,'')) = 'almita.zarela@gmail.com',
         sum(o.diamantes)::bigint, count(*)::bigint
  from ordenes_recarga o
  left join profiles p on p.id = o.user_id
  where o.estado = 'completada'
  group by o.user_id, p.full_name, p.avatar_url, p.is_admin, p.email
  order by 4 desc
  limit 10;
$$;
grant execute on function public.top_compradores() to anon, authenticated;
