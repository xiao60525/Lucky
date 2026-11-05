-- 30-cart.sql
-- 购物车：一笔订单可以有多件商品
-- 老订单 items 为空数组，前端按「单件商品」老逻辑展示，互不影响

alter table public.orders add column if not exists items jsonb not null default '[]'::jsonb;

-- 写入订单时一并保存明细（没有 items 时落空数组，兼容单件下单）
create or replace function public.app_insert_order_user(p_secret text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_row jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  insert into orders (id, product_id, title, amount, channel, status, user_id, created_at, items)
  values (
    p_order->>'id',
    p_order->>'product_id',
    p_order->>'title',
    (p_order->>'amount')::int,
    p_order->>'channel',
    coalesce(p_order->>'status', 'created'),
    nullif(p_order->>'user_id', ''),
    to_timestamp((p_order->>'created_at_ms')::bigint / 1000.0),
    coalesce(p_order->'items', '[]'::jsonb)
  )
  returning to_jsonb(orders.*) into v_row;
  return v_row;
end
$function$;

notify pgrst, 'reload schema';
