// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {VouchBase} from "../VouchBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";

/// @notice CONTRACTS_QE helpers on top of the builder fixture (VouchBase). Adds a "build without executing" payment
///         bundle so a test can tamper with / front-run / gas-starve the exact calldata an honest relayer would send.
abstract contract QeBase is VouchBase {
    bytes32 internal constant SETTLED_SIG =
        keccak256("PaymentSettled(address,address,bytes32,uint256,uint256,uint256,bool,bool,uint8)");
    bytes32 internal constant PAID_SIG = keccak256("RewardPaid(bytes32,address,address,address,uint8,uint256,address)");
    bytes32 internal constant RETURNED_SIG =
        keccak256("RewardReturned(bytes32,address,address,address,uint8,uint256,address,uint8)");
    bytes32 internal constant VERIFIED_SIG = keccak256("CustomerVerified(address,address,address,bytes32)");
    bytes32 internal constant TRANSFER_SIG = keccak256("Transfer(address,address,uint256)");

    struct Bundle {
        IVouch.Order o;
        bytes osig;
        IVouch.Weights w;
        bytes wsig;
        IVouch.PaymentAuth a;
        bytes usig;
    }

    /// @dev Everything an honest relayer would submit for (customer, amount, weights); refs empty = fallback commit.
    function _bundle(address v, uint256 customerPk, uint256 amount, address[] memory refs, uint16[] memory bps)
        internal
        returns (Bundle memory b)
    {
        (b.o, b.osig) = _order(v, amount);
        bytes32 wh;
        if (refs.length > 0) {
            (b.w, b.wsig) = _weights(b.o, vm.addr(customerPk), refs, bps);
            wh = _weightsHash(b.w);
        }
        (b.a, b.usig) = _auth(b.o, customerPk, wh);
        usdc.mint(b.a.customer, amount);
    }

    function _exec(Bundle memory b) internal {
        vm.prank(relayer);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
    }

    function _payCalldata(Bundle memory b) internal view returns (bytes memory) {
        return abi.encodeCall(vouch.pay, (b.o, b.osig, b.w, b.wsig, b.a, b.usig));
    }

    /// @dev Re-sign the USDC authorization after the test mutated `b.a` (keeps the bundle internally consistent).
    function _resignAuth(Bundle memory b, uint256 customerPk) internal view {
        b.usig = _usdcSig(customerPk, b.a);
    }

    function _signOrder(IVouch.Order memory o, uint256 pk) internal view returns (bytes memory) {
        return _sign(pk, _digest(keccak256(abi.encode(T_ORDER, o.venue, o.orderId, o.amount, o.expiresAt))));
    }

    /// @dev Σ of mock-USDC Transfer events emitted with from == vouch in `logs`.
    function _sumOutOfVouch(Vm.Log[] memory logs) internal view returns (uint256 s, uint256 count) {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(usdc) && logs[i].topics[0] == TRANSFER_SIG
                    && address(uint160(uint256(logs[i].topics[1]))) == address(vouch)
            ) {
                s += abi.decode(logs[i].data, (uint256));
                count++;
            }
        }
    }

    function _settledMode(Vm.Log[] memory logs) internal view returns (uint8 mode, uint256 venueAmount, bool found) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vouch) && logs[i].topics[0] == SETTLED_SIG) {
                (, venueAmount,,,, mode) = abi.decode(logs[i].data, (uint256, uint256, uint256, bool, bool, uint8));
                found = true;
            }
        }
    }

    function _countReturned(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vouch) && logs[i].topics[0] == RETURNED_SIG) n++;
        }
    }

    /// @dev Ana and Priya become verified customers (via seeds Sam / Omar) so they can refer Ben.
    function _twoVerifiedReferrers() internal {
        _seed(venue, sam);
        _seed(venue, omar);
        _introduce(venue, SAM_PK, ANA_PK, 0);
        _pay(venue, ANA_PK, 20e6, _arr(sam), _bps(10_000));
        _introduce(venue, OMAR_PK, PRIYA_PK, 0);
        _pay(venue, PRIYA_PK, 20e6, _arr(omar), _bps(10_000));
    }

    function _registerAs(address owner, bytes32 salt, uint16 rate, uint256 minOrder) internal returns (address v) {
        vm.prank(owner);
        v = vouch.registerVenue(owner, salt, _cfg(rate, minOrder), 0, "");
    }
}
