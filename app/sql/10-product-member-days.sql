-- 会员功能：商品可配置「购买后送 N 天会员」，0 = 普通商品
alter table public.products add column if not exists member_days int not null default 0;
