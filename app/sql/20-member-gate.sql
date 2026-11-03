-- 会员门禁：商品「会员专享 / 会员价」，内容「仅会员可见」
alter table public.products add column if not exists member_only boolean not null default false;
alter table public.products add column if not exists member_price int not null default 0;
alter table public.home_contents add column if not exists members_only boolean not null default false;

-- 商品保存：支持 memberOnly（会员才能买）/ memberPrice（会员价，分）
CREATE OR REPLACE FUNCTION public.app_admin_upsert_product(p_secret text, p_product jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_row jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO products (id, title, description, amount, tag, sort, active, member_days, member_only, member_price)
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
    GREATEST(COALESCE((p_product->>'memberPrice')::int, (p_product->>'member_price')::int, 0), 0)
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
    member_price = GREATEST(COALESCE((p_product->>'memberPrice')::int, (p_product->>'member_price')::int, products.member_price), 0)
  RETURNING to_jsonb(products.*) INTO v_row;
  RETURN v_row;
END
$function$;

-- 内容保存：支持 membersOnly（仅会员可见）
CREATE OR REPLACE FUNCTION public.app_admin_upsert_content(p_secret text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO home_contents (id, title, description, tag, image, link, sort, active, members_only)
  VALUES (
    p_content->>'id',
    COALESCE(p_content->>'title', ''),
    COALESCE(p_content->>'description', ''),
    COALESCE(p_content->>'tag', ''),
    NULLIF(p_content->>'image', ''),
    COALESCE(p_content->>'link', ''),
    COALESCE((p_content->>'sort')::int, 100),
    COALESCE((p_content->>'active')::boolean, true),
    COALESCE((p_content->>'membersOnly')::boolean, (p_content->>'members_only')::boolean, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    tag = EXCLUDED.tag,
    image = CASE WHEN p_content ? 'image' THEN EXCLUDED.image ELSE home_contents.image END,
    link = EXCLUDED.link,
    sort = EXCLUDED.sort,
    active = EXCLUDED.active,
    members_only = EXCLUDED.members_only,
    updated_at = now()
  RETURNING to_jsonb(home_contents.*) INTO v;
  RETURN v;
END
$function$;
