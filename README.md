# Trade Basket Calculators

Browser-based trading calculators for three different basket models:

- `Martingale Suite`: scenario simulation plus live basket analysis with rolling FIFO cuts.
- `Dual Grid MTM`: a Python-matching downward buy ladder based on alternating `Grid B` then `Grid A` entries.
- `Simple Grid MTM`: a one-direction grid that adds one buy on every fixed fall or one sell on every fixed rise.

The app is fully local. It uses plain HTML, CSS, and JavaScript with no build step and no backend.

## Contents

- [What This App Does](#what-this-app-does)
- [Quick Start](#quick-start)
- [Calculator Overview](#calculator-overview)
- [Martingale Suite](#martingale-suite)
- [Dual Grid MTM](#dual-grid-mtm)
- [Simple Grid MTM](#simple-grid-mtm)
- [P/L Scaling and Sign Conventions](#pl-scaling-and-sign-conventions)
- [Exports](#exports)
- [Worked Examples](#worked-examples)
- [Project Structure](#project-structure)
- [Validation and Testing](#validation-and-testing)

## What This App Does

This workspace is meant to answer three different questions:

1. `Martingale Suite`: If I keep adding positions with a multiplier rule, where does my basket break-even move, what is my recovery level, and what happens if I cap open trades and cut the oldest ones?
2. `Dual Grid MTM`: If I follow the same order pattern as [dual_grid_mtm.py](dual_grid_mtm.py), what is the full ladder, the average break-even, and the floating mark-to-market at the current price?
3. `Simple Grid MTM`: If I buy or sell every fixed number of points, how many orders will be open, where is the weighted break-even, and what is the current floating P/L?

## Quick Start

### Run Locally

1. Open [index.html](index.html) in a browser.
2. Use the left sidebar to select one of the calculators.
3. Enter the inputs for that calculator.
4. Review the summary cards and detailed table.
5. If you are using the martingale tools, use the top-right buttons to export PDF or Excel reports.

### Run With Docker Compose

1. Make sure Docker Desktop or a compatible Docker engine is running.
2. From the project root, run `docker compose up --build`.
3. Open `http://localhost:8080`.
4. Stop the app with `docker compose down`.

The production container serves only the runtime assets with Nginx, adds security headers, exposes a `/healthz` endpoint, and applies cache rules for static JS/CSS/vendor files.

## Calculator Overview

| Calculator | Purpose | Direction Support | Key Output |
| --- | --- | --- | --- |
| `Martingale Suite` | Simulate averaging entries with lot multipliers and rolling position cuts | `buy`, `sell` | Break-even, recovery BE, TP, floating P/L, realized cut P/L |
| `Dual Grid MTM` | Reproduce the reference Python dual-grid ladder | Downward `buy` ladder | Total orders, BE, move to BE, floating P/L |
| `Simple Grid MTM` | Build a one-way fixed-step grid | `buy`, `sell` | Total orders, BE, points to BE, floating P/L |

## Martingale Suite

The martingale tools are split into two parts:

- `Scenario Simulator`: generate hypothetical baskets across multiple multipliers and step schedules.
- `Live Basket Analyzer`: analyze an already-open basket from manual positions.

### Scenario Simulator Inputs

- `Direction`: `buy` or `sell`.
- `Reference Price`: base anchor price before the first generated iteration.
- `Entry Spacing`: price distance between consecutive entries.
- `Base Lot`: the starting lot before multiplier rules are applied.
- `Iterations (X)`: number of generated entries after the reference price.
- `Keep Max Open Trades`: maximum number of active positions allowed before FIFO cuts are applied.
- `TP Distance From Break-Even`: target distance added to or subtracted from break-even.
- `Lot Multipliers`: one or more multiplier values such as `1.5, 2, 3`.
- `Increase After Every N Trades`: one or more schedule values such as `2, 3`.
- `USD P/L For $1 Move At 1.0 Lot`: the instrument-specific P/L scale.
- `Auto-cut the oldest trade whenever the basket exceeds the open-trade cap`: enables FIFO trimming.

### Scenario Generation Rules

- In `buy` mode, each generated entry moves down by `Entry Spacing`.
- In `sell` mode, each generated entry moves up by `Entry Spacing`.
- Iteration counting starts after the reference price.
- The lot multiplier is applied in blocks based on `Increase After Every N Trades`.
- Lots are normalized to the platform lot rules:
  - minimum lot is `0.01`
  - lots are rounded up to the next `0.01`
  - example: `0.015` becomes `0.02`

### Open-Trade Cap and FIFO Logic

When auto-cut is enabled:

- If the basket would exceed the configured open-trade cap, the oldest active trade is cut first.
- The basket is then evaluated with only the latest allowed positions still active.
- This is FIFO behavior.

Examples:

- keep `3` open -> cut on the `4th` trade
- keep `4` open -> cut on the `5th` trade
- keep `5` open -> cut on the `6th` trade

### Martingale Metrics

- `Break-even`: weighted average of the full opened trade sequence, even after FIFO cuts.
- `Recovery BE`: price required for the remaining active basket to recover realized cut P/L.
- `TP`: calculated from `Break-even`, not `Recovery BE`.
- `Floating P/L`: unrealized P/L of currently active trades only.
- `Current net P/L`: realized cut P/L plus current floating P/L.
- `Net if TP hits`: realized cut P/L plus the active basket P/L if price reaches TP.

### Martingale Core Formulas

Weighted break-even:

`breakEven = sum(entryPrice * lot) / sum(lot)`

Recovery break-even is derived from the active basket plus realized cut P/L:

- `buy`: `recoveryBE = activeWeightedBE + abs(realizedPnL) / (activeLot * pointValue)` when realized P/L is negative
- `sell`: same adjustment but in the favorable sell direction

TP is based on displayed break-even:

- `buy`: `tp = breakEven + tpDistance`
- `sell`: `tp = breakEven - tpDistance`

### Live Basket Analyzer

Use this when you already have open positions and want to see the current basket state.

Input format:

- one position per line
- use `price, lot` for standard decimal notation
- use `price; lot` if you use decimal commas

Examples:

```text
4104,0.10
4102,0.10
4100,0.15
```

```text
4104,5; 0,10
4102,5; 0,15
```

The analyzer applies the same FIFO cap logic used by the simulator.

## Dual Grid MTM

This calculator reproduces the behavior of [dual_grid_mtm.py](dual_grid_mtm.py).

### What It Models

- one initial order at `Start Price`
- then repeated downward steps
- each step adds two entries:
  - `Grid B` price first
  - `Grid A` price second

### Inputs

- `Start Price`: initial order price.
- `Current / End Price`: the price used to stop building the ladder and to mark all orders to market.
- `Grid A`: the rebound entry above the `Grid B` level.
- `Grid B`: the full downward step.
- `Lot Size`: lot per order.
- `Contract Size`: contract multiplier used for mark-to-market.

### Order Generation Rule

The ladder starts with one order at `Start Price`.

Then, while the next `Grid B` price is still within the end boundary:

1. add `price - Grid B`
2. add `(price - Grid B) + Grid A`
3. continue from the new `Grid B` price

The stop condition is:

`previousPrice - gridB >= currentPrice`

### Dual Grid Metrics

- `Total orders`: number of generated entries.
- `Break-even`: weighted average of all generated entries.
- `Move to break-even`: `breakEven - currentPrice`.
- `Floating P/L`: mark-to-market of the entire ladder at the current price.

### Dual Grid P/L Formula

`valuePerPoint = lotSize * contractSize`

`floatingPnL = sum((currentPrice - entry) * valuePerPoint)`

### Reference Example

Using the current Python reference setup:

- `Start Price = 5234`
- `Current / End Price = 5014`
- `Grid A = 4`
- `Grid B = 10`
- `Lot Size = 0.01`
- `Contract Size = 100`

Expected result:

- `Total orders = 45`
- `Break-even = 5123.5111`
- `Floating P/L = -4928.00`

## Simple Grid MTM

This calculator is the simplest one-way ladder in the app.

### What It Models

- one order at the start price
- one more order every fixed grid step
- all orders are in the same direction

There are two modes:

- `buy`: add a new buy every fixed fall
- `sell`: add a new sell every fixed rise

### Inputs

- `Direction`: `buy` or `sell`.
- `Start Price`: first order price.
- `Current / End Price`: price used to stop building the ladder and mark all orders to market.
- `Grid Spacing`: fixed step between new entries.
- `Lot Size`: lot per order.
- `Contract Size`: contract multiplier used for P/L scaling.

### Simple Grid Order Rules

In `buy` mode:

- start from `Start Price`
- add one order every `Grid Spacing` points downward
- stop when the next order would move below `Current / End Price`
- if `Current / End Price` lands exactly on a grid step, it is included

In `sell` mode:

- start from `Start Price`
- add one order every `Grid Spacing` points upward
- stop when the next order would move above `Current / End Price`
- if `Current / End Price` lands exactly on a grid step, it is included

### Simple Grid Metrics

- `Total orders`: number of generated ladder entries.
- `Break-even`: weighted average of all grid entries.
- `Points to break-even`: favorable-direction move needed to get from current price back to break-even.
- `Floating P/L`: mark-to-market of the whole ladder.

### Simple Grid P/L Formula

`valuePerPoint = lotSize * contractSize`

Buy ladder:

`floatingPnL = sum((currentPrice - entry) * valuePerPoint)`

Sell ladder:

`floatingPnL = sum((entry - currentPrice) * valuePerPoint)`

### Important Sign Convention

If price has moved against the ladder direction, floating P/L is negative.

Example:

- buy from `1000` down to `0`
- spacing `1`
- lot size `0.01`
- contract size `100`

This produces a floating value of `-500500.00`, not `+500500.00`, because the ladder is long and the current price is below all higher entries.

### Simple Grid Reference Example

Using:

- `Direction = buy`
- `Start Price = 1000`
- `Current / End Price = 0`
- `Grid Spacing = 1`
- `Lot Size = 0.01`
- `Contract Size = 100`

Expected result:

- `Total orders = 1001`
- `Break-even = 500`
- `Points to break-even = 500`
- `Floating P/L = -500500.00`

## P/L Scaling and Sign Conventions

The app uses two slightly different scaling ideas depending on calculator type.

### Martingale Suite

`USD P/L For $1 Move At 1.0 Lot` is a user-entered scale factor.

For example:

- if `0.01` lot makes about `$1` for a `$1` move
- then `1.0` lot makes about `$100` for a `$1` move
- so you should enter `100`

### Dual Grid and Simple Grid

These calculators compute their P/L scale directly:

`valuePerPoint = lotSize * contractSize`

Examples:

- `0.01 * 100 = 1`
- `0.10 * 100 = 10`
- `1.00 * 100 = 100`

### Interpreting P/L Signs

- positive value: basket is profitable at the current price
- negative value: basket is losing at the current price
- zero: current price matches the effective mark-to-market balance point for that row or basket

## Exports

PDF and Excel export libraries are bundled locally under [vendor](vendor).

Current export coverage:

- `Martingale Suite` scenario simulator: supported
- `Martingale Suite` live basket analyzer: supported
- `Dual Grid MTM`: not exported yet
- `Simple Grid MTM`: not exported yet

This is why the export status area is disabled when a non-martingale calculator is active.

## Worked Examples

### Martingale Cap Example

If you keep `3` open trades and a `4th` trade would be opened:

- the oldest active trade is cut
- realized P/L is updated
- the newest three trades remain active
- displayed break-even still uses the full opened sequence
- recovery break-even uses the active basket plus realized cut P/L

### Dual Grid Example

If the current Python reference uses `5234 -> 5014` with `Grid A = 4` and `Grid B = 10`:

- the ladder starts at `5234`
- the first added entries are `5224` and `5228`
- the last two entries are `5014` and `5018`
- total floating P/L is `-4928.00`

### Simple Grid Example

If you buy every `10` points from `5234` down to `5194` with `0.01` lot and `100` contract size:

- orders are `5234`, `5224`, `5214`, `5204`, `5194`
- break-even is `5214`
- points to break-even is `20`
- floating P/L is `-1.00`

## Project Structure

- [index.html](index.html): app shell and calculator forms
- [styles.css](styles.css): layout and theme
- [script.js](script.js): browser rendering, state, exports, and event handling
- [calculator-core.js](calculator-core.js): shared calculation engine
- [calculator-core.test.js](calculator-core.test.js): Node regression tests
- [smoke-test.html](smoke-test.html): lightweight browser smoke page
- [smoke-test.js](smoke-test.js): browser-side checks against the shared core
- [dual_grid_mtm.py](dual_grid_mtm.py): original Python reference used for the dual-grid calculator

## Validation and Testing

Shared logic is validated in two ways:

- Node tests in [calculator-core.test.js](calculator-core.test.js)
- browser smoke checks in [smoke-test.html](smoke-test.html)

Run the Node tests:

```bash
node --test calculator-core.test.js
```

Or:

```bash
npm test
```

Open the smoke page in a browser for a lightweight UI-independent sanity check:

- [smoke-test.html](smoke-test.html)

## Development Notes

- The app is static and has no build step.
- Core math is intentionally centralized in [calculator-core.js](calculator-core.js).
- The browser UI in [script.js](script.js) should render values rather than re-implement trading math.
- Production container image: [Dockerfile](Dockerfile)
- Compose entrypoint: [docker-compose.yml](docker-compose.yml)
- Static server config: [nginx.conf](nginx.conf)
- Only runtime assets are copied into the image; tests, the Python reference file, and local workspace folders are excluded from the Docker build context.
- If calculator behavior changes, update:
  - [calculator-core.js](calculator-core.js)
  - [calculator-core.test.js](calculator-core.test.js)
  - [smoke-test.js](smoke-test.js)
  - this README
