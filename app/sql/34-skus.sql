-- 多规格（SKU）：一个商品可挂多个规格，各自独立价格与库存
-- 约定：sku.price = 0 表示「跟随商品价」；sku.stock 为 null 表示该规格不限量

create table if not exists public.product_skus (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  name text not null,
  price integer not null default 0,
  stock integer,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists product_skus_product_idx on public.product_skus (product_id, sort);

alter table public.product_skus enable row level security;

comment on table public.product_skus is '商品多规格：价格 0=跟随商品价，库存 null=不限量';

-- 整组覆盖某商品的规格（传空数组 = 清空，商品回到单规格模式）
CREATE OR REPLACE FUNCTION public.app_admin_set_skus(p_secret text, p_product_id text, p_skus jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id) THEN RAISE EXCEPTION 'product_not_found'; END IF;
  IF p_skus IS NOT NULL AND jsonb_typeof(p_skus) <> 'array' THEN RAISE EXCEPTION 'bad_skus'; END IF;

  DELETE FROM product_skus WHERE product_id = p_product_id;

  IF p_skus IS NOT NULL AND jsonb_array_length(p_skus) > 0 THEN
    IF jsonb_array_length(p_skus) > 30 THEN RAISE EXCEPTION 'too_many_skus'; END IF;
    INSERT INTO product_skus (id, product_id, name, price, stock, sort, active)
    SELECT
      COALESCE(NULLIF(s->>'id', ''), p_product_id || '_s' || rn::text),
      p_product_id,
      COALESCE(NULLIF(btrim(s->>'name'), ''), '规格' || rn::text),
      GREATEST(COALESCE(NULLIF(s->>'price', '')::int, 0), 0),
      CASE WHEN s->>'stock' IS NULL OR btrim(s->>'stock') = '' THEN NULL ELSE GREATEST((s->>'stock')::int, 0) END,
      COALESCE(NULLIF(s->>'sort', '')::int, rn::int),
      COALESCE((s->>'active')::boolean, true)
    FROM (
      SELECT s AS s, row_number() OVER () AS rn FROM jsonb_array_elements(p_skus) AS s
    ) t
    ON CONFLICT (id) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      name = EXCLUDED.name,
      price = EXCLUDED.price,
      stock = EXCLUDED.stock,
      sort = EXCLUDED.sort,
      active = EXCLUDED.active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(k) ORDER BY k.sort, k.id), '[]'::jsonb)
    INTO v_out
    FROM product_skus k WHERE k.product_id = p_product_id;
  RETURN v_out;
END
$function$;

grant execute on function public.app_admin_set_skus(text, text, jsonb) to anon, authenticated;

-- 商品列表（含未上架）+ 规格
CREATE OR REPLACE FUNCTION public.app_admin_list_products(p_secret text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(
           to_jsonb(p) || jsonb_build_object(
             'skus', COALESCE((
               SELECT jsonb_agg(to_jsonb(k) ORDER BY k.sort, k.id)
               FROM product_skus k
               WHERE k.product_id = p.id AND k.active
             ), '[]'::jsonb)
           )
         ORDER BY p.sort, p.id), '[]'::jsonb)
  FROM products p
$function$;

-- 前台状态：商品同样带上规格
CREATE OR REPLACE FUNCTION public.app_get_state(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN jsonb_build_object(
    'account', (SELECT to_jsonb(a) FROM accounts a ORDER BY a.id LIMIT 1),
    'orders', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC) FROM orders o), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(
               to_jsonb(p) || jsonb_build_object(
                 'skus', COALESCE((
                   SELECT jsonb_agg(to_jsonb(k) ORDER BY k.sort, k.id)
                   FROM product_skus k
                   WHERE k.product_id = p.id AND k.active
                 ), '[]'::jsonb)
               )
             ORDER BY p.sort, p.id)
      FROM products p WHERE p.active
    ), '[]'::jsonb)
  );
END
$function$;

-- 批量操作商品：上架/下架/改价/改库存/改排序/删除
-- p_action: active | inactive | amount_set | amount_delta | amount_percent | stock_set | sort_set | delete
CREATE OR REPLACE FUNCTION public.app_admin_batch_products(p_secret text, p_ids text[], p_action text, p_value integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_n integer := 0;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_ids IS NULL OR coalesce(array_length(p_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'no_ids'; END IF;
  IF coalesce(array_length(p_ids, 1), 0) > 500 THEN RAISE EXCEPTION 'too_many_ids'; END IF;

  IF p_action = 'active' THEN
    UPDATE products SET active = true WHERE id = ANY(p_ids);
  ELSIF p_action = 'inactive' THEN
    UPDATE products SET active = false WHERE id = ANY(p_ids);
  ELSIF p_action = 'amount_set' THEN
    IF p_value IS NULL THEN RAISE EXCEPTION 'bad_value'; END IF;
    UPDATE products SET amount = GREATEST(p_value, 1) WHERE id = ANY(p_ids);
  ELSIF p_action = 'amount_delta' THEN
    IF p_value IS NULL THEN RAISE EXCEPTION 'bad_value'; END IF;
    UPDATE products SET amount = GREATEST(amount + p_value, 1) WHERE id = ANY(p_ids);
    UPDATE product_skus SET price = GREATEST(price + p_value, 0)
      WHERE product_id = ANY(p_ids) AND price > 0;
  ELSIF p_action = 'amount_percent' THEN
    IF p_value IS NULL OR p_value <= -100 THEN RAISE EXCEPTION 'bad_value'; END IF;
    UPDATE products SET amount = GREATEST(round(amount * (100 + p_value) / 100.0)::int, 1) WHERE id = ANY(p_ids);
    UPDATE product_skus SET price = GREATEST(round(price * (100 + p_value) / 100.0)::int, 0)
      WHERE product_id = ANY(p_ids) AND price > 0;
  ELSIF p_action = 'stock_set' THEN
    UPDATE products SET stock = p_value WHERE id = ANY(p_ids);
  ELSIF p_action = 'sort_set' THEN
    IF p_value IS NULL THEN RAISE EXCEPTION 'bad_value'; END IF;
    UPDATE products SET sort = p_value WHERE id = ANY(p_ids);
  ELSIF p_action = 'delete' THEN
    DELETE FROM products WHERE id = ANY(p_ids);
  ELSE
    RAISE EXCEPTION 'bad_action';
  END IF;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('affected', v_n);
END
$function$;

grant execute on function public.app_admin_batch_products(text, text[], text, integer) to anon, authenticated;
