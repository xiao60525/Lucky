-- 会员自动续费：开关 + 记录续费用的商品
alter table public.app_users add column if not exists auto_renew boolean not null default false;
alter table public.app_users add column if not exists member_product_id text not null default '';
