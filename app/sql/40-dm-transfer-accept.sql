-- 40: 好友转账改为「需对方领取」
-- 旧逻辑：转账即扣款入账，不可撤销。
-- 新逻辑：发起时从付款方余额扣款冻结在转账单里（dm_transfers.status = pending），
--        收款方点「收款」才入账；收款方可「退还」，付款方可「撤销」；24 小时未领取自动退回。
-- 语句逐条执行（云库 exec_sql 只支持单条）。

-- ============ 1. 转账单 ============
create table if not exists public.dm_transfers (
  id text primary key,
  thread_key text not null,
  message_id text not null,                -- 对应 dm_messages.id，用于回写卡片状态
  from_user text not null,
  to_user text not null,
  amount int not null,                     -- 单位分
  note text not null default '',
  status text not null default 'pending',  -- pending / accepted / rejected / canceled / expired
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acted_at timestamptz
);

create index if not exists dm_transfers_to_idx on public.dm_transfers (to_user, status, created_at desc);
create index if not exists dm_transfers_from_idx on public.dm_transfers (from_user, status, created_at desc);
create index if not exists dm_transfers_message_idx on public.dm_transfers (message_id);

-- ============ 2. 过期扫描：超过 24 小时未领取，原路退回 ============
create or replace function public._dm_transfer_sweep(p_user text)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  t record;
  n int := 0;
begin
  for t in
    select * from dm_transfers
     where status = 'pending'
       and created_at < now() - interval '24 hours'
       and (from_user = p_user or to_user = p_user)
     for update
  loop
    update accounts set balance = balance + t.amount, updated_at = now() where id = t.from_user;
    insert into balance_logs (user_id, delta, kind, ref, balance_after)
    select t.from_user, t.amount, 'dm_refund', '转账超时未领取，已退回', balance
      from accounts where id = t.from_user;

    update dm_transfers set status = 'expired', updated_at = now(), acted_at = now() where id = t.id;
    update dm_messages
       set payload = coalesce(payload, '{}'::jsonb)
         || jsonb_build_object('status', 'expired', 'actedAt', (extract(epoch from now()) * 1000)::bigint)
     where id = t.message_id;
    n := n + 1;
  end loop;
  return n;
end
$function$;

-- ============ 3. 发起转账：扣款冻结 + 生成待领取转账单 ============
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
  tid text;
  mid text;
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

  -- 付款方先扣款（钱暂存在转账单里，收款方领取后才入账）
  update accounts set balance = balance - amt, updated_at = now()
   where id = fu and balance >= amt
   returning balance into bal;
  if bal is null then
    raise exception 'insufficient_balance';
  end if;

  insert into balance_logs (user_id, delta, kind, ref, balance_after)
  select fu, -amt, 'dm_out', coalesce(nullif(note, ''), '转给好友（待领取）'), balance
    from accounts where id = fu;

  tid := 'tr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18);
  mid := 'dm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18);
  a := least(fu, tu);
  b := greatest(fu, tu);
  tk := a || '|' || b;
  preview := '[转账] ¥' || to_char(amt / 100.0, 'FM9999999990.00') || ' 待领取';
  pv := jsonb_build_object('tid', tid, 'amount', amt, 'note', note, 'status', 'pending');

  insert into dm_transfers (id, thread_key, message_id, from_user, to_user, amount, note, status)
  values (tid, tk, mid, fu, tu, amt, note, 'pending');

  insert into dm_messages (id, thread_key, from_user, to_user, body, kind, payload)
  values (mid, tk, fu, tu, '', 'transfer', pv)
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

  return jsonb_build_object(
    'message', v_msg,
    'transfer', jsonb_build_object(
      'id', tid, 'status', 'pending', 'amount', amt, 'note', note,
      'fromUser', fu, 'toUser', tu, 'messageId', mid
    ),
    'balance', coalesce(bal, 0)
  );
end
$function$;

