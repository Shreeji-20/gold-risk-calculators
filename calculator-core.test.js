const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("./calculator-core.js");

function assertApprox(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, received ${actual}`
  );
}

test("parseNumberList accepts comma-separated values", () => {
  assert.deepEqual(core.parseNumberList("1.5, 2, 3", "multipliers"), [1.5, 2, 3]);
});

test("parseNumberList accepts semicolon-separated values with decimal commas", () => {
  assert.deepEqual(core.parseNumberList("1,5; 2; 3", "multipliers"), [1.5, 2, 3]);
});

test("parsePositions accepts semicolon field separators for decimal-comma inputs", () => {
  const positions = core.parsePositions("4104,5; 0,10\n4102,5; 0,15");

  assert.deepEqual(
    positions.map((position) => ({ entry: position.entry, lot: position.lot })),
    [
      { entry: 4104.5, lot: 0.1 },
      { entry: 4102.5, lot: 0.15 },
    ]
  );
});

test("limitOpenPositions cuts the oldest buy trade and adjusts net break-even", () => {
  const result = core.limitOpenPositions(
    [
      { id: "1", entry: 100, lot: 1 },
      { id: "2", entry: 98, lot: 1 },
      { id: "3", entry: 96, lot: 1 },
      { id: "4", entry: 94, lot: 1 },
    ],
    94,
    "buy",
    2,
    1,
    3,
    true
  );

  assert.deepEqual(result.activePositions.map((position) => position.entry), [98, 96, 94]);
  assert.equal(result.cutTrades.length, 1);
  assertApprox(result.totalRealizedPnL, -6, "realized cut pnl");
  assertApprox(result.snapshot.weightedBreakEven, 96, "active weighted break-even");
  assertApprox(result.snapshot.breakEven, 97, "sequence break-even");
  assertApprox(result.snapshot.recoveryBreakEven, 98, "recovery break-even");
  assertApprox(result.snapshot.tpPrice, 99, "tp price");
  assertApprox(result.snapshot.netCurrentPnL, -12, "current net pnl");
  assertApprox(result.snapshot.netAtTp, 3, "net pnl at tp");
});

test("limitOpenPositions mirrors the same math for sell baskets", () => {
  const result = core.limitOpenPositions(
    [
      { id: "1", entry: 100, lot: 1 },
      { id: "2", entry: 102, lot: 1 },
      { id: "3", entry: 104, lot: 1 },
      { id: "4", entry: 106, lot: 1 },
    ],
    106,
    "sell",
    2,
    1,
    3,
    true
  );

  assert.deepEqual(result.activePositions.map((position) => position.entry), [102, 104, 106]);
  assert.equal(result.cutTrades.length, 1);
  assertApprox(result.totalRealizedPnL, -6, "realized cut pnl");
  assertApprox(result.snapshot.weightedBreakEven, 104, "active weighted break-even");
  assertApprox(result.snapshot.breakEven, 103, "sequence break-even");
  assertApprox(result.snapshot.recoveryBreakEven, 102, "recovery break-even");
  assertApprox(result.snapshot.tpPrice, 101, "tp price");
  assertApprox(result.snapshot.netCurrentPnL, -12, "current net pnl");
  assertApprox(result.snapshot.netAtTp, 3, "net pnl at tp");
});

test("calculateBasketSnapshot keeps TP on active break-even even with realized cut pnl", () => {
  const result = core.calculateBasketSnapshot(
    [
      { entry: 5000, lot: 1 },
      { entry: 4997, lot: 1 },
      { entry: 4994, lot: 1 },
      { entry: 4991, lot: 2 },
      { entry: 4988, lot: 2 },
      { entry: 4985, lot: 2 },
      { entry: 4982, lot: 4 },
      { entry: 4979, lot: 4 },
    ],
    4979,
    "buy",
    3,
    100,
    -6000
  );

  assertApprox(result.totalLot, 17, "total lot");
  assertApprox(result.breakEven, 84763 / 17, "basket break-even");
  assertApprox(result.recoveryBreakEven, 84763 / 17 + 6000 / (17 * 100), "recovery break-even");
  assertApprox(result.tpPrice, 84763 / 17 + 3, "tp from basket break-even");
});

test("simulateScenario keeps break-even on all opened trades while cuts affect recovery be", () => {
  const result = core.simulateScenario({
    direction: "buy",
    firstEntryPrice: 5003,
    entrySpacing: 3,
    baseLot: 1,
    iterations: 8,
    maxOpenTrades: 3,
    tpDistance: 3,
    multiplier: 2,
    everyNTrades: 3,
    pointValue: 100,
    autoCut: true,
  });

  const finalRow = result.rows[7];

  assert.equal(finalRow.activeTrades, 3);
  assert.deepEqual(finalRow.activePositions.map((position) => position.entry), [4985, 4982, 4979]);
  assertApprox(finalRow.breakEven, 84763 / 17, "full-sequence break-even");
  assertApprox(finalRow.recoveryBreakEven, 4987.7, "recovery break-even");
  assertApprox(finalRow.tpPrice, 84763 / 17 + 3, "tp from full-sequence break-even");
  assertApprox(finalRow.cumulativeRealizedPnL, -6300, "realized cut pnl");
});

test("simulateScenario enforces the three-trade cap when autoCut is enabled", () => {
  const result = core.simulateScenario({
    direction: "buy",
    firstEntryPrice: 100,
    entrySpacing: 2,
    baseLot: 0.01,
    iterations: 4,
    tpDistance: 2,
    multiplier: 2,
    everyNTrades: 1,
    pointValue: 100,
    autoCut: true,
  });

  assert.equal(result.summary.finalActiveTrades, 3);
  assert.equal(result.summary.totalCuts, 1);
  assert.deepEqual(result.rows[3].activePositions.map((position) => position.entry), [96, 94, 92]);
});

test("simulateScenario supports keeping four trades open and cutting on the fifth", () => {
  const result = core.simulateScenario({
    direction: "buy",
    firstEntryPrice: 100,
    entrySpacing: 2,
    baseLot: 0.01,
    iterations: 5,
    maxOpenTrades: 4,
    tpDistance: 2,
    multiplier: 2,
    everyNTrades: 1,
    pointValue: 100,
    autoCut: true,
  });

  assert.equal(result.summary.finalActiveTrades, 4);
  assert.equal(result.summary.totalCuts, 1);
  assert.deepEqual(result.rows[4].activePositions.map((position) => position.entry), [96, 94, 92, 90]);
});

test("analyzeBasket supports keeping five trades open and cutting on the sixth", () => {
  const result = core.analyzeBasket({
    direction: "buy",
    currentPrice: 90,
    maxOpenTrades: 5,
    tpDistance: 2,
    pointValue: 1,
    positions: [
      { id: "1", entry: 100, lot: 1 },
      { id: "2", entry: 98, lot: 1 },
      { id: "3", entry: 96, lot: 1 },
      { id: "4", entry: 94, lot: 1 },
      { id: "5", entry: 92, lot: 1 },
      { id: "6", entry: 90, lot: 1 },
    ],
  });

  assert.equal(result.cutTrades.length, 1);
  assert.deepEqual(result.activePositions.map((position) => position.entry), [98, 96, 94, 92, 90]);
});

test("simulateScenario keeps all trades open when autoCut is disabled", () => {
  const result = core.simulateScenario({
    direction: "buy",
    firstEntryPrice: 100,
    entrySpacing: 2,
    baseLot: 0.01,
    iterations: 4,
    tpDistance: 2,
    multiplier: 2,
    everyNTrades: 1,
    pointValue: 100,
    autoCut: false,
  });

  assert.equal(result.summary.finalActiveTrades, 4);
  assert.equal(result.summary.totalCuts, 0);
});

test("runSimulationSet expands every multiplier and step schedule combination", () => {
  const results = core.runSimulationSet({
    direction: "buy",
    firstEntryPrice: 100,
    entrySpacing: 2,
    baseLot: 0.01,
    iterations: 2,
    tpDistance: 2,
    multipliers: [1.5, 2],
    stepSchedules: [2, 3],
    pointValue: 100,
    autoCut: true,
  });

  assert.equal(results.length, 4);
  assert.deepEqual(
    results.map((result) => result.key),
    ["1.5x-every-2", "1.5x-every-3", "2x-every-2", "2x-every-3"]
  );
});

test("analyzeBasket always applies the rolling three-trade rule", () => {
  const result = core.analyzeBasket({
    direction: "buy",
    currentPrice: 92,
    maxOpenTrades: 3,
    tpDistance: 2,
    pointValue: 1,
    positions: [
      { id: "1", entry: 100, lot: 1 },
      { id: "2", entry: 98, lot: 1 },
      { id: "3", entry: 96, lot: 1 },
      { id: "4", entry: 94, lot: 1 },
      { id: "5", entry: 92, lot: 1 },
    ],
  });

  assert.equal(result.cutTrades.length, 2);
  assert.deepEqual(result.activePositions.map((position) => position.entry), [96, 94, 92]);
});

test("calculateDualGridMtm matches the reference dual_grid_mtm.py scenario", () => {
  const result = core.calculateDualGridMtm({
    startPrice: 5234,
    currentPrice: 5014,
    gridA: 4,
    gridB: 10,
    lotSize: 0.01,
    contractSize: 100,
  });

  assert.equal(result.summary.totalOrders, 45);
  assertApprox(result.summary.valuePerPoint, 1, "value per point");
  assertApprox(result.summary.totalFloatingPnL, -4928, "total floating pnl");
  assertApprox(result.summary.breakEven, 230558 / 45, "dual-grid break-even");
  assertApprox(result.summary.priceMoveToBreakEven, 230558 / 45 - 5014, "move to break-even");
  assert.deepEqual(
    result.rows.slice(0, 4).map((row) => row.entry),
    [5234, 5224, 5228, 5214]
  );
  assert.deepEqual(
    result.rows.slice(-2).map((row) => row.entry),
    [5014, 5018]
  );
});

test("calculateSimpleGridMtm builds a buy ladder on every grid fall", () => {
  const result = core.calculateSimpleGridMtm({
    direction: "buy",
    startPrice: 100,
    currentPrice: 92,
    gridSpacing: 2,
    lotSize: 1,
    contractSize: 1,
  });

  assert.equal(result.summary.totalOrders, 5);
  assertApprox(result.summary.breakEven, 96, "buy simple-grid break-even");
  assertApprox(result.summary.totalFloatingPnL, -20, "buy simple-grid floating pnl");
  assertApprox(result.summary.priceMoveToBreakEven, 4, "buy simple-grid move to break-even");
  assert.deepEqual(
    result.rows.map((row) => row.entry),
    [100, 98, 96, 94, 92]
  );
});

test("calculateSimpleGridMtm scales floating pnl correctly for 0.01 lot and 100 contract size", () => {
  const result = core.calculateSimpleGridMtm({
    direction: "buy",
    startPrice: 1000,
    currentPrice: 0,
    gridSpacing: 1,
    lotSize: 0.01,
    contractSize: 100,
  });

  assert.equal(result.summary.totalOrders, 1001);
  assertApprox(result.summary.breakEven, 500, "scaled simple-grid break-even");
  assertApprox(result.summary.totalFloatingPnL, -500500, "scaled simple-grid floating pnl");
  assertApprox(result.summary.priceMoveToBreakEven, 500, "scaled simple-grid move to break-even");
});

test("calculateSimpleGridMtm builds a sell ladder on every grid rise", () => {
  const result = core.calculateSimpleGridMtm({
    direction: "sell",
    startPrice: 100,
    currentPrice: 108,
    gridSpacing: 2,
    lotSize: 1,
    contractSize: 1,
  });

  assert.equal(result.summary.totalOrders, 5);
  assertApprox(result.summary.breakEven, 104, "sell simple-grid break-even");
  assertApprox(result.summary.totalFloatingPnL, -20, "sell simple-grid floating pnl");
  assertApprox(result.summary.priceMoveToBreakEven, 4, "sell simple-grid move to break-even");
  assert.deepEqual(
    result.rows.map((row) => row.entry),
    [100, 102, 104, 106, 108]
  );
});