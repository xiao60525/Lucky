-- 29-refund.sql
-- 退款 / 退货：用户在前端提交申请，后台审核通过后才真正退款
-- 一张订单同一时间只允许一条「待审核」申请；被拒后可重新申请（保留历史）

create table if not exists public.refund_requests (
  id text primary key,
  order_id text not null,
  user_id text not null default '',
  amount int not null default 0,
  reason text not null default '',
  detail text not null default '',
  status text not null default 'pending', -- pending / approved / rejected / cancelled
  admin_note text not null default '',
  handler text not null default '',
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

-- 同一订单同时只能有一条待审核申请（部分唯一索引）
create unique index if not exists refund_requests_pending_key
  on public.refund_requests (order_id) where status = 'pending';
create index if not exists refund_requests_status_idx on public.refund_requests (status, created_at desc);
create index if not exists refund_requests_user_idx on public.refund_requests (user_id, created_at desc);

-- 用户提交申请
create or replace function public.app_refund_apply(p_secret text, p_user text, p_order text, p_reason text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; o record; uid text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  select id, user_id, status, amount into o from orders where id = btrim(coalesce(p_order, ''));
  if o.id is null then raise exception 'order_not_found'; end if;
  if coalesce(o.user_id, '') <> uid then raise exception 'not_owner'; end if;
  if o.status = 'refunded' then raise exception 'already_refunded'; end if;
  if o.status <> 'paid' then raise exception 'order_not_paid'; end if;

  select to_jsonb(r) into v from refund_requests r
   where r.order_id = o.id and r.status = 'pending' limit 1;
  if v is not null then return v || jsonb_build_object('duplicated', true); end if;

  insert into refund_requests (id, order_id, user_id, amount, reason, detail)
  values (
    'rf_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18),
    o.id, uid, coalesce(o.amount, 0),
    left(btrim(coalesce(p_reason, '')), 40),
    left(btrim(coalesce(p_detail, '')), 300)
  )
  returning to_jsonb(refund_requests.*) into v;
  return v;
end
$function$;

-- 我的申请列表（带订单标题 / 渠道，方便前端展示）
create or replace function public.app_refund_mine(p_secret text, p_user text, p_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orderId', r.order_id, 'userId', r.user_id, 'amount', r.amount,
      'reason', r.reason, 'detail', r.detail, 'status', r.status,
      'adminNote', r.admin_note, 'createdAt', r.created_at, 'handledAt', r.handled_at,
      'orderTitle', coalesce(o.title, ''), 'channel', coalesce(o.channel, '')
    ) order by r.created_at desc), '[]'::jsonb)
    into v
  from (
    select * from refund_requests
     where user_id = btrim(coalesce(p_user, ''))
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) r
  left join orders o on o.id = r.order_id;
  return v;
end
$function$;

-- 用户撤销申请
create or replace function public.app_refund_cancel(p_secret text, p_user text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  update refund_requests
     set status = 'cancelled', handled_at = now(), admin_note = coalesce(nullif(admin_note, ''), '用户撤销')
   where id = p_id and user_id = btrim(coalesce(p_user, '')) and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n);
end
$function$;

-- 后台：全部申请（带买家昵称 / 手机号 / 订单状态）
create or replace function public.app_admin_refund_list(p_secret text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orderId', r.order_id, 'userId', r.user_id, 'amount', r.amount,
      'reason', r.reason, 'detail', r.detail, 'status', r.status,
      'adminNote', r.admin_note, 'handler', r.handler,
      'createdAt', r.created_at, 'handledAt', r.handled_at,
      'orderTitle', coalesce(o.title, ''), 'channel', coalesce(o.channel, ''),
      'orderStatus', coalesce(o.status, ''),
      'nickname', coalesce(u.nickname, ''), 'phone', coalesce(u.phone, '')
    ) order by r.created_at desc), '[]'::jsonb)
    into v
  from (
    select * from refund_requests order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) r
  left join orders o on o.id = r.order_id
  left join app_users u on u.id = r.user_id;
  return v;
end
$function$;

-- 后台：审核（approve / reject），只处理待审核的
create or replace function public.app_admin_refund_mark(p_secret text, p_id text, p_status text, p_note text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; st text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  st := lower(btrim(coalesce(p_status, '')));
  if st not in ('approved', 'rejected') then raise exception 'bad_status'; end if;
  update refund_requests
     set status = st,
         admin_note = left(btrim(coalesce(p_note, '')), 300),
         handler = left(btrim(coalesce(p_actor, '')), 40),
         handled_at = now()
   where id = p_id and status = 'pending'
   returning to_jsonb(refund_requests.*) into v;
  return v;
end
$function$;

grant execute on function public.app_refund_apply(text, text, text, text, text),
  public.app_refund_mine(text, text, integer),
  public.app_refund_cancel(text, text, text),
  public.app_admin_refund_list(text, integer),
  public.app_admin_refund_mark(text, text, text, text, text)
  to anon, authenticated;
