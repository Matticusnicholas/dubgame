import type { ClipRow, PlayerRow, SubmissionRow, VoteRow } from "./game-state";

export interface RoundWinner {
  round: number;
  submission: SubmissionRow;
  player: PlayerRow | null;
  clip: ClipRow;
  voteCount: number;
}

/**
 * For each round, return the highest-voted submission. Rounds with zero votes
 * are skipped — they don't have a winner worth replaying. Ties broken by
 * submission id (deterministic) so the same game always replays the same way.
 */
export function computeWinnersPerRound(
  submissions: SubmissionRow[],
  votes: VoteRow[],
  players: PlayerRow[],
  clipsById: Map<string, ClipRow>,
  playedClipIds: string[],
): RoundWinner[] {
  const winners: RoundWinner[] = [];
  const playerById = new Map(players.map((p) => [p.id, p]));

  for (let round = 1; round <= playedClipIds.length; round++) {
    const clipId = playedClipIds[round - 1];
    if (!clipId) continue;
    const clip = clipsById.get(clipId);
    if (!clip) continue;

    const roundSubs = submissions.filter((s) => s.round === round);
    if (roundSubs.length === 0) continue;

    const tally = new Map<string, number>();
    for (const v of votes) {
      if (v.round !== round) continue;
      tally.set(v.voted_for_submission_id, (tally.get(v.voted_for_submission_id) ?? 0) + 1);
    }

    let best: SubmissionRow | null = null;
    let bestVotes = 0;
    for (const s of roundSubs) {
      const votesFor = tally.get(s.id) ?? 0;
      if (votesFor > bestVotes || (votesFor === bestVotes && best && s.id < best.id)) {
        best = s;
        bestVotes = votesFor;
      }
    }
    if (!best || bestVotes === 0) continue;

    winners.push({
      round,
      submission: best,
      player: playerById.get(best.player_id) ?? null,
      clip,
      voteCount: bestVotes,
    });
  }

  return winners;
}
