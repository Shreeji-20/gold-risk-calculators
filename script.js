const simulationOutput = document.getElementById("simulation-output");
const basketOutput = document.getElementById("basket-output");
const dualGridOutput = document.getElementById("dual-grid-output");
const simpleGridOutput = document.getElementById("simple-grid-output");
const emptyStateTemplate = document.getElementById("empty-state-template");
const simulatorForm = document.getElementById("simulator-form");
const basketForm = document.getElementById("basket-form");
const dualGridForm = document.getElementById("dual-grid-form");
const simpleGridForm = document.getElementById("simple-grid-form");
const exportPdfButton = document.getElementById("export-pdf");
const exportXlsxButton = document.getElementById("export-xlsx");
const exportStatus = document.getElementById("export-status");
const calculatorNavButtons = Array.from(document.querySelectorAll("[data-calculator-target]"));
const calculatorViews = Array.from(document.querySelectorAll("[data-calculator-view]"));

const core = window.MartingaleCore;
if (!core) {
  throw new Error("Martingale core failed to load.");
}

const {
  EPSILON,
  parseDecimal,
  parseInteger,
  parseNumberList,
  normalizeLot,
  validateOpenTradeCap,
  parsePositions,
  runSimulationSet,
  analyzeBasket,
  calculateDualGridMtm,
  calculateSimpleGridMtm,
} = core;

const EXPORT_FILE_STEM = "martingale-analysis";

let lastSimulationResults = [];
let lastSimulationConfig = null;
let lastBasketResult = null;
let lastBasketConfig = null;
let lastDualGridResult = null;
let lastDualGridConfig = null;
let lastSimpleGridResult = null;
let lastSimpleGridConfig = null;
let activeCalculatorId = "martingale";

function cloneEmptyState() {
  return emptyStateTemplate.content.cloneNode(true);
}

