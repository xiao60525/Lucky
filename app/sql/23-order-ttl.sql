-- 未支付订单保留 30 分钟：超时直接从库里删除（默认 30，可用 ORDER_TTL_MINUTES 调整）
CREATE OR REPLACE FUNCTION public.app_purge_stale_orders(p_secret text, p_minutes int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE n int;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM orders o
  WHERE o.status IN ('created', 'pending')
    AND o.created_at < now() - make_interval(mins => GREATEST(COALESCE(p_minutes, 30), 1));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

grant execute on function public.app_purge_stale_orders(text, int) to anon, authenticated;
