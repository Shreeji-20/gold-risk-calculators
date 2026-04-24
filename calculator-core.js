(function (root, factory) {
  const core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }

  root.MartingaleCore = core;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EPSILON = 1e-9;
  const LOT_STEP = 0.01;
  const MIN_LOT = 0.01;

  function parseDecimal(raw, label) {
    const normalized = String(raw ?? "")
      .trim()
      .replace(",", ".");

    const value = Number(normalized);
    if (!Number.isFinite(value)) {
      throw new Error(`Enter a valid number for ${label}.`);
    }

    return value;
  }

  function parseInteger(raw, label) {
    const value = parseDecimal(raw, label);
    if (!Number.isInteger(value)) {
      throw new Error(`${label} must be a whole number.`);
    }
    return value;
  }

  function splitListValues(raw) {
    const normalized = String(raw ?? "").trim();
    if (!normalized) {
      return [];
    }

    if (/[;\r\n]/.test(normalized)) {
      return normalized
        .split(/[;\r\n]+/)
        .map((value) => value.trim())
        .filter(Boolean);
    }

    return normalized
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function parseNumberList(raw, label) {
    const values = splitListValues(raw)
      .map((value) => parseDecimal(value, label))
      .filter((value) => Number.isFinite(value));

    if (!values.length) {
      throw new Error(`Enter at least one valid number for ${label}.`);
    }

    return values;
  }

  function roundToDecimals(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  function normalizeLot(value, label = "lot") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Enter a valid positive number for ${label}.`);
    }

    const normalized = Math.max(
      MIN_LOT,
      Math.ceil((value - EPSILON) / LOT_STEP) * LOT_STEP
    );

    return roundToDecimals(normalized, 2);
  }

  function validateOpenTradeCap(value, label = "max open trades") {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${label} must be a whole number greater than or equal to 1.`);
    }

    return value;
  }

  function splitPositionFields(line, index) {
    const separator = line.includes(";") ? ";" : ",";
    const parts = line.split(separator).map((value) => value.trim());

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid position on line ${index + 1}. Use: price, lot`);
    }

    return parts;
  }

  function parsePositions(raw) {
    const lines = String(raw ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      throw new Error("Add at least one open position.");
    }

    return lines.map((line, index) => {
      const [entryRaw, lotRaw] = splitPositionFields(line, index);
      const entry = parseDecimal(entryRaw, `entry price on line ${index + 1}`);
      const lot = normalizeLot(
        parseDecimal(lotRaw, `lot on line ${index + 1}`),
        `lot on line ${index + 1}`
      );

      return {
        id: `manual-${index + 1}`,
        iteration: index + 1,
        entry,
        lot,
      };
    });
  }

  function getDirectionConfig(direction) {
    if (direction !== "buy" && direction !== "sell") {
      throw new Error("Direction must be buy or sell.");
    }

    return direction === "buy"
      ? {
          priceStepSign: -1,
          tpSign: 1,
          pnlAtPrice: (entry, price, lot, pointValue) => (price - entry) * lot * pointValue,
        }
      : {
          priceStepSign: 1,
          tpSign: -1,
          pnlAtPrice: (entry, price, lot, pointValue) => (entry - price) * lot * pointValue,
        };
  }

  function calculateBreakEven(positions) {
    const totalLot = positions.reduce((sum, position) => sum + position.lot, 0);
    if (!totalLot) {
      return { totalLot: 0, weightedBreakEven: NaN };
    }

    const weightedPrice = positions.reduce(
      (sum, position) => sum + position.entry * position.lot,
      0
    );

    return {
      totalLot,
      weightedBreakEven: weightedPrice / totalLot,
    };
  }

  function calculateBasketSnapshot(
    positions,
    currentPrice,
    direction,
    tpDistance,
    pointValue,
    realizedPnL = 0,
    breakEvenPositions = positions
  ) {
    const config = getDirectionConfig(direction);
    const { totalLot, weightedBreakEven } = calculateBreakEven(positions);
    const { weightedBreakEven: basketBreakEven } = calculateBreakEven(breakEvenPositions);
    const breakEven = Number.isFinite(basketBreakEven) ? basketBreakEven : NaN;
    const recoveryBreakEven = totalLot
      ? weightedBreakEven - config.tpSign * (realizedPnL / (totalLot * pointValue))
      : NaN;
    const tpPrice = totalLot ? breakEven + config.tpSign * tpDistance : NaN;

    const floatingPnL = positions.reduce(
      (sum, position) =>
        sum + config.pnlAtPrice(position.entry, currentPrice, position.lot, pointValue),
      0
    );

    const activeProfitAtTp = positions.reduce(
      (sum, position) =>
        sum + config.pnlAtPrice(position.entry, tpPrice, position.lot, pointValue),
      0
    );

    return {
      totalLot,
      weightedBreakEven,
      breakEven,
      recoveryBreakEven,
      tpPrice,
      realizedPnL,
      floatingPnL,
      netCurrentPnL: realizedPnL + floatingPnL,
      activeProfitAtTp,
      netAtTp: realizedPnL + activeProfitAtTp,
    };
  }

  function limitOpenPositions(
    positions,
    currentPrice,
    direction,
    tpDistance,
    pointValue,
    keepLatestCount,
    enabled,
    baseRealizedPnL = 0,
    breakEvenPositions = positions
  ) {
    const normalizedKeepLatestCount = validateOpenTradeCap(keepLatestCount, "max open trades");
    const activePositions = positions.map((position) => ({ ...position }));
    const config = getDirectionConfig(direction);
    const cutTrades = [];
    let realizedPnLDelta = 0;

    if (enabled) {
      while (activePositions.length > normalizedKeepLatestCount) {
        const removed = activePositions.shift();
        const cutPnL = config.pnlAtPrice(removed.entry, currentPrice, removed.lot, pointValue);

        realizedPnLDelta += cutPnL;
        cutTrades.push({
          ...removed,
          cutPrice: currentPrice,
          cutPnL,
        });
      }
    }

    const totalRealizedPnL = baseRealizedPnL + realizedPnLDelta;
    const snapshot = calculateBasketSnapshot(
      activePositions,
      currentPrice,
      direction,
      tpDistance,
      pointValue,
      totalRealizedPnL,
      breakEvenPositions
    );

    return {
      activePositions,
      cutTrades,
      realizedPnLDelta,
      totalRealizedPnL,
      snapshot,
    };
  }

  function lotForIteration(baseLot, multiplier, everyNTrades, iterationIndex) {
    const block = Math.floor(iterationIndex / everyNTrades);
    return normalizeLot(baseLot * multiplier ** block, "generated lot");
  }

  function entryPriceForIteration(firstEntryPrice, entrySpacing, direction, iterationIndex) {
    const config = getDirectionConfig(direction);
    return firstEntryPrice + config.priceStepSign * entrySpacing * (iterationIndex + 1);
  }

  function buildIterationRow(iteration, entry, lot, allPositions, stabilized) {
    return {
      iteration: iteration + 1,
      currentPrice: entry,
      openedEntry: entry,
      openedLot: lot,
      totalOpenedLot: allPositions.reduce((sum, item) => sum + item.lot, 0),
      activeTrades: stabilized.activePositions.length,
      activeLot: stabilized.snapshot.totalLot,
      weightedBreakEven: stabilized.snapshot.weightedBreakEven,
      breakEven: stabilized.snapshot.breakEven,
      recoveryBreakEven: stabilized.snapshot.recoveryBreakEven,
      tpPrice: stabilized.snapshot.tpPrice,
      cutCount: stabilized.cutTrades.length,
      cutTrades: stabilized.cutTrades,
      iterationCutPnL: stabilized.realizedPnLDelta,
      cumulativeRealizedPnL: stabilized.totalRealizedPnL,
      floatingPnL: stabilized.snapshot.floatingPnL,
      currentNetPnL: stabilized.snapshot.netCurrentPnL,
      activeProfitAtTp: stabilized.snapshot.activeProfitAtTp,
      netAtTp: stabilized.snapshot.netAtTp,
      activePositions: stabilized.activePositions.map((item) => ({ ...item })),
    };
  }

  function buildTpScenario(finalRow) {
    if (!finalRow) {
      return null;
    }

    return {
      currentPrice: finalRow.currentPrice,
      tpPrice: finalRow.tpPrice,
      priceMoveToTp: finalRow.tpPrice - finalRow.currentPrice,
      currentNetPnL: finalRow.currentNetPnL,
      additionalPnLToTp: finalRow.netAtTp - finalRow.currentNetPnL,
      finalNetAtTp: finalRow.netAtTp,
      activeTradesClosedAtTp: finalRow.activeTrades,
      activePositionsAtTp: finalRow.activePositions,
      activeProfitAtTp: finalRow.activeProfitAtTp,
    };
  }

  function buildScenarioSummary(finalRow, rows, totalRealizedPnL, maxFloatingDrawdown, tpScenario) {
    return {
      finalActiveTrades: finalRow ? finalRow.activeTrades : 0,
      finalActiveLot: finalRow ? finalRow.activeLot : 0,
      finalWeightedBreakEven: finalRow ? finalRow.weightedBreakEven : NaN,
      finalBreakEven: finalRow ? finalRow.breakEven : NaN,
      finalRecoveryBreakEven: finalRow ? finalRow.recoveryBreakEven : NaN,
      finalTpPrice: finalRow ? finalRow.tpPrice : NaN,
      finalCurrentPrice: finalRow ? finalRow.currentPrice : NaN,
      finalFloatingPnL: finalRow ? finalRow.floatingPnL : 0,
      finalCurrentNetPnL: finalRow ? finalRow.currentNetPnL : 0,
      totalRealizedPnL,
      netAtTp: finalRow ? finalRow.netAtTp : 0,
      maxFloatingDrawdown,
      totalOpenedLot: finalRow ? finalRow.totalOpenedLot : 0,
      totalCuts: rows.reduce((sum, row) => sum + row.cutCount, 0),
      tpScenario,
    };
  }

  function simulateScenario({
    direction,
    firstEntryPrice,
    entrySpacing,
    baseLot,
    iterations,
    tpDistance,
    multiplier,
    everyNTrades,
    pointValue,
    autoCut,
    maxOpenTrades = 3,
  }) {
    const normalizedMaxOpenTrades = validateOpenTradeCap(maxOpenTrades, "max open trades");
    const allPositions = [];
    const rows = [];
    let maxFloatingDrawdown = 0;
    let totalRealizedPnL = 0;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const entry = entryPriceForIteration(firstEntryPrice, entrySpacing, direction, iteration);
      const lot = lotForIteration(baseLot, multiplier, everyNTrades, iteration);
      const position = {
        id: `${iteration + 1}-${entry}-${lot}`,
        iteration: iteration + 1,
        entry,
        lot,
      };

      allPositions.push(position);

      const currentOpen = allPositions.filter((item) => !item.closed);
      const stabilized = limitOpenPositions(
        currentOpen,
        entry,
        direction,
        tpDistance,
        pointValue,
        normalizedMaxOpenTrades,
        autoCut,
        totalRealizedPnL,
        allPositions
      );

      totalRealizedPnL += stabilized.realizedPnLDelta;
      const cutIds = new Set(stabilized.cutTrades.map((trade) => trade.id));

      allPositions.forEach((item) => {
        if (cutIds.has(item.id)) {
          item.closed = true;
        }
      });

      if (stabilized.snapshot.floatingPnL < maxFloatingDrawdown) {
        maxFloatingDrawdown = stabilized.snapshot.floatingPnL;
      }

      rows.push(buildIterationRow(iteration, entry, lot, allPositions, stabilized));
    }

    const finalRow = rows[rows.length - 1];
    const tpScenario = buildTpScenario(finalRow);

    return {
      key: `${multiplier}x-every-${everyNTrades}`,
      multiplier,
      everyNTrades,
      autoCut,
      maxOpenTrades: normalizedMaxOpenTrades,
      tpScenario,
      rows,
      summary: buildScenarioSummary(
        finalRow,
        rows,
        totalRealizedPnL,
        maxFloatingDrawdown,
        tpScenario
      ),
    };
  }

  function runSimulationSet(config) {
    return config.multipliers.flatMap((multiplier) =>
      config.stepSchedules.map((everyNTrades) => {
        if (multiplier <= 0 || everyNTrades < 1) {
          throw new Error("Multipliers must be positive and trade-step schedules must be 1 or more.");
        }

        return simulateScenario({
          direction: config.direction,
          firstEntryPrice: config.firstEntryPrice,
          entrySpacing: config.entrySpacing,
          baseLot: config.baseLot,
          iterations: config.iterations,
          tpDistance: config.tpDistance,
          multiplier,
          everyNTrades,
          pointValue: config.pointValue,
          autoCut: config.autoCut,
          maxOpenTrades: config.maxOpenTrades,
        });
      })
    );
  }

  function analyzeBasket(config) {
    const maxOpenTrades = config.maxOpenTrades ?? 3;

    return limitOpenPositions(
      config.positions,
      config.currentPrice,
      config.direction,
      config.tpDistance,
      config.pointValue,
      maxOpenTrades,
      true
    );
  }

  function buildDualGridOrders({
    startPrice,
    currentPrice,
    gridA,
    gridB,
  }) {
    if (!Number.isFinite(startPrice) || !Number.isFinite(currentPrice)) {
      throw new Error("Enter valid prices for the dual-grid calculator.");
    }

    if (!Number.isFinite(gridA) || gridA <= 0) {
      throw new Error("Grid A must be a valid positive number.");
    }

    if (!Number.isFinite(gridB) || gridB <= 0) {
      throw new Error("Grid B must be a valid positive number.");
    }

    if (gridB <= gridA) {
      throw new Error("Grid B must be greater than Grid A.");
    }

    if (startPrice <= currentPrice) {
      throw new Error("Start price must be greater than current price for the dual-grid sequence.");
    }

    const orders = [
      {
        sequence: 1,
        step: 0,
        leg: "initial",
        entry: startPrice,
      },
    ];

    let price = startPrice;
    let sequence = 2;
    let step = 1;

    while (price - gridB >= currentPrice - EPSILON) {
      const gridBPrice = roundToDecimals(price - gridB, 6);
      const gridAPrice = roundToDecimals(gridBPrice + gridA, 6);

      orders.push({
        sequence,
        step,
        leg: "grid-b",
        entry: gridBPrice,
      });
      sequence += 1;

      orders.push({
        sequence,
        step,
        leg: "grid-a",
        entry: gridAPrice,
      });
      sequence += 1;

      price = gridBPrice;
      step += 1;
    }

    return orders;
  }

  function calculateDualGridMtm({
    startPrice,
    currentPrice,
    gridA,
    gridB,
    lotSize,
    contractSize,
  }) {
    if (!Number.isFinite(lotSize) || lotSize <= 0) {
      throw new Error("Lot size must be a valid positive number.");
    }

    if (!Number.isFinite(contractSize) || contractSize <= 0) {
      throw new Error("Contract size must be a valid positive number.");
    }

    const orders = buildDualGridOrders({
      startPrice,
      currentPrice,
      gridA,
      gridB,
    });

    const valuePerPoint = lotSize * contractSize;
    let totalFloatingPnL = 0;

    const rows = orders.map((order) => {
      const floatingPnL = (currentPrice - order.entry) * valuePerPoint;
      totalFloatingPnL += floatingPnL;

      return {
        ...order,
        currentPrice,
        floatingPnL,
      };
    });

    const positions = orders.map((order) => ({
      entry: order.entry,
      lot: lotSize,
    }));
    const { weightedBreakEven } = calculateBreakEven(positions);
    const breakEven = Number.isFinite(weightedBreakEven) ? weightedBreakEven : NaN;

    return {
      rows,
      summary: {
        totalOrders: orders.length,
        breakEven,
        valuePerPoint,
        totalFloatingPnL,
        priceMoveToBreakEven: breakEven - currentPrice,
      },
    };
  }

  function buildSimpleGridOrders({
    direction,
    startPrice,
    currentPrice,
    gridSpacing,
  }) {
    const config = getDirectionConfig(direction);

    if (!Number.isFinite(startPrice) || !Number.isFinite(currentPrice)) {
      throw new Error("Enter valid prices for the simple-grid calculator.");
    }

    if (!Number.isFinite(gridSpacing) || gridSpacing <= 0) {
      throw new Error("Grid spacing must be a valid positive number.");
    }

    if (direction === "buy" && startPrice < currentPrice - EPSILON) {
      throw new Error("For a buy simple grid, start price must be greater than or equal to current price.");
    }

    if (direction === "sell" && startPrice > currentPrice + EPSILON) {
      throw new Error("For a sell simple grid, start price must be less than or equal to current price.");
    }

    const orders = [
      {
        sequence: 1,
        step: 0,
        entry: startPrice,
      },
    ];

    let price = startPrice;
    let sequence = 2;
    let step = 1;
    const comparator =
      direction === "buy"
        ? (nextPrice) => nextPrice >= currentPrice - EPSILON
        : (nextPrice) => nextPrice <= currentPrice + EPSILON;

    while (true) {
      const nextPrice = roundToDecimals(price + config.priceStepSign * gridSpacing, 6);

      if (!comparator(nextPrice)) {
        break;
      }

      orders.push({
        sequence,
        step,
        entry: nextPrice,
      });

      price = nextPrice;
      sequence += 1;
      step += 1;
    }

    return orders;
  }

  function calculateSimpleGridMtm({
    direction,
    startPrice,
    currentPrice,
    gridSpacing,
    lotSize,
    contractSize,
  }) {
    if (!Number.isFinite(lotSize) || lotSize <= 0) {
      throw new Error("Lot size must be a valid positive number.");
    }

    if (!Number.isFinite(contractSize) || contractSize <= 0) {
      throw new Error("Contract size must be a valid positive number.");
    }

    const config = getDirectionConfig(direction);
    const orders = buildSimpleGridOrders({
      direction,
      startPrice,
      currentPrice,
      gridSpacing,
    });
    const valuePerPoint = lotSize * contractSize;
    let totalFloatingPnL = 0;

    const rows = orders.map((order) => {
      const floatingPnL =
        direction === "buy"
          ? (currentPrice - order.entry) * valuePerPoint
          : (order.entry - currentPrice) * valuePerPoint;
      totalFloatingPnL += floatingPnL;

      return {
        ...order,
        direction,
        currentPrice,
        floatingPnL,
      };
    });

    const positions = orders.map((order) => ({
      entry: order.entry,
      lot: lotSize,
    }));
    const { weightedBreakEven } = calculateBreakEven(positions);
    const breakEven = Number.isFinite(weightedBreakEven) ? weightedBreakEven : NaN;

    return {
      rows,
      summary: {
        totalOrders: orders.length,
        breakEven,
        valuePerPoint,
        totalFloatingPnL,
        priceMoveToBreakEven: config.tpSign * (breakEven - currentPrice),
      },
    };
  }

  return {
    EPSILON,
    LOT_STEP,
    MIN_LOT,
    parseDecimal,
    parseInteger,
    parseNumberList,
    normalizeLot,
    validateOpenTradeCap,
    parsePositions,
    getDirectionConfig,
    calculateBreakEven,
    calculateBasketSnapshot,
    limitOpenPositions,
    lotForIteration,
    entryPriceForIteration,
    simulateScenario,
    runSimulationSet,
    analyzeBasket,
    buildDualGridOrders,
    calculateDualGridMtm,
    buildSimpleGridOrders,
    calculateSimpleGridMtm,
  };
});