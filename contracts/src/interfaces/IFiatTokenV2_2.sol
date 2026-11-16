// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The subset of Circle's FiatTokenV2_2 (Arc Testnet USDC `0x3600…`, NativeFiatTokenV2_2) that Vouch uses.
/// @dev EIP-3009 `receiveWithAuthorization` is payee-only: the token requires `msg.sender == to`
///      ("FiatTokenV2: caller must be the payee"). The `bytes signature` overload accepts ECDSA (r,s,v packed) and
///      ERC-1271 signatures (smart-contract customers). D-103.
interface IFiatTokenV2_2 {
    function transfer(address to, uint256 value) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
