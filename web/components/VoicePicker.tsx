"use client";

import { VOICES, VOICE_RANDOM_ID } from "@/lib/tts";

export function VoicePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const options = [{ id: VOICE_RANDOM_ID, label: "Random", emoji: "🎲" }, ...VOICES];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => {
        const selected = value === v.id;
        return (
          <button
            key={v.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(v.id)}
            className={`px-2.5 py-1 rounded-full text-xs border transition ${
              selected
                ? "border-white bg-white text-black font-bold"
                : "border-white/15 bg-black/30 hover:bg-white/10"
            }`}
          >
            <span className="mr-1">{v.emoji}</span>
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
