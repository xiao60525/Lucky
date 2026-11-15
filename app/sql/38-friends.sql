-- 38-friends.sql
-- 好友与用户间私聊（站内聊天窗口）
-- 全部通过 SECURITY DEFINER 函数读写，客户端拿不到表权限。
-- 每个语句单独执行（云库 exec_sql 只支持单条）。

-- ============ 1. 好友申请表 ============
create table if not exists public.friend_requests (
  id text primary key,
  from_user text not null,
  to_user text not null,
  status text not null default 'pending',   -- pending / accepted / rejected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同一个人对同一个人只允许有一条待处理申请（重复申请直接复用）
create unique index if not exists friend_requests_pending_key
  on public.friend_requests (from_user, to_user)
  where status = 'pending';

create index if not exists friend_requests_to_idx on public.friend_requests (to_user, status, created_at desc);
create index if not exists friend_requests_from_idx on public.friend_requests (from_user, status, created_at desc);

-- ============ 2. 好友关系表（双向各存一行） ============
create table if not exists public.friend_links (
  user_id text not null,
  friend_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create index if not exists friend_links_friend_idx on public.friend_links (friend_id);

-- ============ 3. 私聊会话表（一对好友一条） ============
create table if not exists public.dm_threads (
  thread_key text primary key,             -- least(a,b)||'|'||greatest(a,b)
  user_a text not null,
  user_b text not null,
  last_body text not null default '',
  last_from text not null default '',
  last_at timestamptz not null default now(),
  unread_a int not null default 0,         -- 发给 a、a 还没看的条数
  unread_b int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists dm_threads_last_idx on public.dm_threads (last_at desc);

-- ============ 4. 私聊消息表 ============
create table if not exists public.dm_messages (
  id text primary key,
  thread_key text not null,
  from_user text not null,
  to_user text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_thread_idx on public.dm_messages (thread_key, created_at);

-- ============ 5. 内部：建立双向好友关系 ============
create or replace function public._friend_link(p_secret text, p_a text, p_b text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  insert into friend_links (user_id, friend_id) values (p_a, p_b) on conflict do nothing;
  insert into friend_links (user_id, friend_id) values (p_b, p_a) on conflict do nothing;
end
$function$;

-- ============ 6. 搜人（手机号精确 / 昵称模糊） ============
create or replace function public.app_friend_search(p_secret text, p_user text, p_q text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  q text;
  v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  q := btrim(coalesce(p_q, ''));
  if length(q) < 1 then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', u.id,
      'nickname', coalesce(nullif(btrim(u.nickname), ''), '用户'),
      'avatar', u.avatar,
      'phoneMasked', case when length(coalesce(u.phone, '')) >= 7
                          then left(u.phone, 3) || '****' || right(u.phone, 2) else '' end,
      'relation', case
        when exists (select 1 from friend_links l where l.user_id = uid and l.friend_id = u.id) then 'friend'
        when exists (select 1 from friend_requests r
                     where r.status = 'pending' and r.from_user = uid and r.to_user = u.id) then 'pending_out'
        when exists (select 1 from friend_requests r
                     where r.status = 'pending' and r.from_user = u.id and r.to_user = uid) then 'pending_in'
        else 'none'
      end
    ) as x
    from app_users u
    where u.id <> uid
      and (u.phone = q or u.id = q or u.nickname ilike '%' || q || '%')
    order by (u.phone = q) desc, (u.nickname = q) desc, u.created_at desc
    limit 20
  ) s;
  return v;
end
$function$;

-- ============ 7. 发起加好友申请（对方已申请则直接互加） ============
create or replace function public.app_friend_request(p_secret text, p_from text, p_to text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  fu text;
  tu text;
  rid text;
  rev record;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  fu := btrim(coalesce(p_from, ''));
  tu := btrim(coalesce(p_to, ''));
  if fu = '' then raise exception 'missing_user'; end if;
  if tu = '' or tu = fu then raise exception 'bad_target'; end if;
  if not exists (select 1 from app_users where id = tu) then raise exception 'user_not_found'; end if;

  if exists (select 1 from friend_links where user_id = fu and friend_id = tu) then
    return jsonb_build_object('status', 'friend');
  end if;

  -- 对方已经发过申请：直接互相加为好友
  select * into rev from friend_requests r
   where r.status = 'pending' and r.from_user = tu and r.to_user = fu
   limit 1;
  if found then
    update friend_requests set status = 'accepted', updated_at = now() where id = rev.id;
    perform _friend_link(p_secret, fu, tu);
    return jsonb_build_object('status', 'accepted', 'requestId', rev.id);
  end if;

  -- 我已经申请过：复用原来那条
  select id into rid from friend_requests r
   where r.status = 'pending' and r.from_user = fu and r.to_user = tu
   limit 1;
  if rid is null then
    rid := 'fr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18);
    insert into friend_requests (id, from_user, to_user, status)
    values (rid, fu, tu, 'pending');
  end if;

  return jsonb_build_object('status', 'pending', 'requestId', rid);
end
$function$;

-- ============ 8. 我的好友申请（收到的 / 发出的） ============
create or replace function public.app_friend_requests(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  inc jsonb;
  outg jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'otherId', u.id,
           'nickname', coalesce(nullif(btrim(u.nickname), ''), '用户'),
           'avatar', u.avatar,
           'createdAt', r.created_at
         ) order by r.created_at desc), '[]'::jsonb) into inc
  from friend_requests r join app_users u on u.id = r.from_user
  where r.to_user = uid and r.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'otherId', u.id,
           'nickname', coalesce(nullif(btrim(u.nickname), ''), '用户'),
           'avatar', u.avatar,
           'createdAt', r.created_at
         ) order by r.created_at desc), '[]'::jsonb) into outg
  from friend_requests r join app_users u on u.id = r.to_user
  where r.from_user = uid and r.status = 'pending';

  return jsonb_build_object('incoming', inc, 'outgoing', outg);
