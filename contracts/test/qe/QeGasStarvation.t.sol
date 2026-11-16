// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {Vouch} from "../../src/Vouch.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../../src/interfaces/IFiatTokenV2_2.sol";
import {MockERC1271Wallet} from "../mocks/MockERC1271Wallet.sol";
import {QeLedger, QeNestedUsdc} from "./mocks/QeNestedUsdc.sol";

/// @dev Test-only harness exposing the internal transfer helper (src/ untouched).
contract VouchTryTransferHarness is Vouch {
    constructor(IFiatTokenV2_2 u) Vouch(u) {}

    function tryTransfer(address to, uint256 amount) external returns (bool) {
        return _tryTransfer(to, amount);
    }
}

/// @title Out-of-gas manipulation by the submitter (D-506): can an under-funded pay() redirect shares to the venue,
///        or silently downgrade the attributor weights to the fallback (ERC-1271 attributor starved)?
/// @notice Property tested at 1-gas granularity around the success threshold (the builder swept in 2,500 steps):
///         every gas limit at which pay() succeeds pays every share exactly, in ATTRIBUTOR mode, with no RewardReturned.
abstract contract QeGasSweepBase is QeBase {
    struct Sweep {
        uint256 successes;
        uint256 reverts;
        uint256 oogGuard; // TransferOutOfGas reverts (the D-506 guard firing)
        uint256 firstSuccess;
        uint256 violations;
    }

    uint256 internal ana0;
    uint256 internal priya0;
    uint256 internal omar0;
    uint256 internal sam0;

    function _baseline() internal {
        ana0 = usdc.balanceOf(ana);
        priya0 = usdc.balanceOf(priya);
        omar0 = usdc.balanceOf(omar);
        sam0 = usdc.balanceOf(sam);
    }

    function _one(bytes memory cd, uint256 g, Sweep memory s) internal {
        uint256 snap = vm.snapshotState();
        vm.recordLogs();
        vm.prank(relayer); // v2 (D-012): the bundle binds submitter = relayer
        (bool ok, bytes memory ret) = address(vouch).call{gas: g}(cd);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        if (ok) {
            s.successes++;
            if (s.firstSuccess == 0) s.firstSuccess = g;
            (uint8 mode,,) = _settledMode(logs);
            bool exact = usdc.balanceOf(ana) - ana0 == 693_000 && usdc.balanceOf(priya) - priya0 == 297_000
                && usdc.balanceOf(sam) - sam0 == 252_000 && usdc.balanceOf(omar) - omar0 == 108_000;
            if (!exact || mode != 1 || _countReturned(logs) != 0) {
                s.violations++;
                emit log_named_uint("VIOLATION at gas", g);
            }
        } else {
            s.reverts++;
            if (ret.length == 4 && bytes4(ret) == IVouch.TransferOutOfGas.selector) s.oogGuard++;
        }
        vm.revertToState(snap);
    }

    function _sweep(bytes memory cd, uint256 from, uint256 to, uint256 step, Sweep memory s) internal {
        for (uint256 g = from; g <= to; g += step) {
            uint256 fmp;
            assembly {
                fmp := mload(0x40)
            }
            _one(cd, g, s);
            assembly {
                mstore(0x40, fmp) // free the per-iteration logs/returndata (thousands of iterations)
            }
        }
    }

    /// @dev Smallest gas limit at which pay() succeeds (binary search; the fine sweeps then verify the region below).
    function _threshold(bytes memory cd) internal returns (uint256 lo) {
        lo = 60_000;
        uint256 hi = 3_000_000;
        Sweep memory probe;
        _one(cd, hi, probe);
        assertEq(probe.successes, 1, "pay must succeed with ample gas");
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            Sweep memory p;
            _one(cd, mid, p);
            if (p.successes == 1) hi = mid;
            else lo = mid;
        }
        lo = hi;
    }

    /// @dev Two chunks per configuration (Foundry caps one test at ~1.07e9 gas): (near) 1-gas steps over
    ///      [T-1500, T+200] plus 4,999-gas steps over [T, T+200k]; (far) 113-gas steps over [T-250000, T-1500] — the
    ///      region where the reward transfers themselves run out of gas (a starved reward transfer could in theory
    ///      leave enough gas for the rest of pay()).
    function _chunk(bytes memory cd, bool near, string memory label) internal {
        _chunk(cd, near, label, 1_500, 113);
    }

    function _chunk(bytes memory cd, bool near, string memory label, uint256 nearSpan, uint256 farStep) internal {
        uint256 t = _threshold(cd);
        Sweep memory s;
        if (near) {
            _sweep(cd, t - nearSpan, t + 200, 1, s);
            _sweep(cd, t, t + 200_000, 4_999, s);
        } else {
            uint256 from = t > 310_000 ? t - 250_000 : 60_000;
            _sweep(cd, from, t - nearSpan, farStep, s);
        }
        emit log_named_string("sweep", label);
        emit log_named_uint("  threshold T (min successful gas limit)", t);
        emit log_named_uint("  successes", s.successes);
        emit log_named_uint("  reverts", s.reverts);
        // (a starved transfer usually leaves too little gas even to encode the custom error: the frame then fails with a
        //  plain OOG, which reverts just the same; the guard selector only surfaces when the token itself is expensive)
        emit log_named_uint("  TransferOutOfGas guard fired", s.oogGuard);
        assertEq(s.violations, 0, "a successful under-funded pay() redirected or re-weighted shares");
        if (near) assertGt(s.successes, 0);
        else assertEq(s.successes, 0, "nothing below T succeeds");
    }

    function _canonicalCalldata() internal returns (bytes memory) {
        _canonicalSetup();
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        _baseline();
        return _payCalldata(b);
    }
}

