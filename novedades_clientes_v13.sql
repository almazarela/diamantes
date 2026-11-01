-- v13: deja conectado el aviso por mail con n8n (direccion fija n8n.almazarela.com)
create or replace function public.admin_enviar_aviso_mail(p_ids uuid[], p_asunto text, p_mensaje text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_sec text; v_mails text[];
begin
  if not public.es_admin_zarela() then raise exception 'no autorizado'; end if;
  v_url := public.config_valor(array['n8n_aviso_url']);
  v_sec := public.config_valor(array['n8n_recargas_secreto','n8n_recarga_secreto','recargo_n8n_recarga_secreto','recargo_n8n_recargas_secreto']);
  if v_url is null then return; end if;
  select array_agg(email) into v_mails from auth.users where id = any(p_ids) and email is not null;
  begin
    perform net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_sec,'')),
      body := jsonb_build_object('mails', to_jsonb(coalesce(v_mails,'{}')), 'asunto', p_asunto, 'mensaje', p_mensaje));
  exception when others then null;   -- si n8n no responde, el aviso por chat igual sale
  end;
end $$;
grant execute on function public.admin_enviar_aviso_mail(uuid[], text, text) to authenticated;

-- Direccion del flujo de avisos (ruta privada: la misma que pusiste en la caja Webhook de n8n)
insert into public.config_interna(clave, valor)
values ('n8n_aviso_url', 'https://n8n.almazarela.com/webhook/zarela-aviso-k7Qm2xW9pR4t')
on conflict (clave) do update set valor = excluded.valor;
