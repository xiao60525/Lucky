-- 后台用户列表：带会员等级与到期时间
CREATE OR REPLACE FUNCTION public.app_user_list(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x) FROM (
      SELECT u.id, u.phone, u.nickname, u.points, u.created_at, u.last_login_at,
             u.member_level, u.member_expire,
             COALESCE(a.balance,0) AS balance,
             COALESCE((SELECT count(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'), 0) AS order_count
      FROM app_users u
      LEFT JOIN accounts a ON a.id = u.id
      ORDER BY u.created_at DESC
    ) x
  ), '[]'::jsonb);
END
$function$;