end
$function$;

-- ============ 9. 同意 / 拒绝好友申请 ============
create or replace function public.app_friend_respond(p_secret text, p_user text, p_id text, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  rid text;
  r record;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  rid := btrim(coalesce(p_id, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select * into r from friend_requests where id = rid;
  if not found then raise exception 'request_not_found'; end if;
  if r.to_user <> uid then raise exception 'not_yours'; end if;
  if r.status <> 'pending' then raise exception 'already_handled'; end if;

  if coalesce(p_accept, false) then
    update friend_requests set status = 'accepted', updated_at = now() where id = rid;
    perform _friend_link(p_secret, uid, r.from_user);
    return jsonb_build_object('status', 'accepted', 'friendId', r.from_user);
  end if;

  update friend_requests set status = 'rejected', updated_at = now() where id = rid;
  return jsonb_build_object('status', 'rejected', 'friendId', r.from_user);
end
$function$;

-- ============ 10. 好友列表（带最后一条消息与未读） ============
create or replace function public.app_friend_list(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  v jsonb;
  n int;
  pend int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'nickname', coalesce(nullif(btrim(u.nickname), ''), '用户'),
           'avatar', u.avatar,
           'lastBody', coalesce(t.last_body, ''),
           'lastFrom', coalesce(t.last_from, ''),
           'lastAt', t.last_at,
           'unread', coalesce(case when t.user_a = uid then t.unread_a else t.unread_b end, 0),
           'friendSince', l.created_at
         ) order by coalesce(t.last_at, l.created_at) desc), '[]'::jsonb) into v
  from friend_links l
  join app_users u on u.id = l.friend_id
  left join dm_threads t
    on t.thread_key = least(uid, l.friend_id) || '|' || greatest(uid, l.friend_id)
  where l.user_id = uid;

  select coalesce(sum(case when t.user_a = uid then t.unread_a else t.unread_b end), 0) into n
  from dm_threads t where t.user_a = uid or t.user_b = uid;

  select count(*) into pend from friend_requests where to_user = uid and status = 'pending';

  return jsonb_build_object('friends', v, 'unread', coalesce(n, 0), 'pending', coalesce(pend, 0));
end
$function$;

-- ============ 11. 发私聊消息（必须是好友） ============
create or replace function public.app_dm_send(p_secret text, p_from text, p_to text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  fu text;
  tu text;
  txt text;
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
  txt := left(btrim(coalesce(p_body, '')), 1000);
  if txt = '' then raise exception 'empty_message'; end if;
  if not exists (select 1 from friend_links where user_id = fu and friend_id = tu) then
    raise exception 'not_friends';
  end if;

  a := least(fu, tu);
  b := greatest(fu, tu);
  tk := a || '|' || b;

  insert into dm_messages (id, thread_key, from_user, to_user, body)
  values ('dm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18), tk, fu, tu, txt)
  returning to_jsonb(dm_messages.*) into v_msg;

  insert into dm_threads (thread_key, user_a, user_b, last_body, last_from, last_at, unread_a, unread_b)
  values (tk, a, b, txt, fu, now(),
          case when fu = a then 0 else 1 end,
          case when fu = b then 0 else 1 end)
  on conflict (thread_key) do update set
    last_body = txt,
    last_from = fu,
    last_at = now(),
    unread_a = dm_threads.unread_a + case when fu = dm_threads.user_a then 0 else 1 end,
    unread_b = dm_threads.unread_b + case when fu = dm_threads.user_b then 0 else 1 end;

  return jsonb_build_object('message', v_msg);
end
$function$;

-- ============ 12. 读某个好友的对话（顺带清我的未读） ============
create or replace function public.app_dm_thread(p_secret text, p_user text, p_other text)
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
  v_msgs jsonb;
  v_friend jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  oid := btrim(coalesce(p_other, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  if oid = '' or oid = uid then raise exception 'bad_target'; end if;

  a := least(uid, oid);
  b := greatest(uid, oid);
  tk := a || '|' || b;

  if not exists (select 1 from friend_links where user_id = uid and friend_id = oid) then
    raise exception 'not_friends';
  end if;

  update dm_threads set
    unread_a = case when user_a = uid then 0 else unread_a end,
    unread_b = case when user_b = uid then 0 else unread_b end
  where thread_key = tk;

  select jsonb_build_object(
           'id', u.id,
           'nickname', coalesce(nullif(btrim(u.nickname), ''), '用户'),
           'avatar', u.avatar
         ) into v_friend
  from app_users u where u.id = oid;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_msgs
  from (
    select * from dm_messages where thread_key = tk order by created_at desc limit 200
  ) m;

  return jsonb_build_object('friend', v_friend, 'messages', v_msgs);
end
$function$;

-- ============ 13. 我的未读（私聊 + 好友申请） ============
create or replace function public.app_dm_unread(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  n int;
  pend int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select coalesce(sum(case when user_a = uid then unread_a else unread_b end), 0) into n
  from dm_threads where user_a = uid or user_b = uid;

  select count(*) into pend from friend_requests where to_user = uid and status = 'pending';

  return jsonb_build_object('unread', coalesce(n, 0), 'pending', coalesce(pend, 0));
end
$function$;

-- ============ 14. 删除好友（关系解除，聊天记录保留在库里） ============
create or replace function public.app_friend_remove(p_secret text, p_user text, p_other text)
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

  delete from friend_links where (user_id = uid and friend_id = oid) or (user_id = oid and friend_id = uid);
  delete from friend_requests
   where status = 'pending'
     and ((from_user = uid and to_user = oid) or (from_user = oid and to_user = uid));
  tk := least(uid, oid) || '|' || greatest(uid, oid);
  delete from dm_threads where thread_key = tk;

  return jsonb_build_object('ok', true);
end
$function$;

-- ============ 15. 授权（前端只通过这些函数访问） ============
grant execute on function public._friend_link(text, text, text) to anon, authenticated;
grant execute on function public.app_friend_search(text, text, text) to anon, authenticated;
grant execute on function public.app_friend_request(text, text, text) to anon, authenticated;
grant execute on function public.app_friend_requests(text, text) to anon, authenticated;
grant execute on function public.app_friend_respond(text, text, text, boolean) to anon, authenticated;
grant execute on function public.app_friend_list(text, text) to anon, authenticated;
grant execute on function public.app_dm_send(text, text, text, text) to anon, authenticated;
grant execute on function public.app_dm_thread(text, text, text) to anon, authenticated;
grant execute on function public.app_dm_unread(text, text) to anon, authenticated;
grant execute on function public.app_friend_remove(text, text, text) to anon, authenticated;
