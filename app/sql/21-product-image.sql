-- 商品配图：后台可上传商品图片（dataURL 存库），前端商品卡优先显示图片
alter table public.products add column if not exists image text;

-- 商品保存：新增 image（传空字符串 = 清空图片；不传该键 = 保持原图）
CREATE OR REPLACE FUNCTION public.app_admin_upsert_product(p_secret text, p_product jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_row jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO products (id, title, description, amount, tag, sort, active, member_days, member_only, member_price, image)
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
    NULLIF(p_product->>'image', '')
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
    image = CASE WHEN p_product ? 'image' THEN NULLIF(p_product->>'image', '') ELSE products.image END
  RETURNING to_jsonb(products.*) INTO v_row;
  RETURN v_row;
END
$function$;
