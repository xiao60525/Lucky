-- 26-admin-power.sql
-- 后台能力增强：用户封禁、订单延长支付、首页模块/主题/横幅/快捷入口配置
-- 说明：全部通过 SECURITY DEFINER 函数暴露，前端无法直接读写表。

-- 1. 用户封禁
alter table public.app_users add column if not exists banned boolean not null default false;
alter table public.app_users add column if not exists ban_reason text not null default '';

-- 2. 用户列表带出封禁状态
CREATE OR REPLACE FUNCTION public.app_user_list(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x)
    FROM (
      SELECT u.id, u.phone, u.nickname, u.points, u.created_at, u.last_login_at,
             u.member_level, u.member_expire, u.auto_renew, u.member_product_id,
             u.cycle_agreement_no, u.cycle_status, u.banned, u.ban_reason,
             COALESCE(a.balance, 0) AS balance,
             COALESCE((SELECT count(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'), 0) AS order_count
      FROM app_users u
      LEFT JOIN accounts a ON a.id = u.id
      ORDER BY u.created_at DESC
    ) x
  ), '[]'::jsonb);
END
$function$;

-- 3. 封禁 / 解封
CREATE OR REPLACE FUNCTION public.app_admin_user_ban(p_secret text, p_id text, p_banned boolean, p_reason text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE app_users
     SET banned = COALESCE(p_banned, false),
         ban_reason = CASE WHEN COALESCE(p_banned, false) THEN btrim(COALESCE(p_reason, '')) ELSE '' END,
         updated_at = now()
   WHERE id = p_id
   RETURNING jsonb_build_object('id', id, 'banned', banned, 'banReason', ban_reason) INTO v;
  RETURN v;
END
$function$;

-- 4. 订单延长支付：把创建时间推到 now()，让用户重新获得完整支付时限
CREATE OR REPLACE FUNCTION public.app_admin_order_extend(p_secret text, p_id text, p_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE orders
     SET created_at = now()
   WHERE id = p_id
     AND status IN ('created', 'pending')
   RETURNING to_jsonb(orders.*) INTO v;
  RETURN v;
END
$function$;

-- 5. 清理重复重载（PostgREST 会因同名多签名解析失败）
DROP FUNCTION IF EXISTS public.app_user_balance_add(text, text, integer);

grant execute on function public.app_user_list(text) to anon, authenticated;
grant execute on function public.app_admin_user_ban(text, text, boolean, text) to anon, authenticated;
grant execute on function public.app_admin_order_extend(text, text, integer) to anon, authenticated;
