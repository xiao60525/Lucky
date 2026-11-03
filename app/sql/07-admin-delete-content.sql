CREATE OR REPLACE FUNCTION public.app_admin_delete_content(p_secret text, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM home_contents c WHERE c.id = p_id RETURNING to_jsonb(c.*) INTO v;
  RETURN v;
END
$function$
