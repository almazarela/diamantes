-- v14: notificaciones push (llegan con la página cerrada)
create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs (user_id);
alter table public.push_subs enable row level security;   -- sin políticas: solo se usa por las funciones de abajo

create or replace function public.guardar_push(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.push_subs(user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.borrar_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;
grant execute on function public.guardar_push(text, text, text) to authenticated;
grant execute on function public.borrar_push(text) to authenticated;

-- Dirección de la función de Supabase que envía los push
insert into public.config_interna(clave, valor)
values ('push_url', 'https://egtuaihydqkmaqehgrnd.supabase.co/functions/v1/enviar-push')
on conflict (clave) do update set valor = excluded.valor;

-- Llama a la función (si algo falla, nunca rompe el mensaje ni la orden)
create or replace function public.push_enviar(p_cuerpo jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_sec text;
begin
  v_url := public.config_valor(array['push_url']); v_sec := public.config_valor(array['push_secreto']);
  if v_url is null or v_sec is null then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_sec), body := p_cuerpo);
exception when others then null;
end $$;

-- Mensaje nuevo en el chat: avisa a la otra persona
create or replace function public.push_tg_mensaje()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_txt text; v_nom text;
begin
  v_txt := coalesce(nullif(trim(new.content), ''), case when new.file_url is not null then '📎 Te envió un archivo' else 'Nuevo mensaje' end);
  if new.sender_id is not null and new.sender_id::text <> new.user_id::text then
    perform public.push_enviar(jsonb_build_object('user_ids', jsonb_build_array(new.user_id), 'titulo', 'Alma Zarela', 'cuerpo', left(v_txt, 140), 'tag', 'chat'));
  else
    select coalesce(nullif(trim(full_name), ''), 'Cliente') into v_nom from public.profiles where id = new.user_id;
    perform public.push_enviar(jsonb_build_object('para_admin', true, 'titulo', coalesce(v_nom, 'Cliente'), 'cuerpo', left(v_txt, 140), 'tag', 'chat-' || new.user_id));
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists push_mensaje_tg on public.messages;
create trigger push_mensaje_tg after insert on public.messages for each row execute function public.push_tg_mensaje();

-- Recarga acreditada: avisa al cliente
create or replace function public.push_tg_orden()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.estado = 'completada' and old.estado is distinct from 'completada' then
    perform public.push_enviar(jsonb_build_object('user_ids', jsonb_build_array(new.user_id), 'titulo', 'Zarela 💎', 'cuerpo', '¡Tu recarga de ' || new.diamantes || ' diamantes ya está acreditada!', 'tag', 'orden-' || new.id));
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists push_orden_tg on public.ordenes_recarga;
create trigger push_orden_tg after update of estado on public.ordenes_recarga for each row execute function public.push_tg_orden();
