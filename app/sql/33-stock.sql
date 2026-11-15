-- 库存管理：stock 为空 = 不限量；有值时前端展示「仅剩 N 件 / 已售罄」，下单按已支付销量校验
alter table public.products add column if not exists stock integer;

-- 商品保存：新增 stock（传 null/空串 = 不限量；不传该键 = 保持原值）
CREATE OR REPLACE FUNCTION public.app_admin_upsert_product(p_secret text, p_product jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_row jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO products (id, title, description, amount, tag, sort, active, member_days, member_only, member_price, image, stock)
  VALUES (
    p_product->>'id',
    COALESCE(p_product->>'title','未命名'),
    p_product->>'description',
    COALESCE((p_product->>'amount')::int, 1),
    COALESCE(p_product->>'tag',''),
    COALESCE((p_product->>'sort')::int, 99),
    COALESCE((p_product->>'active')::boolean, true),
    GREATEST(COALESCE((p_product->>'memberDays')::int, (p_product->>'member_days')::int, 0), 0),
    COALESCE((p_product->>'memberOnly')::boolean, (p_product->>'member_only')::boolean, false),
    GREATEST(COALESCE((p_product->>'memberPrice')::int, (p_product->>'member_price')::int, 0), 0),
    NULLIF(p_product->>'image', ''),
    NULLIF(p_product->>'stock', '')::int
  )
  ON CONFLICT (id) DO UPDATE SET
    title = COALESCE(p_product->>'title', products.title),
    description = COALESCE(p_product->>'description', products.description),
    amount = COALESCE((p_product->>'amount')::int, products.amount),
    tag = COALESCE(p_product->>'tag', products.tag),
    sort = COALESCE((p_product->>'sort')::int, products.sort),
    active = COALESCE((p_product->>'active')::boolean, products.active),
    member_days = GREATEST(COALESCE((p_product->>'memberDays')::int, (p_product->>'member_days')::int, products.member_days), 0),
    member_only = COALESCE((p_product->>'memberOnly')::boolean, (p_product->>'member_only')::boolean, products.member_only),
    member_price = GREATEST(COALESCE((p_product->>'memberPrice')::int, (p_product->>'member_price')::int, products.member_price), 0),
    image = CASE WHEN p_product ? 'image' THEN NULLIF(p_product->>'image', '') ELSE products.image END,
    stock = CASE WHEN p_product ? 'stock' THEN NULLIF(p_product->>'stock', '')::int ELSE products.stock END
  RETURNING to_jsonb(products.*) INTO v_row;
  RETURN v_row;
END
$function$;

-- 列表页快捷改库存（不算「不限量」以外的语义变化，只改 stock 一个字段）
CREATE OR REPLACE FUNCTION public.app_admin_set_stock(p_secret text, p_id text, p_stock integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_row jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_stock IS NOT NULL AND p_stock < 0 THEN RAISE EXCEPTION 'bad_stock'; END IF;
  UPDATE products SET stock = p_stock WHERE id = p_id RETURNING to_jsonb(products.*) INTO v_row;
  IF v_row IS NULL THEN RAISE EXCEPTION 'product_not_found'; END IF;
  RETURN v_row;
END
$function$;

grant execute on function public.app_admin_set_stock(text, text, integer) to anon, authenticated;