function number(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function money(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ordinal(value) {
  const numberValue = Math.trunc(value);
  const mod100 = numberValue % 100;

  if (mod100 >= 11 && mod100 <= 13) {
    return `${numberValue}th`;
  }

  switch (numberValue % 10) {
    case 1:
      return `${numberValue}st`;
    case 2:
      return `${numberValue}nd`;
    case 3:
      return `${numberValue}rd`;
    default:
      return `${numberValue}th`;
  }
}

function pnlClass(value) {
  if (value > EPSILON) {
    return "pnl-good";
  }
  if (value < -EPSILON) {
    return "pnl-bad";
  }
  return "pnl-warn";
}

function sanitizeSheetName(name) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function exportFileName(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${EXPORT_FILE_STEM}-${stamp}.${extension}`;
}

function setExportStatus(message, isError = false) {
  exportStatus.textContent = message;
  exportStatus.classList.toggle("is-error", isError);
}

function hasExportableData() {
  return activeCalculatorId === "martingale" && (lastSimulationResults.length > 0 || Boolean(lastBasketResult));
}

function syncExportStatus() {
  if (activeCalculatorId !== "martingale") {
    setExportStatus("Exports are currently available for the Martingale suite only.");
    return;
  }

  if (lastSimulationResults.length) {
    setExportStatus("Simulation is ready. You can download the full report as PDF or Excel.");
    return;
  }

  if (lastBasketResult) {
    setExportStatus("Basket analysis is ready. Export will include the current basket details.");
    return;
  }

  setExportStatus("Run a martingale simulation or basket analysis to unlock exports.");
}

function updateExportButtons() {
  const enabled = hasExportableData();
  exportPdfButton.disabled = !enabled;
  exportXlsxButton.disabled = !enabled;
}

function parseSimulationConfig(formData) {
  const direction = formData.get("direction");
  const firstEntryPrice = parseDecimal(formData.get("firstEntryPrice"), "first entry price");
  const entrySpacing = parseDecimal(formData.get("entrySpacing"), "entry spacing");
  const baseLot = normalizeLot(parseDecimal(formData.get("baseLot"), "base lot"), "base lot");
  const iterations = parseInteger(formData.get("iterations"), "iterations");
  const maxOpenTrades = validateOpenTradeCap(
    parseInteger(formData.get("maxOpenTrades"), "max open trades"),
    "max open trades"
  );
  const tpDistance = parseDecimal(formData.get("tpDistance"), "TP distance");
  const pointValue = parseDecimal(formData.get("valuePerPoint"), "value per point");
  const autoCut = formData.get("autoCut") === "on";
  const multipliers = parseNumberList(formData.get("multipliers"), "lot multipliers");
  const stepSchedules = parseNumberList(formData.get("stepSchedules"), "step schedules").map((value) =>
    parseInteger(value, "step schedule")
  );

  if (
    !Number.isFinite(firstEntryPrice) ||
    !Number.isFinite(entrySpacing) ||
    !Number.isFinite(baseLot) ||
    !Number.isFinite(iterations) ||
    !Number.isFinite(tpDistance) ||
    !Number.isFinite(pointValue) ||
    entrySpacing <= 0 ||
    baseLot <= 0 ||
    iterations < 1 ||
    maxOpenTrades < 1 ||
    tpDistance < 0 ||
    pointValue <= 0
  ) {
    throw new Error("Check the simulator inputs. Prices must be valid numbers and lots must be positive.");
  }

  return {
    direction,
    firstEntryPrice,
    entrySpacing,
    baseLot,
    iterations,
    maxOpenTrades,
    tpDistance,
    multipliers,
    stepSchedules,
    pointValue,
    autoCut,
  };
}

function parseBasketConfig(formData) {
  const direction = formData.get("direction");
  const currentPrice = parseDecimal(formData.get("currentPrice"), "current price");
  const maxOpenTrades = validateOpenTradeCap(
    parseInteger(formData.get("maxOpenTrades"), "max open trades"),
    "max open trades"
  );
  const tpDistance = parseDecimal(formData.get("tpDistance"), "TP distance");
  const pointValue = parseDecimal(formData.get("valuePerPoint"), "value per point");
  const positions = parsePositions(formData.get("positions"));

  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(tpDistance) ||
    !Number.isFinite(pointValue) ||
    maxOpenTrades < 1 ||
    pointValue <= 0 ||
    tpDistance < 0
  ) {
    throw new Error("Check the basket inputs. Current price and value per point must be valid.");
  }

  return {
    direction,
    currentPrice,
    maxOpenTrades,
    tpDistance,
    pointValue,
    positions,
  };
}

function parseDualGridConfig(formData) {
  return {
    startPrice: parseDecimal(formData.get("startPrice"), "start price"),
    currentPrice: parseDecimal(formData.get("currentPrice"), "current / end price"),
    gridA: parseDecimal(formData.get("gridA"), "Grid A"),
    gridB: parseDecimal(formData.get("gridB"), "Grid B"),
    lotSize: parseDecimal(formData.get("lotSize"), "lot size"),
    contractSize: parseDecimal(formData.get("contractSize"), "contract size"),
  };
}

function parseSimpleGridConfig(formData) {
  return {
    direction: formData.get("direction"),
    startPrice: parseDecimal(formData.get("startPrice"), "start price"),
    currentPrice: parseDecimal(formData.get("currentPrice"), "current / end price"),
    gridSpacing: parseDecimal(formData.get("gridSpacing"), "grid spacing"),
    lotSize: parseDecimal(formData.get("lotSize"), "lot size"),
    contractSize: parseDecimal(formData.get("contractSize"), "contract size"),
  };
}

function currentContextSummary() {
  const rows = [
    ["Generated", formatTimestamp()],
    ["Simulation scenarios", number(lastSimulationResults.length, 0)],
    ["Basket analysis", lastBasketResult ? "Included" : "Not included"],
  ];

  if (lastSimulationConfig) {
    rows.push(
      ["Simulation direction", lastSimulationConfig.direction],
      ["Reference price", number(lastSimulationConfig.firstEntryPrice)],
      ["Entry spacing", number(lastSimulationConfig.entrySpacing)],
      ["Base lot", number(lastSimulationConfig.baseLot, 2)],
      ["Iterations", number(lastSimulationConfig.iterations, 0)],
      ["Simulation max open trades", number(lastSimulationConfig.maxOpenTrades, 0)],
      ["TP distance", number(lastSimulationConfig.tpDistance)],
      ["Lot multipliers", lastSimulationConfig.multipliers.join(", ")],
      ["Increase every N trades", lastSimulationConfig.stepSchedules.join(", ")],
      ["USD P/L for $1 at 1.0 lot", number(lastSimulationConfig.pointValue, 2)],
      ["Auto-cut oldest trade on cap breach", lastSimulationConfig.autoCut ? "Yes" : "No"]
    );
  }

  if (lastBasketConfig) {
    rows.push(
      ["Basket direction", lastBasketConfig.direction],
      ["Basket current price", number(lastBasketConfig.currentPrice)],
      ["Basket max open trades", number(lastBasketConfig.maxOpenTrades, 0)],
      ["Basket TP distance", number(lastBasketConfig.tpDistance)],
      ["Basket USD P/L for $1 at 1.0 lot", number(lastBasketConfig.pointValue, 2)]
    );
  }

  return rows;
}

function buildSimulationSummarySheetRows() {
  const header = [
    "Scenario",
    "Multiplier",
    "Increase Every N Trades",
    "Max Open Trades",
    "Final Active Trades",
    "Final Active Lot",
    "Final Break-Even",
    "Final Recovery BE",
    "Final TP",
    "Final Floating P/L",
    "Final Current Net P/L",
    "Realized Cut P/L",
    "Net If TP Hits",
    "Worst Floating DD",
    "Total Cuts",
  ];

  const rows = lastSimulationResults.map((result) => [
    result.key,
    result.multiplier,
    result.everyNTrades,
    result.maxOpenTrades,
    result.summary.finalActiveTrades,
    result.summary.finalActiveLot,
    result.summary.finalBreakEven,
    result.summary.finalRecoveryBreakEven,
    result.summary.finalTpPrice,
    result.summary.finalFloatingPnL,
    result.summary.finalCurrentNetPnL,
    result.summary.totalRealizedPnL,
    result.summary.netAtTp,
    result.summary.maxFloatingDrawdown,
    result.summary.totalCuts,
  ]);

  return [header, ...rows];
}

function buildScenarioDetailSheetRows(result) {
  const header = [
    "Iteration",
    "Current Price",
    "New Entry",
    "New Lot Used",
    "Total Opened Lot",
    "Active Trades",
    "Active Lot",
    "Break-Even",
    "Recovery BE",
    "TP",
    "Cut Count",
    "Cut This Iteration",
    "Floating P/L",
    "Current Net P/L",
    "Cum. Realized Cut P/L",
    "Net If TP Hits",
    "Active Positions",
  ];

  const rows = result.rows.map((row) => [
    row.iteration,
    row.currentPrice,
    row.openedEntry,
    row.openedLot,
    row.totalOpenedLot,
    row.activeTrades,
    row.activeLot,
    row.breakEven,
    row.recoveryBreakEven,
    row.tpPrice,
    row.cutCount,
    cutsText(row.cutTrades),
    row.floatingPnL,
    row.currentNetPnL,
    row.cumulativeRealizedPnL,
    row.netAtTp,
    activePositionsText(row.activePositions),
  ]);

  if (result.tpScenario) {
    rows.push([
      "TP Hit",
      result.tpScenario.tpPrice,
      "",
      "",
      result.summary.totalOpenedLot,
      result.tpScenario.activeTradesClosedAtTp,
      result.summary.finalActiveLot,
      result.summary.finalBreakEven,
      result.summary.finalRecoveryBreakEven,
      result.tpScenario.tpPrice,
      0,
      "Close remaining basket at TP",
      result.summary.finalFloatingPnL,
      result.summary.finalCurrentNetPnL,
      result.summary.totalRealizedPnL,
      result.tpScenario.finalNetAtTp,
      activePositionsText(result.tpScenario.activePositionsAtTp),
    ]);
  }

  return [header, ...rows];
}

function buildBasketSummaryRows() {
  if (!lastBasketResult) {
    return [["Status", "No basket analysis available"]];
  }

  return [
    ["Metric", "Value"],
    ["Open-trade cap", lastBasketConfig?.maxOpenTrades ?? "-"],
    ["Active trades", lastBasketResult.activePositions.length],
    ["Active lot", lastBasketResult.snapshot.totalLot],
    ["Break-Even", lastBasketResult.snapshot.breakEven],
    ["Recovery BE incl. cut P/L", lastBasketResult.snapshot.recoveryBreakEven],
    ["TP", lastBasketResult.snapshot.tpPrice],
    ["Floating P/L", lastBasketResult.snapshot.floatingPnL],
    ["Current net P/L", lastBasketResult.snapshot.netCurrentPnL],
    ["Active basket P/L at TP", lastBasketResult.snapshot.activeProfitAtTp],
    ["Realized cut P/L", lastBasketResult.totalRealizedPnL],
    ["Net if TP hits", lastBasketResult.snapshot.netAtTp],
  ];
}

function buildBasketPositionsRows(title, positions) {
  const rows = [["Section", title], ["Entry", "Lot", "Cut Price", "Cut P/L"]];

  if (!positions.length) {
    rows.push(["none", "", "", ""]);
    return rows;
  }

  positions.forEach((position) => {
    rows.push([
      position.entry,
      position.lot,
      position.cutPrice ?? "",
      position.cutPnL ?? "",
    ]);
  });

  return rows;
}

function dualGridLegLabel(leg) {
  switch (leg) {
    case "grid-b":
      return "Grid B";
    case "grid-a":
      return "Grid A";
    default:
      return "Initial";
  }
}

function directionLabel(direction) {
  return direction === "sell" ? "Sell" : "Buy";
}

function exportToExcel() {
  if (!window.XLSX) {
    throw new Error("Excel export library failed to load. Check your internet connection and reload the page.");
  }

  const workbook = window.XLSX.utils.book_new();
  const contextSheet = window.XLSX.utils.aoa_to_sheet(currentContextSummary());
  window.XLSX.utils.book_append_sheet(workbook, contextSheet, "Overview");

  if (lastSimulationResults.length) {
    const summarySheet = window.XLSX.utils.aoa_to_sheet(buildSimulationSummarySheetRows());
    window.XLSX.utils.book_append_sheet(workbook, summarySheet, "Scenario Summary");

    lastSimulationResults.forEach((result) => {
      const detailSheet = window.XLSX.utils.aoa_to_sheet(buildScenarioDetailSheetRows(result));
      const sheetName = sanitizeSheetName(`Scenario ${result.multiplier}x ${result.everyNTrades}`);
      window.XLSX.utils.book_append_sheet(workbook, detailSheet, sheetName);
    });
  }

  if (lastBasketResult) {
    const basketSheet = window.XLSX.utils.aoa_to_sheet(buildBasketSummaryRows());
    window.XLSX.utils.book_append_sheet(workbook, basketSheet, "Basket Summary");

    const activeSheet = window.XLSX.utils.aoa_to_sheet(
      buildBasketPositionsRows("Active Positions", lastBasketResult.activePositions)
    );
    window.XLSX.utils.book_append_sheet(workbook, activeSheet, "Basket Active");

    const cutsSheet = window.XLSX.utils.aoa_to_sheet(
      buildBasketPositionsRows("Cut Positions", lastBasketResult.cutTrades)
    );
    window.XLSX.utils.book_append_sheet(workbook, cutsSheet, "Basket Cuts");
  }

  window.XLSX.writeFile(workbook, exportFileName("xlsx"));
}

function pdfAddSectionTitle(doc, title) {
  let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 28 : 72;
  if (y > doc.internal.pageSize.getHeight() - 80) {
    doc.addPage();
    y = 54;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 40, y);
  return y;
}

function exportToPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("PDF export library failed to load. Check your internet connection and reload the page.");
  }

  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  if (typeof doc.autoTable !== "function") {
    throw new Error("PDF table plugin failed to load. Check your internet connection and reload the page.");
  }
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(8, 14, 24);
  doc.rect(0, 0, pageWidth, 78, "F");
  doc.setTextColor(231, 237, 247);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Martingale Basket Analysis", 40, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated ${formatTimestamp()}`, 40, 64);

  doc.autoTable({
    startY: 92,
    head: [["Context", "Value"]],
    body: currentContextSummary(),
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 6, fillColor: [13, 19, 31], textColor: [231, 237, 247], lineColor: [52, 74, 107] },
    headStyles: { fillColor: [24, 147, 209], textColor: [239, 249, 255] },
    alternateRowStyles: { fillColor: [10, 15, 24] },
    margin: { left: 40, right: 40 },
  });

  if (lastSimulationResults.length) {
    const summaryTitleY = pdfAddSectionTitle(doc, "Scenario Summary");
    doc.autoTable({
      startY: summaryTitleY + 10,
      head: [buildSimulationSummarySheetRows()[0]],
      body: buildSimulationSummarySheetRows().slice(1),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 5, fillColor: [13, 19, 31], textColor: [231, 237, 247], lineColor: [52, 74, 107] },
      headStyles: { fillColor: [24, 147, 209], textColor: [239, 249, 255] },
      alternateRowStyles: { fillColor: [10, 15, 24] },
      margin: { left: 40, right: 40 },
    });

    lastSimulationResults.forEach((result) => {
      doc.addPage();
      doc.setFillColor(8, 14, 24);
      doc.rect(0, 0, pageWidth, 58, "F");
      doc.setTextColor(231, 237, 247);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`Scenario ${result.multiplier}x | every ${result.everyNTrades} trades`, 40, 36);

      doc.autoTable({
        startY: 76,
        head: [buildScenarioDetailSheetRows(result)[0]],
        body: buildScenarioDetailSheetRows(result).slice(1),
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 4, fillColor: [13, 19, 31], textColor: [231, 237, 247], lineColor: [52, 74, 107], overflow: "linebreak" },
        headStyles: { fillColor: [24, 147, 209], textColor: [239, 249, 255] },
        alternateRowStyles: { fillColor: [10, 15, 24] },
        margin: { left: 24, right: 24 },
      });
    });
  }

  if (lastBasketResult) {
    doc.addPage();
    doc.setFillColor(8, 14, 24);
    doc.rect(0, 0, pageWidth, 58, "F");
    doc.setTextColor(231, 237, 247);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Basket Analysis", 40, 36);

    doc.autoTable({
      startY: 76,
      head: [buildBasketSummaryRows()[0]],
      body: buildBasketSummaryRows().slice(1),
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, fillColor: [13, 19, 31], textColor: [231, 237, 247], lineColor: [52, 74, 107] },
      headStyles: { fillColor: [24, 147, 209], textColor: [239, 249, 255] },
      alternateRowStyles: { fillColor: [10, 15, 24] },
      margin: { left: 40, right: 40 },
    });

    const activeTitleY = pdfAddSectionTitle(doc, "Active Positions");
    doc.autoTable({
      startY: activeTitleY + 10,
      head: [buildBasketPositionsRows("Active Positions", lastBasketResult.activePositions)[1]],
      body: buildBasketPositionsRows("Active Positions", lastBasketResult.activePositions).slice(2),
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, fillColor: [13, 19, 31], textColor: [231, 237, 247], lineColor: [52, 74, 107] },
      headStyles: { fillColor: [24, 147, 209], textColor: [239, 249, 255] },
      alternateRowStyles: { fillColor: [10, 15, 24] },
      margin: { left: 40, right: 40 },
    });

    const cutsTitleY = pdfAddSectionTitle(doc, "Cut Positions");
    doc.autoTable({
      startY: cutsTitleY + 10,
      head: [buildBasketPositionsRows("Cut Positions", lastBasketResult.cutTrades)[1]],
      body: buildBasketPositionsRows("Cut Positions", lastBasketResult.cutTrades).slice(2),
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5, fillColor: [13, 19, 31], textColor: [231, 237, 247], lineColor: [52, 74, 107] },
      headStyles: { fillColor: [24, 147, 209], textColor: [239, 249, 255] },
      alternateRowStyles: { fillColor: [10, 15, 24] },
      margin: { left: 40, right: 40 },
    });
  }

  doc.save(exportFileName("pdf"));
}

