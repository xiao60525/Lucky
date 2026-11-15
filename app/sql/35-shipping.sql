-- 35-shipping.sql
-- 下单时快照用户「我的 → 收货地址」到订单（shipping jsonb），
-- 充值/内容解锁单 shipping 为 NULL；老订单无该字段按 NULL 处理。

alter table public.orders add column if not exists shipping jsonb;

-- 写入订单时一并保存收货信息快照（p_order 里没有 shipping 时落 NULL）
create or replace function public.app_insert_order_user(p_secret text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_row jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  insert into orders (id, product_id, title, amount, channel, status, user_id, created_at, items, shipping)
  values (
    p_order->>'id',
    p_order->>'product_id',
    p_order->>'title',
    (p_order->>'amount')::int,
    p_order->>'channel',
    coalesce(p_order->>'status', 'created'),
    nullif(p_order->>'user_id', ''),
    to_timestamp((p_order->>'created_at_ms')::bigint / 1000.0),
    coalesce(p_order->'items', '[]'::jsonb),
    p_order->'shipping'
  )
  returning to_jsonb(orders.*) into v_row;
  return v_row;
end
$function$;

notify pgrst, 'reload schema';
