import { NextResponse } from "next/server";
import { getAdminClient } from "./supabase-server";

export function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export function forbidden(message: string = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message: string = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

export async function getGameByCode(code: string) {
  const sb = getAdminClient();
  const { data, error } = await sb.from("games").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  return data;
}

export async function requireHost(code: string, hostToken: string) {
  const game = await getGameByCode(code);
  if (!game) return { game: null, error: notFound("Game not found") };
  if (game.host_token !== hostToken) return { game: null, error: forbidden("Not the host") };
  return { game, error: null };
}

export async function requirePlayer(code: string, playerToken: string) {
  const sb = getAdminClient();
  const game = await getGameByCode(code);
  if (!game) return { game: null, player: null, error: notFound("Game not found") };
  const { data: player, error } = await sb
    .from("players")
    .select("*")
    .eq("game_id", game.id)
    .eq("player_token", playerToken)
    .maybeSingle();
  if (error) throw error;
  if (!player) return { game, player: null, error: forbidden("Not a player in this game") };
  return { game, player, error: null };
}
