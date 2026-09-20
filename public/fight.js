// Pure fight choreography: maps a Jev judgment to a 3D attack.
// No DOM, no three.js — safe to import from tests and the browser alike.

export const MAX_DAMAGE = 32;

// kind: 'beam' (kamehameha) | 'ball' (energy projectile) | 'fizzle' (weak pop)
// power: 0..1 scales size, speed and screen shake.
export function attackFor(result) {
  const damage = Number(result?.damage) || 0;
  const power = Math.min(1, Math.max(0, damage / MAX_DAMAGE));
  const fouls = result?.fouls || [];
  const crowd = result?.crowd || "crickets";

  const crossedLine = fouls.some((f) => f.includes("crossed the line"));
  if (crossedLine || crowd === "boos") {
    return { kind: "fizzle", power: Math.min(power, 0.2), damage, label: "FOUL FIZZLE" };
  }
  if (crowd === "crickets" || power < 0.22) {
    return { kind: "fizzle", power: Math.max(power, 0.08), damage, label: "WEAK POP" };
  }
  if (power >= 0.72) {
    return { kind: "beam", power, damage, label: "ROAST BEAM" };
  }
  return { kind: "ball", power, damage, label: "ROAST BLAST" };
}

// One round plays as two sequential attacks, red first — like a real exchange.
export function roundTimeline(r1, r2) {
  return [
    { side: 0, attack: attackFor(r1?.result) },
    { side: 1, attack: attackFor(r2?.result) },
  ];
}
