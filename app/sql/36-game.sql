-- 36-game.sql
-- 小游戏（合成大西瓜）排行榜：game_scores 每用户保留最高分，
-- 通过 SECURITY DEFINER 函数读写，客户端无表权限。
-- 昵称在下单时快照，输出时脱敏（首字符 + **）。

create table if not exists public.game_scores (
  id text primary key,
  user_id text not null,
  nickname text not null default '',
  score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists game_scores_user_key on public.game_scores (user_id);
create index if not exists game_scores_score_idx on public.game_scores (score desc);

-- 提交成绩：比历史最高分高才更新；返回个人最高分与当前名次
CREATE OR REPLACE FUNCTION public.app_game_score_submit(p_secret text, p_user text, p_score int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_best int; v_rank int;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF COALESCE(btrim(p_user), '') = '' THEN RAISE EXCEPTION 'missing_user'; END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 1000000 THEN RAISE EXCEPTION 'bad_score'; END IF;

  INSERT INTO game_scores (id, user_id, nickname, score)
  VALUES (
    'gs_' || substr(md5(random()::text || clock_timestamp()::text), 1, 18),
    btrim(p_user),
    COALESCE((SELECT u.nickname FROM app_users u WHERE u.id = btrim(p_user)), ''),
    GREATEST(p_score, 0)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    score = GREATEST(game_scores.score, EXCLUDED.score),
    -- 昵称改了也要跟上（空值不覆盖）
    nickname = COALESCE(NULLIF(EXCLUDED.nickname, ''), game_scores.nickname),
    updated_at = now();

  SELECT score INTO v_best FROM game_scores WHERE user_id = btrim(p_user);
  SELECT count(*) + 1 INTO v_rank FROM game_scores WHERE score > v_best;
  RETURN jsonb_build_object('best', v_best, 'rank', v_rank);
END
$function$;

-- 排行榜：前 N 名（昵称脱敏：首字符 + **）
CREATE OR REPLACE FUNCTION public.app_game_scores_top(p_secret text, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.score DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT left(nickname, 1) || '**' AS nickname, score, updated_at
    FROM game_scores
    ORDER BY score DESC, updated_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  ) r;
  RETURN v;
END
$function$;

GRANT EXECUTE ON FUNCTION
  public.app_game_score_submit(text, text, int),
  public.app_game_scores_top(text, int)
TO anon, authenticated;

notify pgrst, 'reload schema';
