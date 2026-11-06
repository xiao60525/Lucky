-- =====================================================================
-- 32-review.sql  确认收货 + 满意度评价
--   - orders 增加 received_at（确认收货时间）；状态仍是 paid，不引入新状态，
--     所有「已支付」判断不受影响，前端按 received_at 区分「已发货/已收货」
--   - 新表 reviews：一张订单里每个商品可评一次（唯一索引兜底），
--     hidden 由后台控制（隐藏违规评价，保留记录）
--   - 执行方式：mode=migrate 逐条执行；函数最后 notify pgrst, 'reload schema'
-- =====================================================================

alter table public.orders add column if not exists received_at timestamptz;

create table if not exists public.reviews (
  id text primary key,
  user_id text not null default '',
  order_id text not null default '',
  product_id text not null default '',
  rating int not null default 5,
  content text not null default '',
  hidden boolean not null default false,
  hidden_reason text not null default '',
  handler text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists reviews_product_idx on public.reviews (product_id, created_at desc);
create index if not exists reviews_user_idx on public.reviews (user_id, created_at desc);
create unique index if not exists reviews_order_product_key on public.reviews (order_id, product_id);

create or replace function public.app_update_order(p_secret text, p_order_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;

  update orders set
    status = coalesce(p_patch->>'status', status),
    channel = coalesce(p_patch->>'channel', channel),
    transaction_id = coalesce(p_patch->>'transaction_id', transaction_id),
    settle_source = coalesce(p_patch->>'settle_source', settle_source),
    paid_at = case when p_patch->>'paid_at' is not null then to_timestamp((p_patch->>'paid_at')::bigint / 1000.0) else paid_at end,
    refunded_at = case when p_patch->>'refunded_at' is not null then to_timestamp((p_patch->>'refunded_at')::bigint / 1000.0) else refunded_at end,
    closed_at = case when p_patch->>'closed_at' is not null then to_timestamp((p_patch->>'closed_at')::bigint / 1000.0) else closed_at end,
    ship_company = coalesce(p_patch->>'ship_company', ship_company),
    ship_no = coalesce(p_patch->>'ship_no', ship_no),
    shipped_at = case when p_patch->>'shipped_at' is not null then to_timestamp((p_patch->>'shipped_at')::bigint / 1000.0) else shipped_at end,
    received_at = case when p_patch->>'received_at' is not null then to_timestamp((p_patch->>'received_at')::bigint / 1000.0) else received_at end
  where id = p_order_id
  returning to_jsonb(orders.*) into v_row;

  return v_row;
end
$function$;

-- 用户提交评价：校验订单归属 / 已支付 / 评分区间 / 文本长度，重复评价返回 duplicated
create or replace function public.app_add_review(p_secret text, p_review jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; o record; uid text; pid text; rt int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_review->>'user_id', ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select id, user_id, status into o from orders where id = btrim(coalesce(p_review->>'order_id', ''));
  if o.id is null then raise exception 'order_not_found'; end if;
  if coalesce(o.user_id, '') <> uid then raise exception 'not_owner'; end if;
  if o.status <> 'paid' then raise exception 'order_not_paid'; end if;

  pid := btrim(coalesce(p_review->>'product_id', ''));
  if pid = '' then raise exception 'missing_product'; end if;

  rt := coalesce((p_review->>'rating')::int, 0);
  if rt < 1 or rt > 5 then raise exception 'bad_rating'; end if;

  select to_jsonb(r) into v from reviews r
   where r.order_id = o.id and r.product_id = pid limit 1;
  if v is not null then return v || jsonb_build_object('duplicated', true); end if;

  insert into reviews (id, user_id, order_id, product_id, rating, content)
  values (
    'rv_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18),
    uid, o.id, pid, rt,
    left(btrim(coalesce(p_review->>'content', '')), 500)
  )
  returning to_jsonb(reviews.*) into v;
  return v;
end
$function$;

-- 某商品的可见评价（带脱敏昵称：优先 nickname，否则手机号前3+****）
create or replace function public.app_list_reviews(p_secret text, p_product_id text, p_limit integer default 10, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orderId', r.order_id, 'productId', r.product_id,
      'rating', r.rating, 'content', r.content, 'createdAt', r.created_at,
      'nickname', case
        when coalesce(u.nickname, '') <> '' then left(u.nickname, 16)
        when coalesce(u.phone, '') <> '' then left(u.phone, 3) || '****' || right(u.phone, 4)
        else '匿名用户' end
    ) order by r.created_at desc), '[]'::jsonb)
    into v
  from (
    select * from reviews
     where product_id = btrim(coalesce(p_product_id, '')) and not hidden
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     offset greatest(0, coalesce(p_offset, 0))
  ) r
  left join app_users u on u.id = r.user_id;
  return v;
end
$function$;

-- 全站评分统计（商品页星级 + 评价数）：只统计未隐藏评价
create or replace function public.app_reviews_stats(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'productId', t.product_id, 'avg', t.avg, 'count', t.cnt
    ) order by t.cnt desc), '[]'::jsonb)
    into v
  from (
    select product_id, round(avg(rating)::numeric, 1)::float8 as avg, count(*)::int as cnt
      from reviews where not hidden group by product_id
  ) t;
  return v;
