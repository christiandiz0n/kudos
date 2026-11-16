// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {Hello} from "../../src/spikes/Hello.sol";
import {MockUSDC} from "../../src/spikes/MockUSDC.sol";

/// @notice Deploys the S2/S5 Hello spike. Reads DEPLOYER_PRIVATE_KEY from env.
/// Testnet (later, once funded — NOT run in Phase 0 scaffold):
///   forge script script/spikes/DeployHello.s.sol --rpc-url arc_testnet --broadcast
/// Local anvil with a mock 6-dec USDC: set DEPLOY_MOCK_USDC=true.
contract DeployHello is Script {
    function run() external returns (Hello hello, address usdc) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        bool deployMock = vm.envOr("DEPLOY_MOCK_USDC", false);

        vm.startBroadcast(pk);
        hello = new Hello();
        if (deployMock) {
            MockUSDC mock = new MockUSDC();
            usdc = address(mock);
            address fundTo = vm.envOr("MOCK_FUND_TO", address(0));
            if (fundTo != address(0)) mock.mint(fundTo, 1_000e6);
        } else {
            usdc = vm.envOr("USDC_ADDRESS", address(0));
        }
        vm.stopBroadcast();

        console2.log("HELLO_ADDRESS=%s", address(hello));
        console2.log("USDC_ADDRESS=%s", usdc);
    }
}
