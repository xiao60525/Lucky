-- 商品保存：支持 memberDays（购买后送会员天数）
CREATE OR REPLACE FUNCTION public.app_admin_upsert_product(p_secret text, p_product jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_row jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO products (id, title, description, amount, tag, sort, active, member_days)
  VALUES (
    p_product->>'id',
    COALESCE(p_product->>'title','未命名'),
    p_product->>'description',
    COALESCE((p_product->>'amount')::int, 1),
    COALESCE(p_product->>'tag',''),
    COALESCE((p_product->>'sort')::int, 99),
    COALESCE((p_product->>'active')::boolean, true),
    GREATEST(COALESCE((p_product->>'memberDays')::int, (p_product->>'member_days')::int, 0), 0)
  )
  ON CONFLICT (id) DO UPDATE SET
    title = COALESCE(p_product->>'title', products.title),
    description = COALESCE(p_product->>'description', products.description),
    amount = COALESCE((p_product->>'amount')::int, products.amount),
    tag = COALESCE(p_product->>'tag', products.tag),
    sort = COALESCE((p_product->>'sort')::int, products.sort),
    active = COALESCE((p_product->>'active')::boolean, products.active),
    member_days = GREATEST(COALESCE((p_product->>'memberDays')::int, (p_product->>'member_days')::int, products.member_days), 0)
  RETURNING to_jsonb(products.*) INTO v_row;
  RETURN v_row;
END
$function$;
