import { cn } from "@/lib/utils";

const FACE: Record<string, { emoji: string; label: string }> = {
  neutral: { emoji: "🙂", label: "calm" },
  anxious: { emoji: "😟", label: "anxious" },
  embarrassed: { emoji: "😳", label: "embarrassed" },
  frustrated: { emoji: "😠", label: "frustrated" },
  sad: { emoji: "😔", label: "sad" },
  tearful: { emoji: "😢", label: "tearful" },
  relieved: { emoji: "😌", label: "relieved" },
  confused: { emoji: "😕", label: "confused" },
  in_pain: { emoji: "😣", label: "in pain" },
};

export function faceFor(emotion: string | null | undefined) {
  return FACE[emotion ?? "neutral"] ?? FACE.neutral;
}

/** Placeholder patient avatar until M3's animated stage: a face that follows the patient's emotion. */
export function PatientStage({ name, age, emotion, speaking }: { name: string; age: number; emotion: string; speaking: boolean }) {
  const face = faceFor(emotion);
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "grid size-16 place-items-center rounded-full bg-muted text-4xl transition-shadow motion-reduce:transition-none",
          speaking && "ring-4 ring-brand-teal/40 motion-safe:animate-pulse",
        )}
        role="img"
        aria-label={`${name} looks ${face.label}`}
      >
        {face.emoji}
      </div>
      <div>
        <div className="font-extrabold">{name}</div>
        <div className="text-sm text-muted-foreground">
          {age} · {speaking ? "speaking…" : "listening"}
        </div>
      </div>
    </div>
  );
}
