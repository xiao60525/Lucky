-- 23: 余额流水表
create table if not exists public.balance_logs (
  id bigserial primary key,
  user_id text not null,
  delta int not null,              -- 正=入账（充值/退款），负=支出（支付/自动续费）
  kind text not null default '',   -- recharge / pay / refund / autorenew / admin
  ref text not null default '',    -- 关联订单号或备注
  balance_after int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists balance_logs_user_idx on public.balance_logs (user_id, created_at desc);

-- 24: 重写 app_user_balance_add：加减余额并写流水（新参数可省略，旧调用兼容）
CREATE OR REPLACE FUNCTION public.app_user_balance_add(p_secret text, p_id text, p_delta int, p_kind text default '', p_ref text default '')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE v_balance int; BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE accounts SET balance = balance + p_delta, updated_at = now()
  WHERE id = p_id
  RETURNING balance INTO v_balance;
  IF v_balance IS NULL THEN
    INSERT INTO accounts (id, balance) VALUES (p_id, p_delta) RETURNING balance INTO v_balance;
  END IF;
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;
  INSERT INTO balance_logs (user_id, delta, kind, ref, balance_after)
  VALUES (p_id, p_delta, COALESCE(p_kind, ''), COALESCE(p_ref, ''), v_balance);
  RETURN v_balance;
END $function$;

-- 25: 读余额流水
CREATE OR REPLACE FUNCTION public.app_balance_log_list(p_secret text, p_user_id text, p_limit int default 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE v jsonb; BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC, l.id DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM balance_logs
    WHERE user_id = p_user_id
    ORDER BY created_at DESC, id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
  ) l;
  RETURN v;
END $function$;

-- 26: 授权
grant execute on function public.app_balance_log_list(text, text, int) to anon, authenticated;
