CREATE OR REPLACE FUNCTION public.app_admin_list_contents(p_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.sort, c.created_at), '[]'::jsonb) INTO v
  FROM home_contents c;
  RETURN v;
END
$function$
