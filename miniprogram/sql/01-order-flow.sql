-- 小程序 v0.2：订单数量 / 备注 / 支付时间 + 下单·取消·演示支付三个函数
-- 应用：wbapp_yRpSbkLI5B3qYWUzX9iyG3

alter table public.orders add column if not exists qty integer not null default 1;
alter table public.orders add column if not exists remark text not null default '';
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists updated_at timestamptz not null default now();

-- 下单：金额以商品表为准，数量服务端校验，owner_id 取当前登录身份
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

  insert into orders (id, owner_id, product_id, title, amount, status, qty, remark)
  values (
    'O' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
    v_uid,
    btrim(p_product_id),
    left(v_title, 120),
    v_price * v_qty,
    'created',
    v_qty,
    left(btrim(coalesce(p_remark, '')), 200)
  )
  returning to_jsonb(orders.*) into v_row;

  return v_row;
end
$function$;

-- 取消订单：只能取消自己还没付款的单
create or replace function public.app_cancel_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_row jsonb;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  update orders
     set status = 'closed', updated_at = now()
   where id = btrim(coalesce(p_order_id, ''))
     and owner_id = v_uid
     and status = 'created'
  returning to_jsonb(orders.*) into v_row;

  if v_row is null then raise exception 'order_not_cancellable'; end if;
  return v_row;
end
$function$;

-- 演示支付：未接入微信支付前的占位，把待支付单标记为已支付（不发生任何真实扣款）
create or replace function public.app_demo_pay(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_row jsonb;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  update orders
     set status = 'paid', paid_at = now(), updated_at = now()
   where id = btrim(coalesce(p_order_id, ''))
     and owner_id = v_uid
     and status = 'created'
  returning to_jsonb(orders.*) into v_row;

  if v_row is null then raise exception 'order_not_payable'; end if;
  return v_row;
end
$function$;

grant execute on function public.app_place_order(text, integer, text) to anon, authenticated;
grant execute on function public.app_cancel_order(text) to anon, authenticated;
grant execute on function public.app_demo_pay(text) to anon, authenticated;

notify pgrst, 'reload schema';
