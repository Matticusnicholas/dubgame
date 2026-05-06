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
  // host_token is server-side-only after migration 0010; clients never see it.
  host_token: z.string().optional(),
  state: z.enum(GAME_STATES),
  current_round: z.number().int().nonnegative(),
  total_rounds: z.number().int().positive(),
  current_clip_id: z.string().nullable(),
  played_clip_ids: z.array(z.string()),
  created_at: z.string(),
  package: z.string().default("notld"),
  is_public: z.boolean().default(false),
  lobby_title: z.string().nullable().optional(),
  play_token: z.string().nullable().optional(),
  current_reveal_submission_id: z.string().nullable().optional(),
});
export type GameRow = z.infer<typeof GameRow>;

export const MessageRow = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid(),
  player_id: z.string().uuid().nullable(),
  nickname: z.string().nullable(),
  content: z.string(),
  created_at: z.string(),
});
export type MessageRow = z.infer<typeof MessageRow>;

export const MESSAGE_MAX_LEN = 280;

export const PACK_CATALOG = [
  { id: "notld", label: "Night of the Living Dead", description: "1968 zombie classic, public domain" },
  { id: "yt_audits", label: "First Amendment Audits", description: "Recent YouTube Shorts (auto-refreshed weekly)" },
  { id: "yt_fastfood", label: "Fast Food Drama", description: "Public meltdowns at the drive-thru, weekly fresh" },
  { id: "yt_roadrage", label: "Road Rage", description: "Dashcam meltdowns and parking lot beef, weekly fresh" },
] as const;
export type PackId = (typeof PACK_CATALOG)[number]["id"];

export const PlayerRow = z.object({
  id: z.string().uuid(),
  game_id: z.string().uuid(),
  // player_token is server-side-only after migration 0010; clients never see it.
  player_token: z.string().optional(),
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
  voice_url: z.string().nullable().optional(),
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

export const SubtitleSegment = z.object({
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  text: z.string(),
});
export type SubtitleSegment = z.infer<typeof SubtitleSegment>;

export const ClipRow = z.object({
  id: z.string(),
  file_path: z.string(),
  duration_ms: z.number().int().positive(),
  mute_start_ms: z.number().int().nonnegative(),
  mute_end_ms: z.number().int().positive(),
  subtitles: z.array(SubtitleSegment).default([]),
  package: z.string().default("notld"),
  youtube_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  channel_name: z.string().nullable().optional(),
  channel_url: z.string().nullable().optional(),
});
export type ClipRow = z.infer<typeof ClipRow>;