function summaryCard(title, metrics) {
  const card = document.createElement("article");
  card.className = "summary-card";
  card.innerHTML = `
    <h3>${title}</h3>
    ${metrics
      .map(
        (metric) => `
          <div class="metric">
            <span class="metric-name">${metric.name}</span>
            <span class="metric-value ${metric.className || ""}">${metric.value}</span>
          </div>
        `
      )
      .join("")}
  `;
  return card;
}

function buildSummary(results) {
  const grid = document.createElement("div");
  grid.className = "summary-grid";

  results.forEach((result) => {
    grid.append(
      summaryCard(`${result.multiplier}x | every ${result.everyNTrades}`, [
        { name: "Open-trade cap", value: number(result.maxOpenTrades, 0) },
        { name: "Final active trades", value: number(result.summary.finalActiveTrades, 0) },
        { name: "Last price", value: number(result.summary.finalCurrentPrice) },
        { name: "Final active lot", value: number(result.summary.finalActiveLot) },
        { name: "Break-even", value: number(result.summary.finalBreakEven) },
        { name: "Recovery BE", value: number(result.summary.finalRecoveryBreakEven) },
        { name: "Final TP", value: number(result.summary.finalTpPrice) },
        {
          name: "Move to TP",
          value: number(result.summary.tpScenario?.priceMoveToTp),
          className: pnlClass(result.summary.tpScenario?.additionalPnLToTp),
        },
        {
          name: "Floating P/L",
          value: money(result.summary.finalFloatingPnL),
          className: pnlClass(result.summary.finalFloatingPnL),
        },
        {
          name: "Current net P/L",
          value: money(result.summary.finalCurrentNetPnL),
          className: pnlClass(result.summary.finalCurrentNetPnL),
        },
        {
          name: "Realized cut P/L",
          value: money(result.summary.totalRealizedPnL),
          className: pnlClass(result.summary.totalRealizedPnL),
        },
        {
          name: "Net if TP hits now",
          value: money(result.summary.netAtTp),
          className: pnlClass(result.summary.netAtTp),
        },
        {
          name: "Worst floating DD",
          value: money(result.summary.maxFloatingDrawdown),
          className: pnlClass(result.summary.maxFloatingDrawdown),
        },
        { name: "Total cuts", value: number(result.summary.totalCuts, 0) },
      ])
    );
  });

  return grid;
}

