
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, TOPICS, localizeFoul, localizeCrowd } from "../public/strings.js";

describe("strings", () => {
  it("en and id share exactly the same keys", () => {
    const en = Object.keys(STRINGS.en).sort();
    const id = Object.keys(STRINGS.id).sort();
    assert.deepEqual(id, en);
    assert.ok(en.length > 40);
  });

  it("has no empty strings", () => {
    for (const [lang, dict] of Object.entries(STRINGS)) {
      for (const [key, value] of Object.entries(dict)) {
        assert.ok(value && value.length > 0, `${lang}.${key} is empty`);
      }
    }
  });

  it("ships topic lists in both languages", () => {
    assert.ok(TOPICS.en.length >= 10 && TOPICS.id.length >= 10);
  });

  it("localizes fouls and crowd reactions", () => {
    assert.equal(localizeFoul("FOUL — crossed the line", "id"), STRINGS.id.foulCrossed);
    assert.equal(localizeFoul("LOW EFFORT", "en"), STRINGS.en.foulEffort);
    assert.equal(localizeFoul("SOMETHING NEW", "id"), "SOMETHING NEW");
    assert.equal(localizeCrowd("cheers", "id"), STRINGS.id.crowdCheers);
    assert.equal(localizeCrowd("boos", "en"), STRINGS.en.crowdBoos);
  });
});
