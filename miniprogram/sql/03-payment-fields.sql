-- 小程序 v0.4：支付数据层准备（不包含任何支付调用）
-- 应用：wbapp_yRpSbkLI5B3qYWUzX9iyG3
--
-- 说明：WorkBuddy 的微信虚拟支付（xpay）在平台侧不存业务数据，
-- 购买记录、去重键、发货状态都要应用自己落库。这里的字段就是为
-- 「支付凭证配置完成 + 微信认证/备案通过」后接线准备的：
--   out_trade_no   支付单号（8-32 位，字母数字 _-|*@，不以 _ 开头），同单幂等复用
--   pay_channel    支付渠道：demo（演示）/ xpay（微信虚拟支付）
--   pay_env        0 正式 / 1 沙箱
--   xpay_status    微信侧 query_order 的 status：2 已支付 / 3 发货中 / 4 已发货
--   pay_attempts   发起支付的次数，用于排查反复失败

alter table public.orders add column if not exists out_trade_no text;
alter table public.orders add column if not exists pay_channel text not null default 'demo';
alter table public.orders add column if not exists pay_env integer;
alter table public.orders add column if not exists xpay_status integer;
alter table public.orders add column if not exists pay_attempts integer not null default 0;

create unique index if not exists orders_out_trade_no_idx
  on public.orders (out_trade_no)
  where out_trade_no is not null;

-- 支付单号生成：MP + 年月日 + 12 位十六进制，共 20 位，符合微信约束
create or replace function public._gen_trade_no()
returns text
language sql
set search_path to 'public', 'pg_temp'
as $function$
  select 'MP' || to_char(now() at time zone 'Asia/Shanghai', 'YYMMDD')
         || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12))
$function$;

-- 下单：在 v0.2 的基础上带上支付单号
create or replace function public.app_place_order(p_product_id text, p_qty integer, p_remark text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_qty integer := greatest(1, least(coalesce(p_qty, 1), 99));
  v_price integer;
  v_title text;
  v_row jsonb;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  select amount, title into v_price, v_title
    from products
   where id = btrim(coalesce(p_product_id, '')) and active;
  if v_title is null then raise exception 'product_not_found'; end if;

  insert into orders (id, owner_id, product_id, title, amount, status, qty, remark, out_trade_no)
  values (
    'O' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
    v_uid,
    btrim(p_product_id),
    left(v_title, 120),
    v_price * v_qty,
    'created',
    v_qty,
    left(btrim(coalesce(p_remark, '')), 200),
    _gen_trade_no()
  )
  returning to_jsonb(orders.*) into v_row;

  return v_row;
end
$function$;

-- 发起支付前拿支付参数：同一订单重复调用复用同一个支付单号，并累加尝试次数
create or replace function public.app_prepare_payment(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_row orders;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  select * into v_row
    from orders
   where id = btrim(coalesce(p_order_id, ''))
     and owner_id = v_uid;

  if v_row.id is null then raise exception 'order_not_found'; end if;
  if v_row.status <> 'created' then raise exception 'order_not_payable'; end if;

  if v_row.out_trade_no is null or v_row.out_trade_no = '' then
    update orders set out_trade_no = _gen_trade_no(), updated_at = now()
     where id = v_row.id
    returning * into v_row;
  end if;

  update orders set pay_attempts = pay_attempts + 1, updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'orderId', v_row.id,
    'outTradeNo', v_row.out_trade_no,
    'amount', v_row.amount,
    'productId', v_row.product_id,
    'title', v_row.title,
    'qty', v_row.qty,
    'attempts', v_row.pay_attempts
  );
end
$function$;

-- 支付成功后落库：校验支付单号一致，置为已支付并按金额返积分（同单幂等）
-- 注意：当前由小程序端在支付成功后调用；接入服务端回调校验后应改为仅回调侧可写。
create or replace function public.app_mark_paid_order(p_order_id text, p_out_trade_no text, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_row jsonb;
  v_amount bigint;
  v_points integer;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  update orders
     set status = 'paid',
         paid_at = now(),
         updated_at = now(),
         pay_channel = coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'xpay'),
         xpay_status = 2
   where id = btrim(coalesce(p_order_id, ''))
     and owner_id = v_uid
     and status = 'created'
     and out_trade_no = btrim(coalesce(p_out_trade_no, ''))
  returning to_jsonb(orders.*) into v_row;

  if v_row is null then raise exception 'order_not_payable'; end if;

  v_amount := coalesce((v_row->>'amount')::bigint, 0);
  if not exists (select 1 from points_ledger where kind = 'order' and ref = v_row->>'id') then
    v_points := greatest(1, (v_amount + 99) / 100);
    insert into points_ledger (user_id, points, kind, ref, note)
    values (v_uid, v_points, 'order', v_row->>'id', '订单返积分');
  end if;

  return v_row;
end
$function$;

grant execute on function public.app_place_order(text, integer, text) to anon, authenticated;
grant execute on function public.app_prepare_payment(text) to anon, authenticated;
grant execute on function public.app_mark_paid_order(text, text, text) to anon, authenticated;
