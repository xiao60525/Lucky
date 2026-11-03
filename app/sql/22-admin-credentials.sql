-- 管理员账号密码：可在后台「系统设置」里自行修改，存库优先于 .env
create table if not exists public.admin_credentials (
  id smallint primary key default 1 check (id = 1),
  user_name text not null,
  pwd_hash text not null,
  pwd_salt text not null,
  updated_at timestamptz not null default now()
);

-- 读取当前管理员凭据（无记录 = 还没改过，回退 .env）
CREATE OR REPLACE FUNCTION public.app_admin_get_credentials(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT to_jsonb(c) INTO v FROM admin_credentials c WHERE c.id = 1;
  RETURN v;
END
$function$;

-- 写入管理员凭据（单行，覆盖式）
CREATE OR REPLACE FUNCTION public.app_admin_set_credentials(p_secret text, p_user text, p_hash text, p_salt text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF COALESCE(btrim(p_user), '') = '' THEN RAISE EXCEPTION 'user_required'; END IF;
  IF COALESCE(p_hash, '') = '' OR COALESCE(p_salt, '') = '' THEN RAISE EXCEPTION 'password_required'; END IF;
  INSERT INTO admin_credentials (id, user_name, pwd_hash, pwd_salt)
  VALUES (1, btrim(p_user), p_hash, p_salt)
  ON CONFLICT (id) DO UPDATE SET
    user_name = EXCLUDED.user_name,
    pwd_hash = EXCLUDED.pwd_hash,
    pwd_salt = EXCLUDED.pwd_salt,
    updated_at = now()
  RETURNING to_jsonb(admin_credentials.*) INTO v;
  RETURN v;
END
$function$;

grant execute on function public.app_admin_get_credentials(text) to anon, authenticated;
grant execute on function public.app_admin_set_credentials(text, text, text, text) to anon, authenticated;
