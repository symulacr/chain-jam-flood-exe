// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICasinoGameV2, SessionContext, SessionPhase, StepResult} from "./ICasinoGameV2.sol";

/**
 * FLOOD.EXE — the paint bucket, as an on-chain casino game.
 *
 * One wager, one VRF word, one flood.
 *
 *   The word paints a 12x12 canvas with two colours (one bit per cell) and picks a
 *   start cell. The paint floods out from the start cell through every 4-connected
 *   cell of the SAME colour. The payout is a function of how many cells the flood
 *   reached — the same flood/bucket fill a late-90s raster accessory performs, with
 *   the canvas decided by Chain's VRF instead of by a mouse click.
 *
 *   No physics, no client input, nothing hidden: the entire canvas is 144 bits of the
 *   VRF word, so the reveal the player watches can never disagree with the settlement.
 *
 * PAYTABLE (total return multiple by flooded area)
 *
 *   The percentages below are MEASURED, not derived: they are the 10,000,000-round output
 *   of `node tests/rtp-derive.mjs 10000000`, which scores the shipped model in
 *   game/model.mjs. They are Monte Carlo estimates and each carries roughly +/-0.03pp of
 *   sampling noise on its own; treat them as indicative of the shape, not as exact rates.
 *
 *   area   0-29   (76.361%)  ->   0x     (no paint reached the minimum)
 *   area  30-39   ( 9.647%)  -> 1.5x
 *   area  40-49   ( 6.698%)  ->   2x
 *   area  50-59   ( 4.224%)  ->   3x
 *   area  60-79   ( 2.927%)  ->   6x
 *   area  80+     ( 0.145%)  -> 250x     JACKPOT
 *
 *   Hit rate 23.639%, top multiplier 250x at 1-in-690 (Wilson 95% 1-in-679..1-in-702).
 *   Declared RTP 9472 bps implies a 5.28pp house edge; the measured RTP is 9431.55 bps,
 *   a 5.68pp edge, and the two are consistent — see EXPECTED_RTP_BPS below for the
 *   interval. Quoting an edge to two decimals would imply precision this input cannot
 *   supply: the 250x band carries ~98% of E[X^2].
 *
 * RISK QUOTING
 *   probabilityWad is the JACKPOT band probability (0.1463%). Because 0.1463% is above
 *   the 0.1% heavy-tail probability threshold the game is not on the heavy-tail path,
 *   but bodyVarianceScaled is quoted anyway from the same simulation, so the game is
 *   safe to whitelist whatever the council's thresholds are. 0.1463% is a Monte Carlo
 *   figure too: the derivation measures 0.1449% (Wilson 95% 0.1425%..0.1473%), which
 *   contains it, and tests/rtp.test.mjs asserts that containment. It is left unchanged
 *   because it is the declared risk-quoting input, not a quantity this wave retunes.
 *
 * RESERVE DISCIPLINE (docs/CONTRACT_CONSTRAINTS.md)
 *   onSessionStart commits the FULL reserve and the settling step returns
 *   reservedProfitDelta = 0 and escrowDelta = 0. quoteCaps, quoteRiskParams,
 *   onSessionStart and onRandomness all route through the single _payout() function,
 *   so the reserve budget and the payout can never disagree by a base unit.
 */
