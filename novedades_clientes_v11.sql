-- v11: Jugadores (historial permanente de salas) + aviso por mail (n8n/Gmail)
alter table public.admin_chat_meta add column if not exists jugo_salas int[] not null default '{}';
alter table public.admin_chat_meta add column if not exists ultima_sala_at timestamptz;

-- Envía un aviso por mail a los usuarios elegidos, vía n8n (webhook). Si n8n/Gmail no está listo, no rompe nada.
create or replace function public.admin_enviar_aviso_mail(p_ids uuid[], p_asunto text, p_mensaje text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_sec text; v_mails text[];
begin
  if not public.es_admin_zarela() then raise exception 'no autorizado'; end if;
  select valor into v_url from public.config_interna where clave = 'n8n_aviso_url';
  select valor into v_sec from public.config_interna where clave = 'n8n_recargas_secreto';
  if v_url is null or v_url = '' then return; end if;
  select array_agg(email) into v_mails from auth.users where id = any(p_ids) and email is not null;
  begin
    perform net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(v_sec,'')),
      body := jsonb_build_object('mails', to_jsonb(coalesce(v_mails,'{}')), 'asunto', p_asunto, 'mensaje', p_mensaje));
  exception when others then null;
  end;
end $$;
grant execute on function public.admin_enviar_aviso_mail(uuid[], text, text) to authenticated;
-- Cuando tengas el webhook de n8n, pegá su URL así (una sola vez):
-- insert into public.config_interna(clave,valor) values ('n8n_aviso_url','https://n8n.almazarela.com/webhook/zarela-aviso') on conflict (clave) do update set valor=excluded.valor;
