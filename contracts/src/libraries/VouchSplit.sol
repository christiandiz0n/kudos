// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title VouchSplit — pure split math (D-502..D-504). Fuzzed directly in test/VouchSplit.t.sol.
/// @dev Arrays are fixed at MAX_REFERRERS = 5; only the first `n` entries are meaningful.
library VouchSplit {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant CASHBACK_BPS = 2_500;
    uint256 internal constant L1_BPS = 5_500;
    uint256 internal constant L2_BPS = 2_000;
    uint256 internal constant HALF_LIFE = 3 days;
    uint256 internal constant MAX_HALVINGS = 20;
    uint256 internal constant FALLBACK_SCALE_SHIFT = 20;

    /// @notice Referrer i's slice of the reward pool, priced at ITS intro's frozen rate:
    ///         floor(amount × weightBps × rewardBps / 10,000²).
    function slice(uint256 amount, uint256 weightBps, uint256 rewardBps) internal pure returns (uint256) {
        return amount * weightBps * rewardBps / (BPS * BPS);
    }

    /// @notice Cashback / L1 / L2 parts of one slice (each floored; the ≤ 2 base units of dust go to the venue).
    function parts(uint256 s) internal pure returns (uint256 cashback, uint256 l1, uint256 l2) {
        cashback = s * CASHBACK_BPS / BPS;
        l1 = s * L1_BPS / BPS;
        l2 = s * L2_BPS / BPS;
    }

    /// @notice On-chain fallback attribution (D-502): raw_i = linkWeight_i × 2^20 >> floor(age_i / 3 days)
    ///         (personal = 2, broadcast = 1, halvings capped at 20), w_i = floor(raw_i × 10,000 / Σraw), and the
    ///         rounding remainder goes to the most recently accepted intro (ties → lower index). Σw == 10,000.
    function fallbackWeights(uint8[5] memory linkType, uint64[5] memory acceptedAt, uint256 n, uint256 nowTs)
        internal
        pure
        returns (uint256[5] memory w)
    {
        if (n == 0) return w;
        uint256[5] memory raw;
        uint256 total;
        uint256 newest;
        for (uint256 i; i < n; ++i) {
            uint256 age = nowTs > acceptedAt[i] ? nowTs - acceptedAt[i] : 0;
            uint256 halvings = age / HALF_LIFE;
            if (halvings > MAX_HALVINGS) halvings = MAX_HALVINGS;
            raw[i] = (uint256(linkType[i] == 0 ? 2 : 1) << FALLBACK_SCALE_SHIFT) >> halvings;
            total += raw[i];
            if (acceptedAt[i] > acceptedAt[newest]) newest = i;
        }
        uint256 assigned;
        for (uint256 i; i < n; ++i) {
            w[i] = raw[i] * BPS / total;
            assigned += w[i];
        }
        w[newest] += BPS - assigned;
    }

    /// @notice Index of the largest weight; ties → lower index (D-008 introducer rule).
    function topIndex(uint256[5] memory w, uint256 n) internal pure returns (uint256 top) {
        for (uint256 i = 1; i < n; ++i) {
            if (w[i] > w[top]) top = i;
        }
    }
}
