-- 会员流水：记录每一次开通 / 续费 / 赠送 / 取消 / 自动续费失败
create table if not exists public.member_logs (
  id bigserial primary key,
  user_id text not null,
  action text not null,            -- purchase / autorenew / grant / revoke / autorenew_fail
  source text not null default '', -- user / admin / system
  days int not null default 0,
  product_id text not null default '',
  order_id text not null default '',
  amount int not null default 0,   -- 本次扣款金额（分），赠送为 0
  note text not null default '',
  expire_after timestamptz,        -- 操作后的到期时间
  created_at timestamptz not null default now()
);
create index if not exists member_logs_user_idx on public.member_logs (user_id, created_at desc);