contract FloodGame is ICasinoGameV2 {
  uint256 private constant WAD = 1e18;
  uint256 private constant COLS = 12;
  uint256 private constant ROWS = 12;
  uint256 private constant CELLS = COLS * ROWS; // 144
  uint256 private constant MAX_MULT_WAD = 250e18;
  uint256 private constant JACKPOT_PROBABILITY_WAD = 1463000000000000; // 0.1463%
  /// @dev E[RTP] as a MONTE CARLO ESTIMATE with a stated interval — not an exact figure and not
  ///      enumerable: the outcome is a keccak-256 output, so there is no finite support to sum
  ///      over. The committed, re-runnable derivation is tests/rtp-derive.mjs, which draws
  ///      words through the same counter sampler the JS model uses and scores them through
  ///      the shipped `outcome()`; tests/rtp.test.mjs is the gate that re-runs it.
  ///
  ///      WHAT THE PREVIOUS COMMENT GOT WRONG: it read "E[RTP] from the 10,000,000-round
  ///      simulation in math/tune.mjs (cross-checked against an independent 200,000,000-round
  ///      re-derivation; the two agree to 0.03pp)". Three problems, not one.
  ///        1. The 0.03pp agreement was not supportable. The 250x band contributes ~98% of
  ///           E[X^2], so sd(X) is ~9.57 return multiples and the standard error of the mean
  ///           is ~30 bps at 10M rounds. Two independent runs of the SAME code differ by
  ///           0.53pp at 1M rounds. 0.03pp is roughly a 2-sigma claim presented as a fact.
  ///        2. `math/tune.mjs` does not exist in this tree and never modelled this contract:
  ///           it paints the canvas from its own xorshift PRNG and draws the start cell with
  ///           a different rejection scheme, so it never exercised the keccak canvas or the
  ///           `(stream >> 8i) & 0xff` byte scan in `_paint` below.
  ///        3. Both runs lived outside version control, so no test could re-derive the
  ///           number and any paytable edit passed green.
  ///
  ///      `node tests/rtp-derive.mjs 10000000` measures 9431.55 bps with a 95% interval of
  ///      [9372.24, 9490.86] bps (+/- 0.593pp), which contains the 9472 declared here. That
  ///      containment is the entire claim, and it is all the variance of this game supports.
  uint256 private constant EXPECTED_RTP_BPS = 9472; // 94.72% — Monte Carlo estimate, +/- 0.59pp at n = 1e7
  /// @dev Var(payout multiple) with the jackpot band removed, per wei^2 of wager, * 1e18.
  ///      wager * wager * BODY_VAR_SCALED stays far below 2^256 for any realistic wager.
  uint256 private constant BODY_VAR_SCALED = 1582620149321559800; // 1.582620e18

  error FloodGame__NoPlayerAction();

  // ------------------------------------------------------------------ paytable
  /// @dev Single source of truth for the total return multiple of a flooded area.
  function _multiplier(uint256 area) internal pure returns (uint256) {
    if (area < 30) return 0;
    if (area < 40) return 15e17; // 1.5x
    if (area < 50) return 2e18; // 2x
    if (area < 60) return 3e18; // 3x
    if (area < 80) return 6e18; // 6x
    return MAX_MULT_WAD; // 250x
  }

  /// @dev Single source of truth for the tokens returned to the player on settle.
  function _payout(uint256 wager, uint256 area) internal pure returns (uint256) {
    return (wager * _multiplier(area)) / WAD;
  }

  // ------------------------------------------------------------------ canvas + flood
  /**
   * @dev The first byte of the stream that is below CELLS, scanning the least-significant byte
   *      first, or `type(uint256).max` when every one of the 32 bytes is rejected.
   */
  function _scan(bytes32 randomness, uint8 tag) internal pure returns (uint256) {
    uint256 stream = uint256(keccak256(abi.encodePacked(randomness, tag)));
    for (uint256 i = 0; i < 32; i += 1) {
      uint256 b = (stream >> (8 * i)) & 0xff;
      if (b < CELLS) {
        return b;
      }
    }
    return type(uint256).max;
  }

  /**
   * Paints the canvas and picks the start cell from the VRF word.
   *
   * The first 144 bits of keccak256(word, 0) are the canvas (bit i = colour of cell i).
   * The start cell is rejection-sampled from keccak256(word, 1) so every cell is exactly
   * equally likely — never `byte % 144`.
   */
  function _paint(bytes32 randomness) internal pure returns (uint256 field, uint256 start) {
    field = uint256(keccak256(abi.encodePacked(randomness, uint8(0)))) >> (256 - CELLS);
    start = _scan(randomness, 1);
    // P(all 32 bytes rejected) = (112/256)^32 ≈ 1e-12; fall back to another word, then to 0.
    if (start == type(uint256).max) start = _scan(randomness, 2);
    if (start == type(uint256).max) start = 0;
  }

  function _push(
    uint256 field,
    uint256 colour,
    uint256 j,
    uint256 visited,
    uint256 sp,
    uint256[CELLS] memory stack
  ) private pure returns (uint256, uint256) {
    uint256 bit = uint256(1) << j;
    if (visited & bit == 0 && (field >> j) & 1 == colour) {
      stack[sp] = j;
      return (visited | bit, sp + 1);
    }
    return (visited, sp);
  }

  /// @dev 4-connected flood fill from `start` through cells sharing its colour.
  function _floodArea(uint256 field, uint256 start) internal pure returns (uint256 area) {
    uint256 colour = (field >> start) & 1;
    uint256 visited = uint256(1) << start;
    uint256[CELLS] memory stack;
    uint256 sp = 0;
    stack[sp] = start;
    sp += 1;

    while (sp > 0) {
      sp -= 1;
      uint256 i = stack[sp];
      area += 1;
      uint256 x = i % COLS;
      uint256 y = i / COLS;
      if (x > 0) (visited, sp) = _push(field, colour, i - 1, visited, sp, stack);
      if (x + 1 < COLS) (visited, sp) = _push(field, colour, i + 1, visited, sp, stack);
      if (y > 0) (visited, sp) = _push(field, colour, i - COLS, visited, sp, stack);
      if (y + 1 < ROWS) (visited, sp) = _push(field, colour, i + COLS, visited, sp, stack);
    }
  }

  // ------------------------------------------------------------------ interface
  function quoteCaps(
    uint256 wager,
    bytes calldata
  ) external pure returns (uint256 maxEscrowStake, uint256 maxReservedProfit) {
    maxEscrowStake = wager;
    maxReservedProfit = (wager * MAX_MULT_WAD) / WAD - wager;
  }

  function quoteRiskParams(
    uint256 wager,
    bytes calldata
  )
    external
    pure
    returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 bodyVarianceScaled)
  {
    maxPayout = (wager * MAX_MULT_WAD) / WAD;
    probabilityWad = JACKPOT_PROBABILITY_WAD;
    expectedPayout = (wager * EXPECTED_RTP_BPS) / 10000;
    bodyVarianceScaled = wager * wager * BODY_VAR_SCALED;
  }

  function onSessionStart(SessionContext calldata ctx) external pure returns (StepResult memory r) {
    uint256 wager = ctx.escrowedStake;
    r.newGameState = abi.encode(uint256(0), uint16(0), uint16(0), uint256(0));
    r.escrowDelta = 0;
    r.reservedProfitDelta = int256((wager * MAX_MULT_WAD) / WAD - wager);
    r.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    r.requestRandomnessNow = true;
    r.payout = 0;
  }

  function onPlayerAction(SessionContext calldata, bytes calldata) external pure returns (StepResult memory) {
    revert FloodGame__NoPlayerAction();
  }

  function onRandomness(SessionContext calldata ctx, bytes32 randomness) external pure returns (StepResult memory r) {
    (uint256 field, uint256 start) = _paint(randomness);
    uint256 area = _floodArea(field, start);
    uint256 payout = _payout(ctx.wagerBase, area);

    // Everything the frontend needs to draw the exact canvas the contract painted.
    r.newGameState = abi.encode(field, uint16(start), uint16(area), payout);
    r.escrowDelta = 0;
    r.reservedProfitDelta = 0; // never release the reserve on the settling step
    r.nextPhase = SessionPhase.SETTLED;
    r.requestRandomnessNow = false;
    r.payout = payout;
  }

  function quoteForfeitPayout(SessionContext calldata) external pure returns (uint256) {
    return 0; // instant game: nothing is cashable mid-round
  }
}