contract QeGasStarvationTest is QeGasSweepBase {
    function test_gasSweep_mockUsdc_near_1gas() public {
        _chunk(_canonicalCalldata(), true, "mock USDC, EOA attributor, near");
    }

    function test_gasSweep_mockUsdc_far() public {
        _chunk(_canonicalCalldata(), false, "mock USDC, EOA attributor, far");
    }

    /// @dev The venue attributor is a smart account (ERC-1271, D-104 Tier 3). Starving its isValidSignature staticcall
    ///      would turn the attributor split into WEIGHTS_FALLBACK_BAD_SIGNATURE: must never happen in a successful pay.
    function _erc1271Attributor() internal {
        MockERC1271Wallet wallet = new MockERC1271Wallet(attributor);
        vm.prank(lena);
        vouch.setKeys(venue, payout, venueSigner, address(wallet), 0, "");
    }

    function test_gasSweep_erc1271Attributor_near_cannotBeStarvedIntoFallback() public {
        _erc1271Attributor();
        _chunk(_canonicalCalldata(), true, "mock USDC, ERC-1271 attributor, near");
    }

    function test_gasSweep_erc1271Attributor_far_cannotBeStarvedIntoFallback() public {
        _erc1271Attributor();
        _chunk(_canonicalCalldata(), false, "mock USDC, ERC-1271 attributor, far");
    }
}

/// @notice Same sweeps against an Arc-shaped USDC whose balance moves are a NESTED call (QeNestedUsdc → QeLedger), the
///         shape of NativeFiatTokenV2_2 → precompile 0x1800. With two frames the 63/64 heuristic in _tryTransfer can
///         see a starved inner call as an ordinary failure (see test_INFO_*), so pay() must still be safe end-to-end.
contract QeGasStarvationNestedTest is QeGasSweepBase {
    QeLedger internal ledger;

    function setUp() public override {
        super.setUp();
        vm.etch(address(usdc), address(new QeNestedUsdc()).code);
        ledger = new QeLedger(address(usdc));
        QeNestedUsdc(address(usdc)).setLedger(ledger);
    }

    function test_gasSweep_nestedUsdc_cheapPrecompile_near() public {
        _chunk(_canonicalCalldata(), true, "nested USDC, burn 0, near");
    }

    function test_gasSweep_nestedUsdc_cheapPrecompile_far() public {
        _chunk(_canonicalCalldata(), false, "nested USDC, burn 0, far");
    }

    /// @dev burn 300 ≈ 95k gas per balance move (~2x real Arc USDC): the shape most favourable to a starvation attack.
    function test_gasSweep_nestedUsdc_expensivePrecompile_near() public {
        ledger.setBurn(300);
        _chunk(_canonicalCalldata(), true, "nested USDC, burn 300, near", 500, 0);
    }

    function test_gasSweep_nestedUsdc_expensivePrecompile_far() public {
        ledger.setBurn(300);
        _chunk(_canonicalCalldata(), false, "nested USDC, burn 300, far", 900, 307);
    }

    /// QE-C-07 — FIXED in v2 (D-517: MIN_TRANSFER_GAS = 100k floor before each transfer). With an Arc-shaped nested
    /// token calibrated to the REAL Arc USDC cost (eth_estimateGas of transfer to a fresh address = 74,597 tx gas, i.e.
    /// ~52k execution; burn 120 ≈ 55k per move here), no starved transfer is reported as a plain failure any more.
    function test_FIXED_guardNoFalseNegativeWithNestedToken() public {
        (uint256 falseNegatives, uint256 guardFired) = _probeGuard(120);
        emit log_named_uint("burn 120 (~Arc cost): starved transfers reported as plain failures", falseNegatives);
        emit log_named_uint("burn 120 (~Arc cost): refused by the guard / floor", guardFired);
        assertEq(falseNegatives, 0, "no false negatives at a realistic token cost");
        assertGt(guardFired, 0);
    }

    /// INFO: the floor's guarantee assumes the token's transfer costs < ~98k gas (63/64 of 100k). A hypothetical token
    /// whose transfer costs more brings the false negative back. Real Arc USDC costs far less (fork threshold ~354k
    /// for a whole 5-transfer pay), so this is an assumption to keep pinned, not a bug.
    function test_INFO_floorAssumesTransferCostBelowFloor() public {
        (uint256 falseNegatives,) = _probeGuard(300); // ~95k gas per move: above 63/64 of the 100k floor
        emit log_named_uint("burn 300 (~95k/move): starved transfers reported as plain failures", falseNegatives);
        assertGt(falseNegatives, 0, "documents the assumption MIN_TRANSFER_GAS > worst-case token transfer cost");
    }

    function _probeGuard(uint256 burn) internal returns (uint256 falseNegatives, uint256 guardFired) {
        VouchTryTransferHarness h = new VouchTryTransferHarness(IFiatTokenV2_2(address(usdc)));
        ledger.setBurn(burn);
        usdc.mint(address(h), 10e6);
        address fresh = makeAddr("fresh");
        for (uint256 g = 20_000; g < 400_000; g += 97) {
            uint256 snap = vm.snapshotState();
            (bool ok, bytes memory ret) = address(h).call{gas: g}(abi.encodeCall(h.tryTransfer, (fresh, 1)));
            if (ok && !abi.decode(ret, (bool))) falseNegatives++;
            if (!ok && ret.length == 4 && bytes4(ret) == IVouch.TransferOutOfGas.selector) guardFired++;
            vm.revertToState(snap);
        }
        assertTrue(h.tryTransfer(fresh, 1), "with enough gas the same transfer succeeds");
    }
}
