// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockFiatTokenV2_2} from "./MockFiatTokenV2_2.sol";

/// @dev Burns gas in its own call frame (stand-in for Arc's 0x1800 native-transfer precompile).
contract GasSink {
    uint256 public acc;

    function burn(uint256 rounds) external returns (uint256 x) {
        x = acc;
        for (uint256 i; i < rounds; ++i) {
            x = uint256(keccak256(abi.encode(x, i)));
        }
        acc = x; // state write: a real CALL, like the Arc precompile's balance move
    }
}

/// @notice Arc-shaped token: every balance move makes a NESTED external call first (like NativeFiatTokenV2_2 →
///         precompile), the case where a plain 63/64 post-check can miss starvation (QE-C-07).
contract MockNestedFiatToken is MockFiatTokenV2_2 {
    GasSink public immutable sink = new GasSink();
    uint256 public rounds = 200; // ≈ 30k gas per move

    function _transfer(address from, address to, uint256 value) internal override {
        sink.burn(rounds);
        super._transfer(from, to, value);
    }
}
