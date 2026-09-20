
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attackFor, roundTimeline, MAX_DAMAGE } from "../public/fight.js";

const base = (over = {}) => ({
  damage: 16,
  fouls: [],
  crowd: "cheers",
  ...over,
});

describe("attackFor", () => {
  it("turns max damage into a beam", () => {
    const a = attackFor(base({ damage: MAX_DAMAGE }));
    assert.equal(a.kind, "beam");
    assert.equal(a.power, 1);
  });

  it("turns mid damage into a ball with scaled power", () => {
    const a = attackFor(base({ damage: 16 }));
    assert.equal(a.kind, "ball");
    assert.equal(a.power, 0.5);
  });

  it("fizzles on crossed line even with high damage", () => {
    const a = attackFor(base({ damage: 30, crowd: "boos", fouls: ["FOUL — crossed the line"] }));
    assert.equal(a.kind, "fizzle");
    assert.ok(a.power <= 0.2);
  });

  it("fizzles on boos without an explicit foul", () => {
    assert.equal(attackFor(base({ damage: 20, crowd: "boos" })).kind, "fizzle");
  });

  it("fizzles weak or cricket-quiet roasts", () => {
    assert.equal(attackFor(base({ damage: 4, crowd: "crickets" })).kind, "fizzle");
    assert.equal(attackFor(base({ damage: 2 })).kind, "fizzle");
  });

  it("clamps garbage input instead of throwing", () => {
    const a = attackFor(null);
    assert.equal(a.kind, "fizzle");
    assert.ok(a.power >= 0 && a.power <= 1);
  });
});

describe("roundTimeline", () => {
  it("orders red then blue with mapped attacks", () => {
    const tl = roundTimeline(
      { player: 0, result: base({ damage: 30 }) },
      { player: 1, result: base({ damage: 10 }) },
    );
    assert.equal(tl.length, 2);
    assert.equal(tl[0].side, 0);
    assert.equal(tl[0].attack.kind, "beam");
    assert.equal(tl[1].side, 1);
    assert.equal(tl[1].attack.kind, "ball");
  });
});
