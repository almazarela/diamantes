-- ============================================================================
--  v17 · Arreglo de las órdenes "pendientes" sin explicación + botón "Ya se acreditó"
--  Ejecutar UNA vez en Supabase > SQL Editor (se puede repetir sin problema).
--
--  1) revisar_envios_n8n: ANTES borraba el aviso "⚠ REVISAR A MANO" que n8n dejaba
--     en la orden (se pisaba con null al abrir el panel). Ahora lo respeta.
--  2) admin_acreditar_orden: para cerrar a mano una orden cuando comprobaste en
--     redeempins.com que el PIN SÍ se usó (los diamantes ya salieron).
-- ============================================================================

create or replace function public.revisar_envios_n8n(p_orden_id bigint default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.ordenes_recarga o
     set n8n_http_status = coalesce(h.status_code, 0),
         enviado_at      = case when h.ok then now() else o.enviado_at end,
         estado          = case when h.ok then o.estado else 'error_envio' end,
         envio_error     = case
                             when h.ok then o.envio_error          -- <- antes: null (borraba el aviso de n8n)
                             when h.timed_out then 'n8n no respondió a tiempo (timeout). Revisá que el flujo esté activo y responda enseguida.'
                             when h.error_msg is not null then left('No se pudo conectar con n8n: ' || h.error_msg, 300)
                             else left('n8n respondió HTTP ' || coalesce(h.status_code::text, '?') || ': '
                                       || regexp_replace(coalesce(h.content, ''), '\s+', ' ', 'g'), 300)
                           end,
         updated_at      = case when h.ok then o.updated_at else now() end
    from (
      select r.id, r.status_code, r.error_msg, r.content, coalesce(r.timed_out, false) as timed_out,
             (r.status_code between 200 and 299 and r.error_msg is null and coalesce(r.timed_out, false) = false) as ok
        from net._http_response r
    ) h
   where h.id = o.net_request_id
     and o.estado = 'pendiente'
     and o.n8n_http_status is null
     and (p_orden_id is null or o.id = p_orden_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.revisar_envios_n8n(bigint) from public, anon, authenticated;

-- Cerrar a mano una orden como ACREDITADA (solo admin)
create or replace function public.admin_acreditar_orden(p_orden_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  if not (public.is_admin() or lower(coalesce(auth.jwt() ->> 'email', '')) = 'almita.zarela@gmail.com') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select estado into v_estado from public.ordenes_recarga where id = p_orden_id for update;
  if not found then raise exception 'ORDEN_NO_ENCONTRADA'; end if;
  if v_estado not in ('pendiente', 'error_envio') then
    raise exception 'ORDEN_CERRADA (%)', v_estado;
  end if;
  return public.completar_orden(p_orden_id, true, 'Acreditada: confirmada a mano por el administrador', false);
end;
$$;
revoke all on function public.admin_acreditar_orden(bigint) from public, anon;
grant execute on function public.admin_acreditar_orden(bigint) to authenticated;