function cutsText(cutTrades) {
  if (!cutTrades.length) {
    return "none";
  }

  return cutTrades
    .map((trade) => `${number(trade.entry)} @ ${number(trade.lot)} (${money(trade.cutPnL)})`)
    .join(" | ");
}

function activePositionsText(activePositions) {
  if (!activePositions.length) {
    return "none";
  }

  return activePositions.map((trade) => `${number(trade.entry)} @ ${number(trade.lot)}`).join(" | ");
}

function buildTpScenarioPanel(result) {
  if (!result.tpScenario) {
    return document.createElement("div");
  }

  const panel = document.createElement("div");
  panel.className = "tp-scenario-grid";
  panel.append(
    summaryCard("If TP Hits From Last Iteration", [
      { name: "Last price", value: number(result.tpScenario.currentPrice) },
      { name: "TP price", value: number(result.tpScenario.tpPrice) },
      { name: "Price move to TP", value: number(result.tpScenario.priceMoveToTp) },
      {
        name: "Current net P/L",
        value: money(result.tpScenario.currentNetPnL),
        className: pnlClass(result.tpScenario.currentNetPnL),
      },
      {
        name: "Additional P/L to TP",
        value: money(result.tpScenario.additionalPnLToTp),
        className: pnlClass(result.tpScenario.additionalPnLToTp),
      },
      {
        name: "Final net at TP",
        value: money(result.tpScenario.finalNetAtTp),
        className: pnlClass(result.tpScenario.finalNetAtTp),
      },
      {
        name: "Trades closed at TP",
        value: number(result.tpScenario.activeTradesClosedAtTp, 0),
      },
    ])
  );
  return panel;
}

