// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice ERC-1271 signer that approves ANY hash with ANY signature bytes ("returns magic for anything").
contract QeAlwaysValid1271 {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

/// @notice ERC-1271 signer that always reverts.
contract QeReverting1271 {
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        revert("nope");
    }
}

/// @notice ERC-1271 signer that burns every unit of gas it is given.
contract QeGasBurner1271 {
    function isValidSignature(bytes32, bytes memory) external view returns (bytes4) {
        uint256 x;
        while (gasleft() > 0) {
            x++;
        }
        return bytes4(uint32(x));
    }
}

/// @notice ERC-1271 signer that tries to re-enter a target with a STATE-CHANGING call from isValidSignature.
///         Callers use STATICCALL, so the re-entry must fail; it approves only if the re-entry was rejected (so a
///         successful pay() in ATTRIBUTOR mode proves the re-entry was blocked).
contract QeReentrant1271 {
    address public immutable target;
    bytes public payload;

    constructor(address target_) {
        target = target_;
    }

    function setPayload(bytes calldata p) external {
        payload = p;
    }

    function isValidSignature(bytes32, bytes memory) external returns (bytes4) {
        (bool ok,) = target.call(payload);
        return ok ? bytes4(0xffffffff) : bytes4(0x1626ba7e);
    }
}
