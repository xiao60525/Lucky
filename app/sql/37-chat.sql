-- 37-chat.sql
-- 在线客服：用户与商家一对一聊天
-- 全部通过 SECURITY DEFINER 函数读写，客户端拿不到表权限。

-- ============ 1. 会话表（每个用户一条） ============
create table if not exists public.chat_threads (
  user_id text primary key,
  nickname text not null default '',
  last_body text not null default '',
  last_role text not null default '',
  last_at timestamptz not null default now(),
  user_unread int not null default 0,   -- 商家发来、用户还没看的条数
  admin_unread int not null default 0,  -- 用户发来、商家还没看的条数
  created_at timestamptz not null default now()
);

create index if not exists chat_threads_last_idx on public.chat_threads (last_at desc);
create index if not exists chat_threads_admin_unread_idx on public.chat_threads (admin_unread desc);

-- ============ 2. 消息表 ============
create table if not exists public.chat_messages (
  id text primary key,
  user_id text not null,
  role text not null default 'user',    -- user（用户） / admin（商家）
  body text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_idx on public.chat_messages (user_id, created_at);

-- ============ 3. 发消息（用户 / 商家共用） ============
create or replace function public.app_chat_send(p_secret text, p_user text, p_role text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_msg jsonb;
  uid text;
  r text;
  txt text;
  nick text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  r := case when lower(coalesce(p_role, '')) = 'admin' then 'admin' else 'user' end;
  txt := left(btrim(coalesce(p_body, '')), 1000);
  if txt = '' then raise exception 'empty_message'; end if;

  insert into chat_messages (id, user_id, role, body)
  values ('cm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18), uid, r, txt)
  returning to_jsonb(chat_messages.*) into v_msg;

  select coalesce(nickname, '') into nick from app_users where id = uid;

  insert into chat_threads (user_id, nickname, last_body, last_role, last_at, user_unread, admin_unread)
  values (
    uid,
    coalesce(nick, ''),
    txt,
    r,
    now(),
    case when r = 'admin' then 1 else 0 end,
    case when r = 'user' then 1 else 0 end
  )
  on conflict (user_id) do update set
    nickname = coalesce(nullif(coalesce(nick, ''), ''), chat_threads.nickname),
    last_body = txt,
    last_role = r,
    last_at = now(),
    user_unread = chat_threads.user_unread + case when r = 'admin' then 1 else 0 end,
    admin_unread = chat_threads.admin_unread + case when r = 'user' then 1 else 0 end;

  return jsonb_build_object('message', v_msg);
end
$function$;

-- ============ 4. 用户取会话（顺带清未读） ============
create or replace function public.app_chat_thread(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  v_thread jsonb;
  v_msgs jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  update chat_threads set user_unread = 0 where user_id = uid;

  select to_jsonb(t) into v_thread from chat_threads t where t.user_id = uid;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_msgs
  from (
    select * from chat_messages where user_id = uid order by created_at desc limit 200
  ) m;

  return jsonb_build_object('thread', v_thread, 'messages', v_msgs);
end
$function$;

-- ============ 5. 用户未读数（给首页红点用） ============
create or replace function public.app_chat_unread(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(user_unread, 0) into n from chat_threads where user_id = btrim(coalesce(p_user, ''));
  return jsonb_build_object('unread', coalesce(n, 0));
end
$function$;

-- ============ 6. 后台：会话列表 ============
create or replace function public.app_admin_chat_threads(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.last_at desc), '[]'::jsonb) into v
  from (select * from chat_threads order by last_at desc limit 200) t;
  return v;
end
$function$;

-- ============ 7. 后台：读某个用户的对话（顺带清后台未读） ============
create or replace function public.app_admin_chat_msgs(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  v_thread jsonb;
  v_msgs jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  update chat_threads set admin_unread = 0 where user_id = uid;

  select to_jsonb(t) into v_thread from chat_threads t where t.user_id = uid;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_msgs
  from (
    select * from chat_messages where user_id = uid order by created_at desc limit 200
  ) m;

  return jsonb_build_object('thread', v_thread, 'messages', v_msgs);
end
$function$;

-- ============ 8. 授权 ============
grant execute on function public.app_chat_send(text, text, text, text) to anon, authenticated;
grant execute on function public.app_chat_thread(text, text) to anon, authenticated;
grant execute on function public.app_chat_unread(text, text) to anon, authenticated;
grant execute on function public.app_admin_chat_threads(text) to anon, authenticated;
grant execute on function public.app_admin_chat_msgs(text, text) to anon, authenticated;
