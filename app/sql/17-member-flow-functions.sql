-- 17: 重写 app_user_grant_member：支持记录续费来源商品；返回到期时间
CREATE OR REPLACE FUNCTION public.app_user_grant_member(p_secret text, p_id text, p_days int, p_product_id text default '')
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE v_expire timestamptz; BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN (SELECT u.member_expire FROM app_users u WHERE u.id = p_id);
  END IF;
  UPDATE app_users u SET
    member_level = 'member',
    member_expire = GREATEST(now(), COALESCE(u.member_expire, now())) + make_interval(days => p_days),
    member_product_id = COALESCE(NULLIF(p_product_id, ''), u.member_product_id, ''),
    updated_at = now()
  WHERE u.id = p_id
  RETURNING u.member_expire INTO v_expire;
  RETURN v_expire;
END $function$;

-- 18: 开关自动续费
CREATE OR REPLACE FUNCTION public.app_user_set_autorenew(p_secret text, p_id text, p_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE app_users SET auto_renew = COALESCE(p_on, false), updated_at = now() WHERE id = p_id;
  RETURN COALESCE(p_on, false);
END $function$;

-- 19: 写会员流水
CREATE OR REPLACE FUNCTION public.app_member_log_add(p_secret text, p_log jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE v_id bigint; BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO member_logs (user_id, action, source, days, product_id, order_id, amount, note, expire_after)
  VALUES (p_log->>'userId', COALESCE(p_log->>'action',''), COALESCE(p_log->>'source',''),
          COALESCE((p_log->>'days')::int, 0), COALESCE(p_log->>'productId',''),
          COALESCE(p_log->>'orderId',''), COALESCE((p_log->>'amount')::int, 0),
          COALESCE(p_log->>'note',''), NULLIF(p_log->>'expireAfter','')::timestamptz)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- 20: 读会员流水（可按用户过滤，默认最近 200 条）
CREATE OR REPLACE FUNCTION public.app_member_log_list(p_secret text, p_user_id text default '', p_limit int default 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE v jsonb; BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC, l.id DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM member_logs
    WHERE (p_user_id IS NULL OR p_user_id = '' OR user_id = p_user_id)
    ORDER BY created_at DESC, id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  ) l;
  RETURN v;
END $function$;

-- 21: app_user_list 带上 auto_renew
CREATE OR REPLACE FUNCTION public.app_user_list(p_secret text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT u.id, u.phone, u.nickname, u.points, u.created_at, u.last_login_at,
           u.member_level, u.member_expire, u.auto_renew, u.member_product_id,
           COALESCE(a.balance,0) AS balance,
           COALESCE((SELECT count(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'), 0) AS order_count
    FROM app_users u LEFT JOIN accounts a ON a.id = u.id
    ORDER BY u.created_at DESC) x), '[]'::jsonb);
END $function$;

-- 22: 授权
grant execute on function public.app_user_grant_member(text, text, int, text) to anon, authenticated;
grant execute on function public.app_user_set_autorenew(text, text, boolean) to anon, authenticated;
grant execute on function public.app_member_log_add(text, jsonb) to anon, authenticated;
grant execute on function public.app_member_log_list(text, text, int) to anon, authenticated;
