// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";
import {VouchHash} from "../src/libraries/VouchHash.sol";
import {Vouch} from "../src/Vouch.sol";
import {IFiatTokenV2_2} from "../src/interfaces/IFiatTokenV2_2.sol";

/// @dev Exposes the library with calldata params, exactly as Vouch uses it.
contract VouchHashHarness {
    function intro(IVouch.Intro calldata i) external pure returns (bytes32) {
        return VouchHash.intro(i);
    }

    function introAcceptance(IVouch.IntroAcceptance calldata a) external pure returns (bytes32) {
        return VouchHash.introAcceptance(a);
    }

    function order(IVouch.Order calldata o) external pure returns (bytes32) {
        return VouchHash.order(o);
    }

    function weights(IVouch.Weights calldata w) external pure returns (bytes32) {
        return VouchHash.weights(w);
    }

    function paymentAuth(IVouch.PaymentAuth calldata p) external pure returns (bytes32) {
        return VouchHash.paymentAuth(p);
    }

    function registerVenue(address owner, bytes32 salt, IVouch.VenueConfig calldata c, uint256 nonce, uint64 deadline)
        external
        pure
        returns (bytes32)
    {
        return VouchHash.registerVenue(owner, salt, c, nonce, deadline);
    }
}

/// @notice Golden vectors shared with packages/shared/src/eip712.test.ts (computed with viem hashStruct).
///         If either side changes a type, field order or encoding, both suites fail.
contract VouchTypehashTest is Test {
    VouchHashHarness h = new VouchHashHarness();

    function A(uint256 n) internal pure returns (address) {
        return address(uint160(n));
    }

    function test_goldenStructHashes() public view {
        assertEq(
            h.intro(IVouch.Intro(A(0xa1), A(0xb1), 3, 1, 1_800_000_000, 1_800_600_000, bytes32(uint256(0x42)))),
            0x9ff2d5883e4395056f16fca260e5a93e098131cdce2d673d2e0efff3907e2c70
        );
        assertEq(
            h.introAcceptance(IVouch.IntroAcceptance(bytes32(uint256(0x99)), A(0xc1), 1_800_003_600)),
            0x29c96781dbd1854510c1a2556b694876538a2e7f0d3546fc5b334857c8e0d7f2
        );
        assertEq(
            h.order(IVouch.Order(A(0xa1), bytes32(uint256(7)), 12_000_000, 1_800_000_600)),
            0x4d2385e0b84bc32342452a9f9108d837d2d8218abf887812286145120fb0dd50
        );
        address[] memory refs = new address[](2);
        refs[0] = A(0xb1);
        refs[1] = A(0xb2);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7000;
        bps[1] = 3000;
        assertEq(
            h.weights(IVouch.Weights(A(0xa1), A(0xc1), bytes32(uint256(7)), refs, bps)),
            0x909c63ab79908e26937c0ffe835d6e125b6b728763010a9ee4b2cf10d1e55ae4
        );
        assertEq(
            h.paymentAuth(
                IVouch.PaymentAuth(
                    A(0xc1), A(0xa1), bytes32(uint256(7)), 12_000_000, bytes32(uint256(0x77)), 1_800_000_600, A(0xe1)
                )
            ),
            0xfb440a874850757a8f393d28c80bab807cc706b202fb457d4c81c04df9ab02bf
        );
        assertEq(
            h.registerVenue(
                A(0xd1),
                bytes32(uint256(0x5a)),
                IVouch.VenueConfig(A(0xd2), A(0xd3), A(0xd4), 1500, 5_000_000, "ipfs://lenas-cafe"),
                2,
                1_800_003_600
            ),
            0xe4331844ae4391c7e76bd8b8e5998c997fea731b961acdfbf853bbd0100e1b73
        );
        assertEq(
            VouchHash.updateTerms(A(0xa1), 1000, 1_000_000, 3, 1_800_003_600),
            0x60aae8e6da784d3d122ca18ced96e6166b7047b3164ee936814e2b67a9e562ae
        );
        assertEq(
            VouchHash.setVenueKeys(A(0xa1), A(0xd2), A(0xd3), A(0xd4), 4, 1_800_003_600),
            0xfb9c844dff2b5cb746545d83b2373c1480785d69855d2b6a33f30959abfbec45
        );
        assertEq(
            VouchHash.setSeedAmbassador(A(0xa1), A(0xb1), true, 5, 1_800_003_600),
            0xf0bac3e9a403d2a86a7be57cc789266416dc34b80c586c84308f9aa81bf5f7c1
        );
    }

    function test_venueIdDerivation() public {
        Vouch v = new Vouch(IFiatTokenV2_2(address(0x3600000000000000000000000000000000000000)));
        assertEq(v.computeVenueId(A(0xd1), bytes32(uint256(0x5a))), 0x64287Ee3a7eD83d23b8eDCcdC89D05629C0159fE);
    }
}