function buildScenarioTable(result) {
  const block = document.createElement("section");
  block.className = "scenario-block";

  const head = document.createElement("div");
  head.className = "scenario-head";
  head.innerHTML = `
    <div>
      <h3>${result.multiplier}x multiplier, increase every ${result.everyNTrades} trades</h3>
      <p>Per-iteration basket state after opening the newest trade and enforcing a ${result.maxOpenTrades}-trade open-position cap.</p>
    </div>
    <div class="badge-row">
      <span class="badge">Cap ${number(result.maxOpenTrades, 0)} trades</span>
      <span class="badge">Final BE ${number(result.summary.finalBreakEven)}</span>
      <span class="badge">Recovery BE ${number(result.summary.finalRecoveryBreakEven)}</span>
      <span class="badge">Final TP ${number(result.summary.finalTpPrice)}</span>
      <span class="badge ${pnlClass(result.summary.netAtTp)}">Net @ TP ${money(result.summary.netAtTp)}</span>
    </div>
  `;

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Iter</th>
        <th>Current Price</th>
        <th>New Entry</th>
        <th>New Lot</th>
        <th>Total Opened Lot</th>
        <th>Active Trades</th>
        <th>Active Lot</th>
        <th>Break-Even</th>
        <th>Recovery BE</th>
        <th>TP</th>
        <th>Cut Count</th>
        <th>Cut This Iteration</th>
        <th>Floating P/L</th>
        <th>Current Net P/L</th>
        <th>Cum. Realized Cut P/L</th>
        <th>Net If TP Hits</th>
        <th>Active Positions</th>
      </tr>
    </thead>
    <tbody>
      ${result.rows
        .map(
          (row) => `
            <tr>
              <td>${number(row.iteration, 0)}</td>
              <td>${number(row.currentPrice)}</td>
              <td>${number(row.openedEntry)}</td>
              <td>${number(row.openedLot)}</td>
              <td>${number(row.totalOpenedLot)}</td>
              <td>${number(row.activeTrades, 0)}</td>
              <td>${number(row.activeLot)}</td>
              <td>${number(row.breakEven)}</td>
              <td>${number(row.recoveryBreakEven)}</td>
              <td>${number(row.tpPrice)}</td>
              <td>${number(row.cutCount, 0)}</td>
              <td>${cutsText(row.cutTrades)}</td>
              <td class="${pnlClass(row.floatingPnL)}">${money(row.floatingPnL)}</td>
              <td class="${pnlClass(row.currentNetPnL)}">${money(row.currentNetPnL)}</td>
              <td class="${pnlClass(row.cumulativeRealizedPnL)}">${money(row.cumulativeRealizedPnL)}</td>
              <td class="${pnlClass(row.netAtTp)}">${money(row.netAtTp)}</td>
              <td>${activePositionsText(row.activePositions)}</td>
            </tr>
          `
        )
        .join("")}
      ${
        result.tpScenario
          ? `
            <tr class="scenario-highlight-row">
              <td>TP Hit</td>
              <td>${number(result.tpScenario.tpPrice)}</td>
              <td>-</td>
              <td>-</td>
              <td>${number(result.summary.totalOpenedLot)}</td>
              <td>${number(result.tpScenario.activeTradesClosedAtTp, 0)}</td>
              <td>${number(result.summary.finalActiveLot)}</td>
              <td>${number(result.summary.finalBreakEven)}</td>
              <td>${number(result.summary.finalRecoveryBreakEven)}</td>
              <td>${number(result.tpScenario.tpPrice)}</td>
              <td>0</td>
              <td>Close remaining basket at TP</td>
              <td class="${pnlClass(result.summary.finalFloatingPnL)}">${money(result.summary.finalFloatingPnL)}</td>
              <td class="${pnlClass(result.summary.finalCurrentNetPnL)}">${money(result.summary.finalCurrentNetPnL)}</td>
              <td class="${pnlClass(result.summary.totalRealizedPnL)}">${money(result.summary.totalRealizedPnL)}</td>
              <td class="${pnlClass(result.tpScenario.finalNetAtTp)}">${money(result.tpScenario.finalNetAtTp)}</td>
              <td>${activePositionsText(result.tpScenario.activePositionsAtTp)}</td>
            </tr>
          `
          : ""
      }
    </tbody>
  `;

  tableWrap.append(table);
  block.append(head, buildTpScenarioPanel(result), tableWrap);
  return block;
}

function renderSimulation(results) {
  simulationOutput.replaceChildren();

  if (!results.length) {
    simulationOutput.append(cloneEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();
  fragment.append(buildSummary(results));

  const note = document.createElement("div");
  note.className = "note-block";
  const cap = results[0].maxOpenTrades;
  const triggerTrade = cap + 1;
  note.innerHTML = results[0].autoCut
    ? `
      <p>
        Rolling trade rule used here: once a <strong>${ordinal(triggerTrade)}</strong> position would open, the <strong>oldest</strong> open position is cut immediately,
        so the basket always keeps only <strong>${number(cap, 0)} open trades</strong>. Lots are rounded <strong>up</strong> to the nearest <strong>0.01</strong>
        with a minimum lot of <strong>0.01</strong>. For gold, if <strong>0.01 lot</strong> makes about <strong>$1</strong> on a <strong>$1</strong>
        move, use <strong>100</strong> in the P/L scaling field. <strong>Break-even</strong> keeps the full opened-trade sequence in the average even after oldest trades are cut,
        while <strong>Recovery BE</strong> shows the price needed for the remaining active basket to recover realized cut P/L. TP is calculated from <strong>Break-even</strong>.
      </p>
    `
    : `
      <p>
        Oldest-trade cutting is disabled in this run, so the simulator keeps every trade open instead of enforcing the ${number(cap, 0)}-position cap.
      </p>
    `;
  fragment.append(note);

  results.forEach((result) => {
    fragment.append(buildScenarioTable(result));
  });

  simulationOutput.append(fragment);
}

function renderBasket(result) {
  basketOutput.replaceChildren();

  const wrapper = document.createElement("div");
  wrapper.className = "summary-grid";

  wrapper.append(
    summaryCard("Basket Summary", [
      { name: "Open-trade cap", value: number(lastBasketConfig?.maxOpenTrades, 0) },
      { name: "Active trades", value: number(result.activePositions.length, 0) },
      { name: "Active lot", value: number(result.snapshot.totalLot) },
      { name: "Break-even", value: number(result.snapshot.breakEven) },
      { name: "Recovery BE", value: number(result.snapshot.recoveryBreakEven) },
      { name: "TP", value: number(result.snapshot.tpPrice) },
      {
        name: "Floating P/L",
        value: money(result.snapshot.floatingPnL),
        className: pnlClass(result.snapshot.floatingPnL),
      },
      {
        name: "Current net P/L",
        value: money(result.snapshot.netCurrentPnL),
        className: pnlClass(result.snapshot.netCurrentPnL),
      },
      {
        name: "Realized cut P/L",
        value: money(result.totalRealizedPnL),
        className: pnlClass(result.totalRealizedPnL),
      },
      {
        name: "Net if TP hits",
        value: money(result.snapshot.netAtTp),
        className: pnlClass(result.snapshot.netAtTp),
      },
    ])
  );

  const cutsCard = summaryCard("Cut Decisions", [
    { name: "Trades cut", value: number(result.cutTrades.length, 0) },
    { name: "Cut to reach cap", value: number(lastBasketConfig?.maxOpenTrades, 0) },
    { name: "Cut details", value: cutsText(result.cutTrades) },
    { name: "Active positions", value: activePositionsText(result.activePositions) },
  ]);

  wrapper.append(cutsCard);
  basketOutput.append(wrapper);
}

function buildDualGridTable(result) {
  const block = document.createElement("section");
  block.className = "scenario-block grid-mtm-block";

  const head = document.createElement("div");
  head.className = "scenario-head";
  head.innerHTML = `
    <div>
      <h3>Dual-grid order ladder</h3>
      <p>Orders are generated in the same sequence as dual_grid_mtm.py: initial order, then Grid B, then Grid A for each downward step.</p>
    </div>
    <div class="badge-row">
      <span class="badge">Orders ${number(result.summary.totalOrders, 0)}</span>
      <span class="badge">BE ${number(result.summary.breakEven)}</span>
      <span class="badge">Move to BE ${number(result.summary.priceMoveToBreakEven)}</span>
      <span class="badge ${pnlClass(result.summary.totalFloatingPnL)}">Floating P/L ${money(result.summary.totalFloatingPnL)}</span>
    </div>
  `;

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Order</th>
        <th>Step</th>
        <th>Leg</th>
        <th>Entry</th>
        <th>Current Price</th>
        <th>Floating P/L</th>
      </tr>
    </thead>
    <tbody>
      ${result.rows
        .map(
          (row) => `
            <tr>
              <td>${number(row.sequence, 0)}</td>
              <td>${row.step ? number(row.step, 0) : "Start"}</td>
              <td>${dualGridLegLabel(row.leg)}</td>
              <td>${number(row.entry)}</td>
              <td>${number(row.currentPrice)}</td>
              <td class="${pnlClass(row.floatingPnL)}">${money(row.floatingPnL)}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  tableWrap.append(table);
  block.append(head, tableWrap);
  return block;
}

