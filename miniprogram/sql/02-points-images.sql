-- 小程序 v0.3：积分签到 + 商品图片字段
-- 应用：wbapp_yRpSbkLI5B3qYWUzX9iyG3
-- 设计：
--   · 积分以 points_ledger 流水为唯一事实来源，余额 = 流水求和
--   · checkins 主键 (user_id, day) 保证每天只能签一次
--   · day 用北京时间（Asia/Shanghai）计算，避免 UTC 凌晨八点才翻日
--   · 支付成功（演示支付）自动按 1 元 = 1 积分 返积分，幂等（同单只返一次）

alter table public.products add column if not exists image text;

create table if not exists public.points_ledger (
  id bigserial primary key,
  user_id text not null,
  points integer not null,
  kind text not null,
  ref text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists points_ledger_user_idx on public.points_ledger (user_id, created_at desc);
create index if not exists points_ledger_kind_ref_idx on public.points_ledger (kind, ref);

create table if not exists public.checkins (
  user_id text not null,
  day date not null,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.points_ledger enable row level security;
alter table public.checkins enable row level security;

-- 签到积分值，想调整改这一个常量即可
create or replace function public._checkin_points()
returns integer
language sql
set search_path to 'public', 'pg_temp'
as $function$ select 50 $function$;

-- 北京时间「今天」
create or replace function public._cn_today()
returns date
language sql
set search_path to 'public', 'pg_temp'
as $function$ select (now() at time zone 'Asia/Shanghai')::date $function$;

-- 签到状态：余额 / 今天是否已签 / 连续天数 / 今日可得积分
create or replace function public.app_checkin_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_balance integer;
  v_checked boolean;
  v_streak integer := 0;
  v_day date;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  select coalesce(sum(points), 0) into v_balance from points_ledger where user_id = v_uid;
  select exists (select 1 from checkins where user_id = v_uid and day = _cn_today()) into v_checked;

  -- 连续天数：从今天（未签则从昨天）往前数连续签到日
  v_day := case when v_checked then _cn_today() else _cn_today() - 1 end;
  while exists (select 1 from checkins where user_id = v_uid and day = v_day) loop
    v_streak := v_streak + 1;
    v_day := v_day - 1;
  end loop;

  return jsonb_build_object(
    'balance', v_balance,
    'checkedToday', v_checked,
    'streak', v_streak,
    'todayPoints', _checkin_points()
  );
end
$function$;

-- 每日签到：幂等，重复签当天抛 already_checked_in
create or replace function public.app_checkin()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_points integer := _checkin_points();
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  insert into checkins (user_id, day, points)
  values (v_uid, _cn_today(), v_points);
  -- (user_id, day) 主键冲突会直接抛错，无需手工判断

  insert into points_ledger (user_id, points, kind, ref, note)
  values (v_uid, v_points, 'checkin', _cn_today()::text, '每日签到');

  return app_checkin_status();
end
$function$;

-- 积分明细：最近 50 条流水
create or replace function public.app_points_history()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;
  return coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  from (
    select points, kind, ref, note, created_at
      from points_ledger
     where user_id = v_uid
     order by created_at desc, id desc
     limit 50
  ) l;
end
$function$;

-- 演示支付：标记已支付 + 按金额返积分（1 元 = 1 积分，同单幂等）
create or replace function public.app_demo_pay(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := auth.uid();
  v_row jsonb;
  v_points integer;
begin
  if v_uid is null or v_uid = '' then raise exception 'unauthorized'; end if;

  update orders
     set status = 'paid', paid_at = now(), updated_at = now()
   where id = btrim(coalesce(p_order_id, ''))
     and owner_id = v_uid
     and status = 'created'
  returning to_jsonb(orders.*) into v_row;

  if v_row is null then raise exception 'order_not_payable'; end if;

  -- 返积分：同订单只返一次（ledger kind+ref 幂等）
  if not exists (
    select 1 from points_ledger where kind = 'order' and ref = v_row->>'id'
  ) then
    v_points := greatest(1, (coalesce((v_row->>'amount')::bigint, 0) + 99) / 100);
    insert into points_ledger (user_id, points, kind, ref, note)
    values (v_uid, v_points, 'order', v_row->>'id', '订单返积分');
  end if;

  return v_row;
end
$function$;

grant execute on function public.app_checkin_status() to anon, authenticated;
grant execute on function public.app_checkin() to anon, authenticated;
grant execute on function public.app_points_history() to anon, authenticated;
grant execute on function public.app_demo_pay(text) to anon, authenticated;
