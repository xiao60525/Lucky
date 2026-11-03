-- 给用户开通/续费会员：从「当前时间与现有到期时间的较大者」起加 N 天，幂等安全
CREATE OR REPLACE FUNCTION public.app_user_grant_member(p_secret text, p_id text, p_days int)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_expire timestamptz;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN (SELECT u.member_expire FROM app_users u WHERE u.id = p_id);
  END IF;
  UPDATE app_users u SET
    member_level = 'member',
    member_expire = GREATEST(now(), COALESCE(u.member_expire, now())) + make_interval(days => p_days),
    updated_at = now()
  WHERE u.id = p_id
  RETURNING u.member_expire INTO v_expire;
  RETURN v_expire;
END
$function$;
