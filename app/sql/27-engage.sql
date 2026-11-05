-- 27-engage.sql
-- 内容运营（阅读量 / 分类 / 收藏）+ 用户反馈闭环 + 后台操作日志
-- 全部通过 SECURITY DEFINER 函数暴露，客户端拿不到表写权限。

-- ============ 1. 内容：阅读量 + 分类 ============
alter table public.home_contents add column if not exists views int not null default 0;
alter table public.home_contents add column if not exists category text not null default '';

create index if not exists home_contents_category_idx on public.home_contents (category);

-- 内容保存：在 25 的基础上支持 category
CREATE OR REPLACE FUNCTION public.app_admin_upsert_content(p_secret text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO home_contents (id, title, description, tag, image, link, sort, active, members_only, price, category)
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
    GREATEST(COALESCE((p_content->>'price')::int, 0), 0),
    btrim(COALESCE(p_content->>'category', ''))
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
    category = EXCLUDED.category,
    updated_at = now()
  RETURNING to_jsonb(home_contents.*) INTO v;
  RETURN v;
END
$function$;

-- 阅读 +1（返回最新阅读数；幂等性交给前端按内容去重）
CREATE OR REPLACE FUNCTION public.app_content_view(p_secret text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v int;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE home_contents SET views = views + 1
   WHERE id = btrim(COALESCE(p_content, ''))
   RETURNING views INTO v;
  RETURN jsonb_build_object('views', COALESCE(v, 0));
END
$function$;

-- ============ 2. 内容收藏 ============
create table if not exists public.content_favorites (
  id text primary key,
  user_id text not null,
  content_id text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists content_favorites_user_content_key
  on public.content_favorites (user_id, content_id);
create index if not exists content_favorites_content_idx
  on public.content_favorites (content_id);

-- 收藏 / 取消收藏（一个按钮来回切，返回切换后的状态）
CREATE OR REPLACE FUNCTION public.app_content_fav_toggle(p_secret text, p_user text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int; v_fav boolean;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF COALESCE(btrim(p_user), '') = '' OR COALESCE(btrim(p_content), '') = '' THEN
    RAISE EXCEPTION 'missing_args';
  END IF;
  DELETE FROM content_favorites
   WHERE user_id = btrim(p_user) AND content_id = btrim(p_content);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    INSERT INTO content_favorites (id, user_id, content_id)
    VALUES ('cf_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18), btrim(p_user), btrim(p_content))
    ON CONFLICT (user_id, content_id) DO NOTHING;
    v_fav := true;
  ELSE
    v_fav := false;
  END IF;
  RETURN jsonb_build_object('favorited', v_fav);
END
$function$;

-- 某用户收藏的内容 id（按收藏时间倒序）
CREATE OR REPLACE FUNCTION public.app_content_favorites(p_secret text, p_user text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(f.content_id ORDER BY f.created_at DESC), '[]'::jsonb) INTO v
  FROM content_favorites f
  WHERE f.user_id = btrim(COALESCE(p_user, ''));
  RETURN v;
END
$function$;

-- 后台：每篇内容的收藏数 {content_id: n}
CREATE OR REPLACE FUNCTION public.app_admin_content_fav_counts(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_object_agg(s.content_id, s.n), '{}'::jsonb) INTO v
  FROM (SELECT content_id, count(*)::int AS n FROM content_favorites GROUP BY content_id) s;
  RETURN v;
END
$function$;

-- ============ 3. 用户反馈 ============
create table if not exists public.feedbacks (
  id text primary key,
  user_id text not null default '',
  content text not null default '',
  contact text not null default '',
  status text not null default 'pending',   -- pending / done
  reply text not null default '',
  created_at timestamptz not null default now(),
  replied_at timestamptz
);

create index if not exists feedbacks_status_idx on public.feedbacks (status, created_at desc);
create index if not exists feedbacks_user_idx on public.feedbacks (user_id, created_at desc);

CREATE OR REPLACE FUNCTION public.app_feedback_add(p_secret text, p_user text, p_content text, p_contact text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb; txt text;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  txt := btrim(COALESCE(p_content, ''));
  IF length(txt) < 2 THEN RAISE EXCEPTION 'content_too_short'; END IF;
  INSERT INTO feedbacks (id, user_id, content, contact)
  VALUES (
    'fb_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18),
    btrim(COALESCE(p_user, '')),
    left(txt, 1000),
    left(btrim(COALESCE(p_contact, '')), 60)
  )
  RETURNING to_jsonb(feedbacks.*) INTO v;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_feedback_mine(p_secret text, p_user text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb) INTO v
  FROM (SELECT * FROM feedbacks WHERE user_id = btrim(COALESCE(p_user, '')) ORDER BY created_at DESC LIMIT 50) f;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_feedback_list(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM feedbacks ORDER BY created_at DESC LIMIT 300
  ) f;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_feedback_reply(p_secret text, p_id text, p_reply text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE feedbacks
     SET reply = left(btrim(COALESCE(p_reply, '')), 1000),
         status = CASE WHEN btrim(COALESCE(p_reply, '')) = '' THEN 'pending' ELSE 'done' END,
         replied_at = CASE WHEN btrim(COALESCE(p_reply, '')) = '' THEN NULL ELSE now() END
   WHERE id = p_id
   RETURNING to_jsonb(feedbacks.*) INTO v;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_feedback_delete(p_secret text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM feedbacks WHERE id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('removed', n);
END
$function$;

-- ============ 4. 后台操作日志 ============
create table if not exists public.admin_logs (
  id text primary key,
  actor text not null default '',
  action text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists admin_logs_created_idx on public.admin_logs (created_at desc);

CREATE OR REPLACE FUNCTION public.app_admin_log_add(p_secret text, p_actor text, p_action text, p_detail text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO admin_logs (id, actor, action, detail)
  VALUES (
    'lg_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18),
    left(btrim(COALESCE(p_actor, '')), 40),
    left(btrim(COALESCE(p_action, '')), 40),
    left(btrim(COALESCE(p_detail, '')), 300)
  );
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_log_list(p_secret text, p_limit integer DEFAULT 150)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 150), 500))
  ) l;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_admin_log_clear(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n int;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM admin_logs WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('removed', n);
END
$function$;

grant execute on function public.app_admin_upsert_content(text, jsonb) to anon, authenticated;
grant execute on function public.app_content_view(text, text) to anon, authenticated;
grant execute on function public.app_content_fav_toggle(text, text, text) to anon, authenticated;
grant execute on function public.app_content_favorites(text, text) to anon, authenticated;
grant execute on function public.app_admin_content_fav_counts(text) to anon, authenticated;
grant execute on function public.app_feedback_add(text, text, text, text) to anon, authenticated;
grant execute on function public.app_feedback_mine(text, text) to anon, authenticated;
grant execute on function public.app_admin_feedback_list(text) to anon, authenticated;
grant execute on function public.app_admin_feedback_reply(text, text, text) to anon, authenticated;
grant execute on function public.app_admin_feedback_delete(text, text) to anon, authenticated;
grant execute on function public.app_admin_log_add(text, text, text, text) to anon, authenticated;
grant execute on function public.app_admin_log_list(text, integer) to anon, authenticated;
grant execute on function public.app_admin_log_clear(text) to anon, authenticated;

notify pgrst, 'reload schema';
