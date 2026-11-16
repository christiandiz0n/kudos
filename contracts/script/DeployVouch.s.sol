// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {Vouch} from "../src/Vouch.sol";
import {IFiatTokenV2_2} from "../src/interfaces/IFiatTokenV2_2.sol";

/// @notice Deploys the production Vouch contract. Reads DEPLOYER_PRIVATE_KEY (+ optional USDC_ADDRESS) from env.
/// Use the wrapper (loads the root env itself, verifies on Blockscout, writes packages/shared/src/deployments.ts):
///   bash scripts/deploy/deploy-vouch.sh
contract DeployVouch is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_TESTNET = 5042002;

    function run() external returns (Vouch vouch) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        if (block.chainid == ARC_TESTNET) require(usdc == ARC_USDC, "Arc: USDC must be 0x3600... (D-101)");
        require(usdc.code.length > 0, "USDC has no code");

        vm.startBroadcast(pk);
        vouch = new Vouch(IFiatTokenV2_2(usdc));
        vm.stopBroadcast();

        console2.log("VOUCH_ADDRESS=%s", address(vouch));
        console2.log("USDC_ADDRESS=%s", usdc);
    }
}
