-- 28-profile.sql
-- 用户资料：个性签名 + 手机号换绑（前端「编辑资料」用）
-- 依赖：app_users（phone 已有唯一索引 app_users_phone_key）、accounts（id, nickname, balance）

alter table public.app_users add column if not exists bio text not null default '';

-- 资料更新：nickname / bio / address / avatar / coupons / points_add
create or replace function public.app_user_update(p_secret text, p_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  update app_users u set
    nickname = coalesce(p_patch->>'nickname', u.nickname),
    bio = left(coalesce(nullif(btrim(p_patch->>'bio'), ''), u.bio), 40),
    address = coalesce(p_patch->'address', u.address),
    coupons = coalesce(p_patch->'coupons', u.coupons),
    avatar = coalesce(p_patch->>'avatar', u.avatar),
    points = greatest(0, u.points + coalesce((p_patch->>'points_add')::int, 0)),
    updated_at = now()
  where u.id = p_id
  returning to_jsonb(u.*) - 'password_hash' into v;
  if v is null then return null; end if;
  update accounts set nickname = v->>'nickname', updated_at = now() where id = p_id;
  return v;
end
$function$;

-- 手机号换绑：服务端已校验登录密码；这里只做格式 + 唯一性 + 落库
create or replace function public.app_user_phone_update(p_secret text, p_user text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; ph text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  ph := btrim(coalesce(p_phone, ''));
  if ph !~ '^1[3-9][0-9]{9}$' then raise exception 'bad_phone'; end if;
  if exists (select 1 from app_users where phone = ph and id <> p_user) then
    raise exception 'phone_taken';
  end if;
  update app_users set phone = ph, updated_at = now()
   where id = p_user
   returning to_jsonb(app_users.*) - 'password_hash' into v;
  return v;
end
$function$;

grant execute on function public.app_user_update(text, text, jsonb), public.app_user_phone_update(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
