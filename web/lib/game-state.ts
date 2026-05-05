import { z } from "zod";

export const GAME_STATES = [
  "lobby",
  "playing",
  "submitting",
  "reveal",
  "voting",
  "scoreboard",
  "finished",
] as const;

export type GameState = (typeof GAME_STATES)[number];

export const PHRASE_MAX_LEN = 80;

export const GameRow = z.object({
  id: z.string().uuid(),
  code: z.string().length(5),
  host_token: z.string(),
  state: z.enum(GAME_STATES),
  current_round: z.number().int().nonnegative(),
  total_rounds: z.number().int().positive(),
  current_clip_id: z.string().nullable(),
  played_clip_ids: z.array(z.string()),
  created_at: z.string(),
});
export type GameRow = z.infer<typeof GameRow>;

export const PlayerRow = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid(),
  player_token: z.string(),
  nickname: z.string(),
  score: z.number().int(),
  joined_at: z.string(),
});
export type PlayerRow = z.infer<typeof PlayerRow>;

export const SubmissionRow = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid(),
  round: z.number().int().nonnegative(),
  player_id: z.string().uuid(),
  phrase: z.string(),
  voice: z.string().default("random"),
});
export type SubmissionRow = z.infer<typeof SubmissionRow>;

export const VoteRow = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid(),
  round: z.number().int().nonnegative(),
  voter_id: z.string().uuid(),
  voted_for_submission_id: z.string().uuid(),
});
export type VoteRow = z.infer<typeof VoteRow>;

export const ClipRow = z.object({
  id: z.string(),
  file_path: z.string(),
  duration_ms: z.number().int().positive(),
  mute_start_ms: z.number().int().nonnegative(),
  mute_end_ms: z.number().int().positive(),
});
export type ClipRow = z.infer<typeof ClipRow>;
