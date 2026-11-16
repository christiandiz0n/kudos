// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {VouchSplit} from "../src/libraries/VouchSplit.sol";

/// @notice Pure split math: fallback weights always sum to 10,000; slices never exceed the frozen-rate cap.
contract VouchSplitTest is Test {
    function testFuzz_fallbackWeightsSumTo10000(uint8 n, uint8[5] memory lt, uint64[5] memory acc, uint64 nowTs)
        public
        pure
    {
        n = uint8(bound(n, 1, 5));
        nowTs = uint64(bound(nowTs, 0, type(uint64).max));
        for (uint256 i; i < 5; ++i) {
            lt[i] = lt[i] % 2;
            acc[i] = uint64(bound(acc[i], 0, nowTs)); // acceptedAt <= now
        }
        uint256[5] memory w = VouchSplit.fallbackWeights(lt, acc, n, nowTs);
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            assertGt(w[i], 0, "every eligible intro gets weight");
            sum += w[i];
        }
        for (uint256 i = n; i < 5; ++i) {
            assertEq(w[i], 0);
        }
        assertEq(sum, 10_000);
        uint256 top = VouchSplit.topIndex(w, n);
        for (uint256 i; i < n; ++i) {
            assertLe(w[i], w[top]);
            if (i < top) assertLt(w[i], w[top], "ties go to the lower index");
        }
    }

    function test_fallbackWeights_examples() public pure {
        uint8[5] memory lt = [0, 1, 0, 0, 0];
        uint64[5] memory acc = [uint64(100), 100, 0, 0, 0];
        uint256[5] memory w = VouchSplit.fallbackWeights(lt, acc, 2, 100);
        assertEq(w[0], 6_667);
        assertEq(w[1], 3_333);
        // very old intros are capped at 10 halvings (never zero)
        acc = [uint64(0), 0, 0, 0, 0];
        w = VouchSplit.fallbackWeights(lt, acc, 2, 1000 days);
        assertEq(w[0] + w[1], 10_000);
        assertEq(VouchSplit.fallbackWeights(lt, acc, 0, 1)[0], 0);
    }

    function testFuzz_sliceBoundedByFrozenRate(uint256 amount, uint16[5] memory w, uint16[5] memory rate, uint8 n)
        public
        pure
    {
        amount = bound(amount, 0, 1_000_000e6);
        n = uint8(bound(n, 1, 5));
        uint256 remaining = 10_000;
        uint256 maxRate;
        uint256 pool;
        for (uint256 i; i < n; ++i) {
            uint256 wi = i == n - 1 ? remaining : bound(w[i], 0, remaining);
            remaining -= wi;
            uint256 r = bound(rate[i], 1, 5_000);
            if (r > maxRate) maxRate = r;
            uint256 s = VouchSplit.slice(amount, wi, r);
            (uint256 c, uint256 l1, uint256 l2) = VouchSplit.parts(s);
            assertLe(c + l1 + l2, s);
            assertGe(c + l1 + l2 + 2, s, "at most 2 units of dust per slice");
            pool += s;
        }
        assertLe(pool, amount * maxRate / 10_000);
    }

    function test_canonicalSlices() public pure {
        uint256 a = VouchSplit.slice(12_000_000, 7_000, 1_500);
        uint256 b = VouchSplit.slice(12_000_000, 3_000, 1_500);
        assertEq(a + b, 1_800_000);
        (uint256 ca, uint256 l1a, uint256 l2a) = VouchSplit.parts(a);
        (uint256 cb, uint256 l1b, uint256 l2b) = VouchSplit.parts(b);
        assertEq(ca + cb, 450_000);
        assertEq(l1a, 693_000);
        assertEq(l1b, 297_000);
        assertEq(l2a, 252_000);
        assertEq(l2b, 108_000);
    }
}
