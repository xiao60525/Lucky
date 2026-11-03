-- 后台取消会员：到期时间清空、等级清空
CREATE OR REPLACE FUNCTION public.app_user_revoke_member(p_secret text, p_id text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_expire timestamptz;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE app_users u SET
    member_level = '',
    member_expire = NULL,
    updated_at = now()
  WHERE u.id = p_id
  RETURNING u.member_expire INTO v_expire;
  RETURN v_expire;
END
$function$;