end
$function$;

-- 我的评价（含被隐藏的，用户可以看到自己的状态）
create or replace function public.app_my_reviews(p_secret text, p_user text, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orderId', r.order_id, 'productId', r.product_id,
      'rating', r.rating, 'content', r.content, 'hidden', r.hidden,
      'hiddenReason', r.hidden_reason, 'createdAt', r.created_at,
      'orderTitle', coalesce(o.title, '')
    ) order by r.created_at desc), '[]'::jsonb)
    into v
  from (
    select * from reviews
     where user_id = btrim(coalesce(p_user, ''))
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) r
  left join orders o on o.id = r.order_id;
  return v;
end
$function$;

-- 后台：全部评价（带买家昵称/手机号、商品标题）
create or replace function public.app_admin_review_list(p_secret text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orderId', r.order_id, 'userId', r.user_id, 'productId', r.product_id,
      'rating', r.rating, 'content', r.content, 'hidden', r.hidden,
      'hiddenReason', r.hidden_reason, 'handler', r.handler,
      'createdAt', r.created_at,
      'orderTitle', coalesce(o.title, ''),
      'productTitle', coalesce(p.title, ''),
      'nickname', coalesce(u.nickname, ''), 'phone', coalesce(u.phone, '')
    ) order by r.created_at desc), '[]'::jsonb)
    into v
  from (
    select * from reviews order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) r
  left join orders o on o.id = r.order_id
  left join products p on p.id = r.product_id
  left join app_users u on u.id = r.user_id;
  return v;
end
$function$;

-- 后台：隐藏 / 恢复评价（隐藏保留记录，违规内容不再对外展示）
create or replace function public.app_admin_review_hide(p_secret text, p_id text, p_hidden boolean, p_reason text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  update reviews
     set hidden = coalesce(p_hidden, hidden),
         hidden_reason = left(btrim(coalesce(p_reason, '')), 200),
         handler = left(btrim(coalesce(p_actor, '')), 40)
   where id = btrim(coalesce(p_id, ''))
  returning to_jsonb(reviews.*) into v;
  return v;
end
$function$;

grant execute on function public.app_add_review(text, jsonb),
  public.app_list_reviews(text, text, integer, integer),
  public.app_reviews_stats(text),
  public.app_my_reviews(text, text, integer),
  public.app_admin_review_list(text, integer),
  public.app_admin_review_hide(text, text, boolean, text, text),
  public.app_update_order(text, text, jsonb)
  to anon, authenticated;

notify pgrst, 'reload schema';
