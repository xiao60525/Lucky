-- 39: 私聊多媒体（图片 / 商品卡片 / 转账）+ 清空聊天记录
-- exec_sql 只支持单语句，本文件按语句逐条执行（顺序不可变）

-- 1. 消息类型与载荷
alter table public.dm_messages add column if not exists kind text not null default 'text';
alter table public.dm_messages add column if not exists payload jsonb;

-- 2. 每方各自的「清空时间点」，只影响自己
alter table public.dm_threads add column if not exists cleared_a timestamptz;
alter table public.dm_threads add column if not exists cleared_b timestamptz;

-- 3. 重写发消息：支持 kind / payload（旧 4 参调用仍然兼容）
drop function if exists public.app_dm_send(text, text, text, text);

create or replace function public.app_dm_send(
  p_secret text,
  p_from text,
  p_to text,
  p_body text,
  p_kind text default 'text',
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  fu text;
  tu text;
  txt text;
  kd text;
  pv jsonb;
  preview text;
  tk text;
  a text;
  b text;
  v_msg jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  fu := btrim(coalesce(p_from, ''));
  tu := btrim(coalesce(p_to, ''));
  if fu = '' then raise exception 'missing_user'; end if;
  if tu = '' or tu = fu then raise exception 'bad_target'; end if;
  if not exists (select 1 from friend_links where user_id = fu and friend_id = tu) then
    raise exception 'not_friends';
  end if;

  kd := lower(btrim(coalesce(p_kind, 'text')));
  if kd not in ('text', 'image', 'product', 'transfer') then
    raise exception 'bad_kind';
  end if;

  txt := left(coalesce(p_body, ''), 1000);
  pv := p_payload;

  if kd = 'text' then
    txt := btrim(txt);
    if txt = '' then raise exception 'empty_message'; end if;
    preview := left(txt, 60);
  elsif kd = 'image' then
    if pv is null or coalesce(btrim(pv->>'dataUrl'), '') = '' then
      raise exception 'empty_image';
    end if;
    txt := '';
    preview := '[图片]';
  elsif kd = 'product' then
    txt := coalesce(pv->>'title', '');
    if txt = '' then raise exception 'bad_product'; end if;
    preview := '[商品] ' || left(txt, 40);
  else
    txt := '';
    preview := '[转账]';
  end if;

  a := least(fu, tu);
  b := greatest(fu, tu);
  tk := a || '|' || b;

  insert into dm_messages (id, thread_key, from_user, to_user, body, kind, payload)
  values ('dm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18), tk, fu, tu, txt, kd, pv)
  returning to_jsonb(dm_messages.*) into v_msg;

  insert into dm_threads (thread_key, user_a, user_b, last_body, last_from, last_at, unread_a, unread_b)
  values (tk, a, b, preview, fu, now(),
          case when fu = a then 0 else 1 end,
          case when fu = b then 0 else 1 end)
  on conflict (thread_key) do update set
    last_body = preview,
    last_from = fu,
    last_at = now(),
    unread_a = dm_threads.unread_a + case when fu = dm_threads.user_a then 0 else 1 end,
    unread_b = dm_threads.unread_b + case when fu = dm_threads.user_b then 0 else 1 end;

  return jsonb_build_object('message', v_msg);
end
$function$;

-- 4. 读会话：支持 p_after 增量（只回新消息），并遵守各自的清空时间点
drop function if exists public.app_dm_thread(text, text, text);

create or replace function public.app_dm_thread(
  p_secret text,
  p_user text,
  p_other text,
  p_after timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  oid text;
  tk text;
  a text;
  b text;
  cut timestamptz;
  v_msgs jsonb;
  v_friend jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  oid := btrim(coalesce(p_other, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  if oid = '' or oid = uid then raise exception 'bad_target'; end if;
  if not exists (select 1 from friend_links where user_id = uid and friend_id = oid) then
    raise exception 'not_friends';
  end if;

  a := least(uid, oid);
  b := greatest(uid, oid);
  tk := a || '|' || b;

  update dm_threads set
    unread_a = case when user_a = uid then 0 else unread_a end,
    unread_b = case when user_b = uid then 0 else unread_b end
  where thread_key = tk;

  select case when user_a = uid then cleared_a else cleared_b end into cut
  from dm_threads where thread_key = tk;
  cut := greatest(coalesce(cut, '-infinity'::timestamptz), coalesce(p_after, '-infinity'::timestamptz));

  select jsonb_build_object(
           'id', u.id,
           'nickname', coalesce(nullif(btrim(u.nickname), ''), '用户'),
           'avatar', u.avatar
         ) into v_friend
  from app_users u where u.id = oid;

  if p_after is null then
    -- 首次进入：取最近 200 条，再按时间正序返回
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_msgs
    from (
      select * from (
        select * from dm_messages
        where thread_key = tk and created_at > cut
        order by created_at desc
        limit 200
      ) recent
      order by created_at
    ) m;
  else
    -- 增量：只要比上次看到的新
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_msgs
    from (
      select * from dm_messages
      where thread_key = tk and created_at > cut
      order by created_at
      limit 200
    ) m;
  end if;

  return jsonb_build_object('friend', v_friend, 'messages', v_msgs, 'clearedAt', cut);
end
$function$;

-- 5. 清空聊天记录（只清自己这边）
create or replace function public.app_dm_clear(p_secret text, p_user text, p_other text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  oid text;
  tk text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  oid := btrim(coalesce(p_other, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  if oid = '' or oid = uid then raise exception 'bad_target'; end if;
  tk := least(uid, oid) || '|' || greatest(uid, oid);
  update dm_threads set
    cleared_a = case when user_a = uid then now() else cleared_a end,
    cleared_b = case when user_b = uid then now() else cleared_b end,
    unread_a = case when user_a = uid then 0 else unread_a end,
    unread_b = case when user_b = uid then 0 else unread_b end
  where thread_key = tk;
  return jsonb_build_object('ok', true);
end
$function$;

-- 6. 好友间转账（站内余额，单位分；原子扣款 + 入账 + 双方流水 + 聊天消息）
create or replace function public.app_dm_transfer(
  p_secret text,
  p_from text,
  p_to text,
  p_amount int,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  fu text;
  tu text;
  amt int;
  note text;
  tk text;
  a text;
  b text;
  bal int;
  preview text;
  pv jsonb;
  v_msg jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  fu := btrim(coalesce(p_from, ''));
  tu := btrim(coalesce(p_to, ''));
  if fu = '' then raise exception 'missing_user'; end if;
  if tu = '' or tu = fu then raise exception 'bad_target'; end if;
  if not exists (select 1 from friend_links where user_id = fu and friend_id = tu) then
    raise exception 'not_friends';
  end if;

  amt := coalesce(p_amount, 0);
  if amt < 1 then raise exception 'bad_amount'; end if;
  if amt > 500000 then raise exception 'amount_too_large'; end if;
  note := left(btrim(coalesce(p_note, '')), 60);

  update accounts set balance = balance - amt, updated_at = now()
   where id = fu and balance >= amt
   returning balance into bal;
  if bal is null then
    raise exception 'insufficient_balance';
  end if;

  insert into accounts (id, balance) values (tu, amt)
  on conflict (id) do update set balance = accounts.balance + amt, updated_at = now()
  returning balance into bal;

  insert into balance_logs (user_id, delta, kind, ref, balance_after)
  select fu, -amt, 'dm_out', coalesce(nullif(note, ''), '转给好友'), balance from accounts where id = fu;
  insert into balance_logs (user_id, delta, kind, ref, balance_after)
  select tu, amt, 'dm_in', coalesce(nullif(note, ''), '好友转入'), balance from accounts where id = tu;

  a := least(fu, tu);
  b := greatest(fu, tu);
  tk := a || '|' || b;
  preview := '[转账] ¥' || to_char(amt / 100.0, 'FM9999999990.00');
  pv := jsonb_build_object('amount', amt, 'note', note, 'status', 'done');

  insert into dm_messages (id, thread_key, from_user, to_user, body, kind, payload)
  values ('dm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18), tk, fu, tu, '', 'transfer', pv)
  returning to_jsonb(dm_messages.*) into v_msg;

  insert into dm_threads (thread_key, user_a, user_b, last_body, last_from, last_at, unread_a, unread_b)
  values (tk, a, b, preview, fu, now(),
          case when fu = a then 0 else 1 end,
          case when fu = b then 1 else 0 end)
  on conflict (thread_key) do update set
    last_body = preview,
    last_from = fu,
    last_at = now(),
    unread_a = dm_threads.unread_a + case when fu = dm_threads.user_a then 0 else 1 end,
    unread_b = dm_threads.unread_b + case when fu = dm_threads.user_b then 0 else 1 end;

  select balance into bal from accounts where id = fu;
  return jsonb_build_object('message', v_msg, 'balance', coalesce(bal, 0));
end
$function$;

-- 7. 授权
grant execute on function public.app_dm_send(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.app_dm_thread(text, text, text, timestamptz) to anon, authenticated;
grant execute on function public.app_dm_clear(text, text, text) to anon, authenticated;
grant execute on function public.app_dm_transfer(text, text, text, int, text) to anon, authenticated;

-- 8. 会话列表带「置顶所需」的最后消息时间已存在；补充按 thread_key 的增量索引
create index if not exists dm_messages_thread_created_idx on public.dm_messages (thread_key, created_at desc);