-- ============ 4. 收款 / 退还 / 撤销 ============
create or replace function public.app_dm_transfer_act(
  p_secret text,
  p_user text,
  p_tid text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  act text;
  t record;
  st text;
  bal int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  act := lower(btrim(coalesce(p_action, '')));
  if act not in ('accept', 'reject', 'cancel') then raise exception 'bad_action'; end if;

  select * into t from dm_transfers where id = btrim(coalesce(p_tid, '')) for update;
  if not found then raise exception 'transfer_missing'; end if;
  if t.status <> 'pending' then raise exception 'transfer_closed'; end if;

  if act = 'accept' or act = 'reject' then
    if t.to_user <> uid then raise exception 'not_allowed'; end if;
  else
    if t.from_user <> uid then raise exception 'not_allowed'; end if;
  end if;

  if act = 'accept' then
    insert into accounts (id, balance) values (t.to_user, t.amount)
    on conflict (id) do update set balance = accounts.balance + t.amount, updated_at = now();
    insert into balance_logs (user_id, delta, kind, ref, balance_after)
    select t.to_user, t.amount, 'dm_in', coalesce(nullif(t.note, ''), '好友转入'), balance
      from accounts where id = t.to_user;
    st := 'accepted';
  else
    update accounts set balance = balance + t.amount, updated_at = now() where id = t.from_user;
    insert into balance_logs (user_id, delta, kind, ref, balance_after)
    select t.from_user, t.amount, 'dm_refund',
           case when act = 'cancel' then '转账已撤销，金额退回' else '对方已退还转账' end,
           balance
      from accounts where id = t.from_user;
    st := case when act = 'cancel' then 'canceled' else 'rejected' end;
  end if;

  update dm_transfers set status = st, updated_at = now(), acted_at = now() where id = t.id;
  update dm_messages
     set payload = coalesce(payload, '{}'::jsonb)
       || jsonb_build_object('status', st, 'actedAt', (extract(epoch from now()) * 1000)::bigint)
   where id = t.message_id;

  select balance into bal from accounts where id = uid;
  return jsonb_build_object(
    'ok', true, 'status', st, 'tid', t.id, 'messageId', t.message_id,
    'balance', coalesce(bal, 0)
  );
end
$function$;

-- ============ 5. 我的待收款 / 我发出的待领取 ============
create or replace function public.app_dm_transfer_pending(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  v_in jsonb;
  v_out jsonb;
  c_in int;
  s_in int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  perform _dm_transfer_sweep(uid);

  select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb), count(*), coalesce(sum(amt), 0)
    into v_in, c_in, s_in
  from (
    select t.created_at as ts, t.amount as amt,
           jsonb_build_object(
             'id', t.id, 'direction', 'in', 'amount', t.amount, 'note', t.note,
             'status', t.status, 'createdAt', t.created_at,
             'fromUser', t.from_user, 'toUser', t.to_user, 'messageId', t.message_id,
             'nickname', coalesce(nullif(btrim(u.nickname), ''), '好友'),
             'avatar', u.avatar
           ) as x
      from dm_transfers t
      left join app_users u on u.id = t.from_user
     where t.to_user = uid and t.status = 'pending'
  ) s;

  select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_out
  from (
    select t.created_at as ts,
           jsonb_build_object(
             'id', t.id, 'direction', 'out', 'amount', t.amount, 'note', t.note,
             'status', t.status, 'createdAt', t.created_at,
             'fromUser', t.from_user, 'toUser', t.to_user, 'messageId', t.message_id,
             'nickname', coalesce(nullif(btrim(u.nickname), ''), '好友'),
             'avatar', u.avatar
           ) as x
      from dm_transfers t
      left join app_users u on u.id = t.to_user
     where t.from_user = uid and t.status = 'pending'
  ) s;

  return jsonb_build_object(
    'incoming', v_in,
    'outgoing', v_out,
    'incomingCount', coalesce(c_in, 0),
    'incomingAmount', coalesce(s_in, 0)
  );
end
$function$;

-- ============ 6. 未读数：附带待收款笔数 ============
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
  tin int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select coalesce(sum(case when user_a = uid then unread_a else unread_b end), 0) into n
  from dm_threads where user_a = uid or user_b = uid;

  select count(*) into pend from friend_requests where to_user = uid and status = 'pending';

  select count(*) into tin from dm_transfers where to_user = uid and status = 'pending';

  return jsonb_build_object(
    'unread', coalesce(n, 0),
    'pending', coalesce(pend, 0),
    'transferIn', coalesce(tin, 0)
  );
end
$function$;

-- ============ 7. 读会话：顺带返回转账卡片的最新状态（对面收款后这边能刷新） ============
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
  v_tr jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  oid := btrim(coalesce(p_other, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  if oid = '' or oid = uid then raise exception 'bad_target'; end if;
  if not exists (select 1 from friend_links where user_id = uid and friend_id = oid) then
    raise exception 'not_friends';
  end if;

  perform _dm_transfer_sweep(uid);

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
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_msgs
    from (
      select * from dm_messages
      where thread_key = tk and created_at > cut
      order by created_at
      limit 200
    ) m;
  end if;

  -- 转账卡片状态补丁：增量拉取时老消息不会重发，单独回一份最新状态
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'payload', m.payload) order by m.created_at), '[]'::jsonb)
    into v_tr
  from (
    select id, payload, created_at from dm_messages
     where thread_key = tk and kind = 'transfer' and created_at > cut
     order by created_at desc
     limit 50
  ) m;

  return jsonb_build_object(
    'friend', v_friend,
    'messages', v_msgs,
    'transfers', coalesce(v_tr, '[]'::jsonb),
    'clearedAt', cut
  );
end
$function$;

-- ============ 8. 授权 ============
grant execute on function public.app_dm_transfer(text, text, text, int, text) to anon, authenticated;
grant execute on function public.app_dm_transfer_act(text, text, text, text) to anon, authenticated;
grant execute on function public.app_dm_transfer_pending(text, text) to anon, authenticated;
grant execute on function public.app_dm_thread(text, text, text, timestamptz) to anon, authenticated;
grant execute on function public.app_dm_unread(text, text) to anon, authenticated;
