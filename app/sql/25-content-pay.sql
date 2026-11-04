-- 内容单篇付费（方案三：会员免费看全部，非会员可单篇解锁）
-- price = 单篇解锁价格（分），0 表示不单卖（只能靠会员看）

alter table public.home_contents add column if not exists price int not null default 0;

-- 解锁记录：一个用户对一篇内容只留一行，买过就永久可看
create table if not exists public.content_unlocks (
  id text primary key,
  user_id text not null,
  content_id text not null,
  order_id text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists content_unlocks_user_content_key
  on public.content_unlocks (user_id, content_id);
create index if not exists content_unlocks_content_idx
  on public.content_unlocks (content_id);

-- 内容保存：支持 price（分，0=不单卖）
CREATE OR REPLACE FUNCTION public.app_admin_upsert_content(p_secret text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO home_contents (id, title, description, tag, image, link, sort, active, members_only, price)
  VALUES (
    p_content->>'id',
    COALESCE(p_content->>'title', ''),
    COALESCE(p_content->>'description', ''),
    COALESCE(p_content->>'tag', ''),
    NULLIF(p_content->>'image', ''),
    COALESCE(p_content->>'link', ''),
    COALESCE((p_content->>'sort')::int, 100),
    COALESCE((p_content->>'active')::boolean, true),
    COALESCE((p_content->>'membersOnly')::boolean, (p_content->>'members_only')::boolean, false),
    GREATEST(COALESCE((p_content->>'price')::int, 0), 0)
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
    price = GREATEST(COALESCE((p_content->>'price')::int, home_contents.price), 0),
    updated_at = now()
  RETURNING to_jsonb(home_contents.*) INTO v;
  RETURN v;
END
$function$;

-- 某用户已解锁的内容 id 列表（前台渲染用）
CREATE OR REPLACE FUNCTION public.app_content_unlocks(p_secret text, p_user text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(u.content_id ORDER BY u.created_at), '[]'::jsonb) INTO v
  FROM content_unlocks u
  WHERE u.user_id = p_user;
  RETURN v;
END
$function$;

-- 写入解锁（幂等：重复回调/重复购买不报错，返回已有记录）
CREATE OR REPLACE FUNCTION public.app_content_unlock_add(p_secret text, p_user text, p_content text, p_order text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF COALESCE(btrim(p_user), '') = '' OR COALESCE(btrim(p_content), '') = '' THEN
    RAISE EXCEPTION 'missing_args';
  END IF;
  INSERT INTO content_unlocks (id, user_id, content_id, order_id)
  VALUES (
    'cu_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18),
    btrim(p_user),
    btrim(p_content),
    COALESCE(p_order, '')
  )
  ON CONFLICT (user_id, content_id) DO NOTHING;
  SELECT to_jsonb(u) INTO v FROM content_unlocks u
  WHERE u.user_id = btrim(p_user) AND u.content_id = btrim(p_content);
  RETURN v;
END
$function$;

-- 后台：每篇内容的解锁数 {content_id: n}
CREATE OR REPLACE FUNCTION public.app_admin_content_unlock_counts(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_object_agg(s.content_id, s.n), '{}'::jsonb) INTO v
  FROM (SELECT content_id, count(*)::int AS n FROM content_unlocks GROUP BY content_id) s;
  RETURN v;
END
$function$;

-- 退款后收回解锁（按订单号删，幂等）
CREATE OR REPLACE FUNCTION public.app_content_unlock_remove(p_secret text, p_order text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM content_unlocks WHERE order_id = btrim(COALESCE(p_order, ''));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('removed', n);
END
$function$;

grant execute on function public.app_admin_upsert_content(text, jsonb) to anon, authenticated;
grant execute on function public.app_content_unlocks(text, text) to anon, authenticated;
grant execute on function public.app_content_unlock_add(text, text, text, text) to anon, authenticated;
grant execute on function public.app_content_unlock_remove(text, text) to anon, authenticated;
grant execute on function public.app_admin_content_unlock_counts(text) to anon, authenticated;