function buildSimpleGridTable(result) {
  const block = document.createElement("section");
  block.className = "scenario-block grid-mtm-block";

  const head = document.createElement("div");
  head.className = "scenario-head";
  head.innerHTML = `
    <div>
      <h3>Simple-grid order ladder</h3>
      <p>One order is placed at the start price, then another order is added every fixed grid step until the current price boundary is reached.</p>
    </div>
    <div class="badge-row">
      <span class="badge">${directionLabel(lastSimpleGridConfig?.direction)}</span>
      <span class="badge">Orders ${number(result.summary.totalOrders, 0)}</span>
      <span class="badge">BE ${number(result.summary.breakEven)}</span>
      <span class="badge">Points to BE ${number(result.summary.priceMoveToBreakEven)}</span>
      <span class="badge ${pnlClass(result.summary.totalFloatingPnL)}">Floating P/L ${money(result.summary.totalFloatingPnL)}</span>
    </div>
  `;

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Order</th>
        <th>Step</th>
        <th>Direction</th>
        <th>Entry</th>
        <th>Current Price</th>
        <th>Floating P/L</th>
      </tr>
    </thead>
    <tbody>
      ${result.rows
        .map(
          (row) => `
            <tr>
              <td>${number(row.sequence, 0)}</td>
              <td>${row.step ? number(row.step, 0) : "Start"}</td>
              <td>${directionLabel(row.direction)}</td>
              <td>${number(row.entry)}</td>
              <td>${number(row.currentPrice)}</td>
              <td class="${pnlClass(row.floatingPnL)}">${money(row.floatingPnL)}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  tableWrap.append(table);
  block.append(head, tableWrap);
  return block;
}

function renderDualGrid(result) {
  dualGridOutput.replaceChildren();

  if (!result?.rows?.length) {
    dualGridOutput.append(cloneEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();
  const summary = document.createElement("div");
  summary.className = "summary-grid";

  summary.append(
    summaryCard("Dual Grid Setup", [
      { name: "Start price", value: number(lastDualGridConfig?.startPrice) },
      { name: "Current / end price", value: number(lastDualGridConfig?.currentPrice) },
      { name: "Grid A", value: number(lastDualGridConfig?.gridA) },
      { name: "Grid B", value: number(lastDualGridConfig?.gridB) },
      { name: "Lot size", value: number(lastDualGridConfig?.lotSize, 2) },
      { name: "Contract size", value: number(lastDualGridConfig?.contractSize, 2) },
    ]),
    summaryCard("MTM Summary", [
      { name: "Total orders", value: number(result.summary.totalOrders, 0) },
      { name: "Value per point", value: number(result.summary.valuePerPoint, 2) },
      { name: "Break-even", value: number(result.summary.breakEven) },
      { name: "Move to break-even", value: number(result.summary.priceMoveToBreakEven) },
      {
        name: "Floating P/L",
        value: money(result.summary.totalFloatingPnL),
        className: pnlClass(result.summary.totalFloatingPnL),
      },
    ])
  );

  const note = document.createElement("div");
  note.className = "note-block";
  note.innerHTML = `
    <p>
      This view mirrors <strong>dual_grid_mtm.py</strong>: the ladder starts with one buy at the start price, then each cycle adds the <strong>Grid B</strong>
      price first and the <strong>Grid A</strong> price second until the current/end price boundary is reached.
    </p>
  `;

  fragment.append(summary, note, buildDualGridTable(result));
  dualGridOutput.append(fragment);
}

function renderSimpleGrid(result) {
  simpleGridOutput.replaceChildren();

  if (!result?.rows?.length) {
    simpleGridOutput.append(cloneEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();
  const summary = document.createElement("div");
  summary.className = "summary-grid";

  summary.append(
    summaryCard("Simple Grid Setup", [
      { name: "Direction", value: directionLabel(lastSimpleGridConfig?.direction) },
      { name: "Start price", value: number(lastSimpleGridConfig?.startPrice) },
      { name: "Current / end price", value: number(lastSimpleGridConfig?.currentPrice) },
      { name: "Grid spacing", value: number(lastSimpleGridConfig?.gridSpacing) },
      { name: "Lot size", value: number(lastSimpleGridConfig?.lotSize, 2) },
      { name: "Contract size", value: number(lastSimpleGridConfig?.contractSize, 2) },
    ]),
    summaryCard("MTM Summary", [
      { name: "Total orders", value: number(result.summary.totalOrders, 0) },
      { name: "Value per point", value: number(result.summary.valuePerPoint, 2) },
      { name: "Break-even", value: number(result.summary.breakEven) },
      { name: "Points to break-even", value: number(result.summary.priceMoveToBreakEven) },
      {
        name: "Floating P/L",
        value: money(result.summary.totalFloatingPnL),
        className: pnlClass(result.summary.totalFloatingPnL),
      },
    ])
  );

  const note = document.createElement("div");
  note.className = "note-block";
  note.innerHTML = `
    <p>
      For a <strong>${directionLabel(lastSimpleGridConfig?.direction)}</strong> simple grid, one order is placed at the start price and a new order is added
      every <strong>${number(lastSimpleGridConfig?.gridSpacing)}</strong> points ${lastSimpleGridConfig?.direction === "sell" ? "up" : "down"}
      until the current price boundary is reached.
    </p>
  `;

  fragment.append(summary, note, buildSimpleGridTable(result));
  simpleGridOutput.append(fragment);
}

function showBasketError(message) {
  basketOutput.replaceChildren();
  const card = document.createElement("div");
  card.className = "message-card error";
  card.textContent = message;
  basketOutput.append(card);
}

function showDualGridError(message) {
  dualGridOutput.replaceChildren();
  const card = document.createElement("div");
  card.className = "message-card error";
  card.textContent = message;
  dualGridOutput.append(card);
}

function showSimpleGridError(message) {
  simpleGridOutput.replaceChildren();
  const card = document.createElement("div");
  card.className = "message-card error";
  card.textContent = message;
  simpleGridOutput.append(card);
}

function runSimulation(formData) {
  const config = parseSimulationConfig(formData);
  const results = runSimulationSet(config);

  return {
    config,
    results,
  };
}

function runBasketAnalysis(formData) {
  const config = parseBasketConfig(formData);

  return {
    config,
    result: analyzeBasket(config),
  };
}

function runDualGridAnalysis(formData) {
  const config = parseDualGridConfig(formData);

  return {
    config,
    result: calculateDualGridMtm(config),
  };
}

function runSimpleGridAnalysis(formData) {
  const config = parseSimpleGridConfig(formData);

  return {
    config,
    result: calculateSimpleGridMtm(config),
  };
}

function setActiveCalculator(calculatorId) {
  activeCalculatorId = calculatorId;

  calculatorViews.forEach((view) => {
    view.hidden = view.dataset.calculatorView !== calculatorId;
  });

  calculatorNavButtons.forEach((button) => {
    const isActive = button.dataset.calculatorTarget === calculatorId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  updateExportButtons();
  syncExportStatus();
}

calculatorNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveCalculator(button.dataset.calculatorTarget);
  });
});

simulatorForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const formData = new FormData(event.currentTarget);
    const { config, results } = runSimulation(formData);
    lastSimulationConfig = config;
    lastSimulationResults = results;
    renderSimulation(results);
    updateExportButtons();
    if (activeCalculatorId === "martingale") {
      setExportStatus("Simulation is ready. You can download the full report as PDF or Excel.");
    }
  } catch (error) {
    lastSimulationConfig = null;
    lastSimulationResults = [];
    simulationOutput.replaceChildren();
    const card = document.createElement("div");
    card.className = "message-card error";
    card.textContent = error.message;
    simulationOutput.append(card);
    updateExportButtons();
    if (activeCalculatorId === "martingale") {
      syncExportStatus();
    }
  }
});

basketForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const formData = new FormData(event.currentTarget);
    const { config, result } = runBasketAnalysis(formData);
    lastBasketConfig = config;
    lastBasketResult = result;
    renderBasket(result);
    updateExportButtons();
    if (activeCalculatorId === "martingale") {
      setExportStatus("Basket analysis is ready. Export will include the current basket details.");
    }
  } catch (error) {
    lastBasketConfig = null;
    lastBasketResult = null;
    showBasketError(error.message);
    updateExportButtons();
    if (activeCalculatorId === "martingale") {
      syncExportStatus();
    }
  }
});

dualGridForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const formData = new FormData(event.currentTarget);
    const { config, result } = runDualGridAnalysis(formData);
    lastDualGridConfig = config;
    lastDualGridResult = result;
    renderDualGrid(result);
    updateExportButtons();
    if (activeCalculatorId === "dual-grid") {
      setExportStatus("Dual-grid MTM updated. Exports remain available for the Martingale suite only.");
    }
  } catch (error) {
    lastDualGridConfig = null;
    lastDualGridResult = null;
    showDualGridError(error.message);
    updateExportButtons();
    if (activeCalculatorId === "dual-grid") {
      setExportStatus("Exports are currently available for the Martingale suite only.");
    }
  }
});

simpleGridForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const formData = new FormData(event.currentTarget);
    const { config, result } = runSimpleGridAnalysis(formData);
    lastSimpleGridConfig = config;
    lastSimpleGridResult = result;
    renderSimpleGrid(result);
    updateExportButtons();
    if (activeCalculatorId === "simple-grid") {
      setExportStatus("Simple-grid MTM updated. Exports remain available for the Martingale suite only.");
    }
  } catch (error) {
    lastSimpleGridConfig = null;
    lastSimpleGridResult = null;
    showSimpleGridError(error.message);
    updateExportButtons();
    if (activeCalculatorId === "simple-grid") {
      setExportStatus("Exports are currently available for the Martingale suite only.");
    }
  }
});

exportXlsxButton.addEventListener("click", () => {
  try {
    exportToExcel();
    setExportStatus("Excel report downloaded.");
  } catch (error) {
    setExportStatus(error.message, true);
  }
});

exportPdfButton.addEventListener("click", () => {
  try {
    exportToPdf();
    setExportStatus("PDF report downloaded.");
  } catch (error) {
    setExportStatus(error.message, true);
  }
});

renderSimulation([]);

try {
  const initialBasket = runBasketAnalysis(new FormData(basketForm));
  lastBasketConfig = initialBasket.config;
  lastBasketResult = initialBasket.result;
  renderBasket(initialBasket.result);
  updateExportButtons();
} catch (error) {
  showBasketError(error.message);
}

try {
  const initialDualGrid = runDualGridAnalysis(new FormData(dualGridForm));
  lastDualGridConfig = initialDualGrid.config;
  lastDualGridResult = initialDualGrid.result;
  renderDualGrid(initialDualGrid.result);
} catch (error) {
  showDualGridError(error.message);
}

try {
  const initialSimpleGrid = runSimpleGridAnalysis(new FormData(simpleGridForm));
  lastSimpleGridConfig = initialSimpleGrid.config;
  lastSimpleGridResult = initialSimpleGrid.result;
  renderSimpleGrid(initialSimpleGrid.result);
} catch (error) {
  showSimpleGridError(error.message);
}

setActiveCalculator(activeCalculatorId);
