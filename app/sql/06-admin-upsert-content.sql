CREATE OR REPLACE FUNCTION public.app_admin_upsert_content(p_secret text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  INSERT INTO home_contents (id, title, description, tag, image, link, sort, active)
  VALUES (
    p_content->>'id',
    COALESCE(p_content->>'title', ''),
    COALESCE(p_content->>'description', ''),
    COALESCE(p_content->>'tag', ''),
    NULLIF(p_content->>'image', ''),
    COALESCE(p_content->>'link', ''),
    COALESCE((p_content->>'sort')::int, 100),
    COALESCE((p_content->>'active')::boolean, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    tag = EXCLUDED.tag,
    image = CASE WHEN p_content ? 'image' THEN EXCLUDED.image ELSE home_contents.image END,
    link = EXCLUDED.link,
    sort = EXCLUDED.sort,
    active = EXCLUDED.active,
    updated_at = now()
  RETURNING to_jsonb(home_contents.*) INTO v;
  RETURN v;
END
$function$
