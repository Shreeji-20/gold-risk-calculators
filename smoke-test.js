(function () {
  const core = window.MartingaleCore;
  const summaryElement = document.getElementById("summary");
  const resultsElement = document.getElementById("results");
  const runButton = document.getElementById("run-tests");

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function approxEqual(actual, expected, label) {
    if (Math.abs(actual - expected) >= 1e-9) {
      throw new Error(`${label}: expected ${expected}, received ${actual}`);
    }
  }

  function createSummaryCard(label, value, className = "") {
    const card = document.createElement("div");
    card.className = `summary-card ${className}`.trim();
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return card;
  }

  function renderSummary(results) {
    const total = results.length;
    const passed = results.filter((result) => result.status === "pass").length;
    const failed = total - passed;

    summaryElement.replaceChildren(
      createSummaryCard("Total checks", String(total)),
      createSummaryCard("Passed", String(passed), passed === total ? "status-pass" : "status-warn"),
      createSummaryCard("Failed", String(failed), failed ? "status-fail" : "status-pass")
    );
  }

  function renderResults(results) {
    resultsElement.replaceChildren();

    results.forEach((result) => {
      const row = document.createElement("article");
      row.className = `result-row ${result.status}`;
      row.innerHTML = `
        <div class="result-head">
          <div class="result-name">${result.name}</div>
          <span class="pill ${result.status}">${result.status}</span>
        </div>
        <p class="result-details">${result.details}</p>
      `;
      resultsElement.append(row);
    });
  }

  function getSmokeTests() {
    return [
      {
        name: "Core module is available",
        run() {
          assert(Boolean(core), "window.MartingaleCore is missing.");
          assert(typeof core.simulateScenario === "function", "simulateScenario should be exposed.");
        },
      },
      {
        name: "List parsing supports decimal commas with semicolons",
        run() {
          const values = core.parseNumberList("1,5; 2; 3", "multipliers");
          assert(JSON.stringify(values) === JSON.stringify([1.5, 2, 3]), "Expected [1.5, 2, 3].");
        },
      },
      {
        name: "Position parsing supports decimal-comma rows",
        run() {
          const positions = core.parsePositions("4104,5; 0,10\n4102,5; 0,15");
          approxEqual(positions[0].entry, 4104.5, "first entry");
          approxEqual(positions[1].lot, 0.15, "second lot");
        },
      },
      {
        name: "Rolling buy basket cuts the oldest trade",
        run() {
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

          assert(result.cutTrades.length === 1, "Expected one cut trade.");
          assert(JSON.stringify(result.activePositions.map((position) => position.entry)) === JSON.stringify([98, 96, 94]), "Unexpected active entries after cut.");
          approxEqual(result.snapshot.breakEven, 97, "buy break-even");
          approxEqual(result.snapshot.recoveryBreakEven, 98, "buy recovery break-even");
          approxEqual(result.snapshot.tpPrice, 99, "buy tp");
        },
      },
      {
        name: "Rolling sell basket mirrors buy math",
        run() {
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

          assert(result.cutTrades.length === 1, "Expected one cut trade.");
          approxEqual(result.snapshot.breakEven, 103, "sell break-even");
          approxEqual(result.snapshot.recoveryBreakEven, 102, "sell recovery break-even");
          approxEqual(result.snapshot.tpPrice, 101, "sell tp");
        },
      },
      {
        name: "Scenario generation respects a custom 4-trade cap",
        run() {
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

          assert(result.summary.finalActiveTrades === 4, "Final active trade count should be 4.");
          assert(result.summary.totalCuts === 1, "Expected one total cut.");
        },
      },
      {
        name: "Dual-grid MTM matches the reference Python scenario",
        run() {
          const result = core.calculateDualGridMtm({
            startPrice: 5234,
            currentPrice: 5014,
            gridA: 4,
            gridB: 10,
            lotSize: 0.01,
            contractSize: 100,
          });

          assert(result.summary.totalOrders === 45, "Expected 45 generated orders.");
          approxEqual(result.summary.totalFloatingPnL, -4928, "dual-grid floating pnl");
          approxEqual(result.summary.breakEven, 230558 / 45, "dual-grid break-even");
        },
      },
      {
        name: "Simple-grid MTM supports buy and sell ladders",
        run() {
          const buyResult = core.calculateSimpleGridMtm({
            direction: "buy",
            startPrice: 100,
            currentPrice: 92,
            gridSpacing: 2,
            lotSize: 1,
            contractSize: 1,
          });
          const sellResult = core.calculateSimpleGridMtm({
            direction: "sell",
            startPrice: 100,
            currentPrice: 108,
            gridSpacing: 2,
            lotSize: 1,
            contractSize: 1,
          });

          assert(buyResult.summary.totalOrders === 5, "Expected 5 buy ladder orders.");
          assert(sellResult.summary.totalOrders === 5, "Expected 5 sell ladder orders.");
          approxEqual(buyResult.summary.breakEven, 96, "simple-grid buy break-even");
          approxEqual(sellResult.summary.breakEven, 104, "simple-grid sell break-even");
          approxEqual(buyResult.summary.priceMoveToBreakEven, 4, "simple-grid buy points to be");
          approxEqual(sellResult.summary.priceMoveToBreakEven, 4, "simple-grid sell points to be");
        },
      },
    ];
  }

  function runSmokeTests() {
    const tests = getSmokeTests();
    const results = tests.map((testCase) => {
      try {
        testCase.run();
        return {
          name: testCase.name,
          status: "pass",
          details: "Check passed.",
        };
      } catch (error) {
        return {
          name: testCase.name,
          status: "fail",
          details: error.message,
        };
      }
    });

    renderSummary(results);
    renderResults(results);
  }

  runButton.addEventListener("click", runSmokeTests);
  runSmokeTests();
})();