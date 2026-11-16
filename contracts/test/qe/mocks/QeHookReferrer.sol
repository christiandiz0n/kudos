// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice A smart-account referrer (ERC-1271 for `owner`) that, when it receives tokens through a hook-calling token,
///         tries to re-enter Vouch with arbitrary calldata and records what happened.
contract QeHookReferrer {
    address public immutable owner;
    address public immutable target;
    bytes public reentry;
    bool public reentered;
    bytes public lastRet;
    uint256 public hookCalls;

    constructor(address owner_, address target_) {
        owner = owner_;
        target = target_;
    }

    function setReentry(bytes calldata p) external {
        reentry = p;
    }

    function isValidSignature(bytes32 hash, bytes memory sig) external view returns (bytes4) {
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        return err == ECDSA.RecoverError.NoError && rec == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function onUsdcReceived(address, uint256) external {
        hookCalls++;
        if (reentry.length == 0) return;
        (bool ok, bytes memory ret) = target.call(reentry);
        reentered = ok;
        lastRet = ret;
    }
}
