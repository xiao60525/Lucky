CREATE OR REPLACE FUNCTION public.app_user_update(p_secret text, p_id text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE app_users u SET
    nickname = COALESCE(p_patch->>'nickname', u.nickname),
    address  = COALESCE(p_patch->'address', u.address),
    coupons  = COALESCE(p_patch->'coupons', u.coupons),
    avatar   = CASE WHEN p_patch ? 'avatar' THEN NULLIF(p_patch->>'avatar', '') ELSE u.avatar END,
    points   = GREATEST(0, u.points + COALESCE((p_patch->>'points_add')::int, 0)),
    updated_at = now()
  WHERE u.id = p_id
  RETURNING to_jsonb(u.*) - 'password_hash' INTO v;
  IF v IS NULL THEN RETURN NULL; END IF;
  UPDATE accounts SET nickname = v->>'nickname', updated_at = now() WHERE id = p_id;
  RETURN v;
END
$function$
