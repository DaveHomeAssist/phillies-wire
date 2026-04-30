import assert from "node:assert/strict";

import { deriveIlFromTransactions } from "../crawl/api/mlb.mjs";

// Sample transaction shapes taken verbatim from
// https://statsapi.mlb.com/api/v1/transactions?teamId=143&sportId=1
// on 2026-04-24. Kept tiny but representative of the four pattern classes
// the derive function cares about: placed, transferred, activated, released.
const sampleTxs = {
  transactions: [
    {
      date: "2026-03-25",
      typeCode: "SC",
      person: { id: 608331, fullName: "Zack Wheeler" },
      description:
        "Philadelphia Phillies placed RHP Zack Wheeler on the 15-day injured list retroactive to March 22, 2026. Right shoulder surgery.",
    },
    {
      date: "2026-03-25",
      typeCode: "SC",
      person: { id: 670724, fullName: "Orion Kerkering" },
      description:
        "Philadelphia Phillies placed RHP Orion Kerkering on the 15-day injured list retroactive to March 22, 2026. Right hamstring strain.",
    },
    {
      date: "2026-04-07",
      typeCode: "SC",
      person: { id: 670724, fullName: "Orion Kerkering" },
      description: "Philadelphia Phillies activated RHP Orion Kerkering from the 15-day injured list.",
    },
    {
      date: "2026-04-22",
      typeCode: "SC",
      person: { id: 592663, fullName: "J.T. Realmuto" },
      description:
        "Philadelphia Phillies placed C J.T. Realmuto on the 10-day injured list. Back spasms.",
    },
    {
      date: "2026-03-25",
      typeCode: "SC",
      person: { id: 669015, fullName: "Max Lazar" },
      description:
        "Philadelphia Phillies placed RHP Max Lazar on the 15-day injured list retroactive to March 22, 2026. Left oblique strain.",
    },
    {
      date: "2026-04-22",
      typeCode: "SC",
      person: { id: 669015, fullName: "Max Lazar" },
      description:
        "Philadelphia Phillies transferred RHP Max Lazar from the 15-day injured list to the 60-day injured list. Left oblique strain.",
    },
    {
      date: "2026-04-23",
      typeCode: "REL",
      person: { id: 592836, fullName: "Taijuan Walker" },
      description: "Philadelphia Phillies released RHP Taijuan Walker.",
    },
  ],
};

runTest("deriveIlFromTransactions opens an IL slot on 'placed on N-day' with injury text and retroactive date", () => {
  const result = deriveIlFromTransactions(sampleTxs);
  const wheeler = result.injuries.find((e) => e.person.fullName === "Zack Wheeler");
  assert.ok(wheeler, "Zack Wheeler should be on IL");
  assert.equal(wheeler.injuryListType, "15-Day");
  assert.equal(wheeler.injuryDescription, "Right shoulder surgery");
  assert.equal(wheeler.retroactiveDate, "2026-03-22");
  assert.equal(wheeler.position.abbreviation, "RHP");
  assert.equal(wheeler.placedDate, "2026-03-25");
});

runTest("deriveIlFromTransactions closes the slot on 'activated from ... injured list'", () => {
  const result = deriveIlFromTransactions(sampleTxs);
  const kerkering = result.injuries.find((e) => e.person.fullName === "Orion Kerkering");
  assert.equal(kerkering, undefined, "Kerkering was activated 2026-04-07; should not be on IL");
});

runTest("deriveIlFromTransactions updates il_type on 'transferred from N-day to M-day'", () => {
  const result = deriveIlFromTransactions(sampleTxs);
  const lazar = result.injuries.find((e) => e.person.fullName === "Max Lazar");
  assert.ok(lazar, "Max Lazar should still be on IL after the 60-day transfer");
  assert.equal(lazar.injuryListType, "60-Day");
  assert.equal(lazar.injuryDescription, "Left oblique strain");
});

runTest("deriveIlFromTransactions drops players on release / trade / DFA", () => {
  const result = deriveIlFromTransactions({
    transactions: [
      {
        date: "2026-04-01",
        typeCode: "SC",
        person: { fullName: "Some Player" },
        description: "Philadelphia Phillies placed RHP Some Player on the 15-day injured list. Forearm tightness.",
      },
      {
        date: "2026-04-23",
        typeCode: "REL",
        person: { fullName: "Some Player" },
        description: "Philadelphia Phillies released RHP Some Player.",
      },
    ],
  });
  assert.equal(
    result.injuries.find((e) => e.person.fullName === "Some Player"),
    undefined,
    "Released players should not appear in derived IL",
  );
});

runTest("deriveIlFromTransactions handles 10-day IL without retroactive date", () => {
  const result = deriveIlFromTransactions(sampleTxs);
  const realmuto = result.injuries.find((e) => e.person.fullName === "J.T. Realmuto");
  assert.ok(realmuto, "Realmuto on 10-day IL");
  assert.equal(realmuto.injuryListType, "10-Day");
  assert.equal(realmuto.injuryDescription, "Back spasms");
  assert.equal(realmuto.retroactiveDate, null);
  assert.equal(realmuto.position.abbreviation, "C");
});

runTest("deriveIlFromTransactions tolerates empty or malformed input", () => {
  assert.deepEqual(deriveIlFromTransactions(null), { injuries: [] });
  assert.deepEqual(deriveIlFromTransactions(undefined), { injuries: [] });
  assert.deepEqual(deriveIlFromTransactions({}), { injuries: [] });
  assert.deepEqual(deriveIlFromTransactions({ transactions: [] }), { injuries: [] });
  assert.deepEqual(
    deriveIlFromTransactions({ transactions: [{ date: "2026-04-01", description: null, person: null }] }),
    { injuries: [] },
  );
});

runTest("deriveIlFromTransactions sorts chronologically so out-of-order input still derives correctly", () => {
  const reversed = { transactions: [...sampleTxs.transactions].reverse() };
  const result = deriveIlFromTransactions(reversed);
  const wheeler = result.injuries.find((e) => e.person.fullName === "Zack Wheeler");
  assert.ok(wheeler);
  assert.equal(wheeler.injuryListType, "15-Day");
  const lazar = result.injuries.find((e) => e.person.fullName === "Max Lazar");
  assert.equal(lazar.injuryListType, "60-Day", "Transfer must apply on top of placement regardless of input order");
});

function runTest(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
