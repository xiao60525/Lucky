-- =====================================================================
-- 31-ship.sql  物流发货：订单记录快递公司 / 运单号 / 发货时间
--   - 老订单 ship_company / ship_no 为空字符串，前端按「单件/购物车」原逻辑展示
--   - app_update_order 增加三个字段的更新能力（后台发货走 persistOrder -> updateOrder）
--   - 执行方式：mode=migrate 逐条执行；函数最后 notify pgrst, 'reload schema'
-- =====================================================================

alter table public.orders add column if not exists ship_company text not null default '';

alter table public.orders add column if not exists ship_no text not null default '';

alter table public.orders add column if not exists shipped_at timestamptz;

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
    shipped_at = case when p_patch->>'shipped_at' is not null then to_timestamp((p_patch->>'shipped_at')::bigint / 1000.0) else shipped_at end
  where id = p_order_id
  returning to_jsonb(orders.*) into v_row;

  return v_row;
end
$function$;

notify pgrst, 'reload schema';
