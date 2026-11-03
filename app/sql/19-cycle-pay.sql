-- 支付宝周期扣款（免密自动续费）：
-- 1) app_users 增加协议号 + 协议状态（NORMAL=生效中 / UNSIGN=已解约 / ''=未签约）
-- 2) app_user_set_cycle 设置函数
-- 3) app_user_list 带上协议状态（后台展示）

alter table public.app_users add column if not exists cycle_agreement_no text not null default '';
alter table public.app_users add column if not exists cycle_status text not null default '';

CREATE OR REPLACE FUNCTION public.app_user_set_cycle(p_secret text, p_id text, p_agreement_no text, p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE app_users
     SET cycle_agreement_no = COALESCE(p_agreement_no, ''),
         cycle_status = COALESCE(p_status, ''),
         updated_at = now()
   WHERE id = p_id;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.app_user_list(p_secret text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT u.id, u.phone, u.nickname, u.points, u.created_at, u.last_login_at,
           u.member_level, u.member_expire, u.auto_renew, u.member_product_id,
           u.cycle_agreement_no, u.cycle_status,
           COALESCE(a.balance,0) AS balance,
           COALESCE((SELECT count(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'), 0) AS order_count
    FROM app_users u LEFT JOIN accounts a ON a.id = u.id
    ORDER BY u.created_at DESC) x), '[]'::jsonb);
END $function$;

grant execute on function public.app_user_set_cycle(text, text, text, text) to anon, authenticated;
