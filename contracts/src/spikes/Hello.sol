// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title Hello — Phase 0 spike (S2/S5). NOT production code.
/// @notice Proves on Arc: (a) events reach Streams, (b) USDC transferFrom fan-out to N recipients,
///         (c) a relayer can submit a split the token holder authorized with an EIP-712 signature.
contract Hello is EIP712, Nonces {
    using SafeERC20 for IERC20;

    /// @dev Must match SPLIT_AUTH_TYPES in packages/shared/src/eip712.ts.
    bytes32 public constant SPLIT_AUTH_TYPEHASH = keccak256(
        "SplitAuth(address token,address from,bytes32 recipientsHash,bytes32 amountsHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant MAX_RECIPIENTS = 16;

    event Ping(address indexed from, bytes32 tag, uint256 at);
    event Split(
        address indexed token, address indexed from, address indexed relayer, uint256 recipientCount, uint256 total
    );

    error LengthMismatch();
    error TooManyRecipients();
    error NotFrom();
    error Expired();
    error InvalidSigner(address recovered, address expected);

    constructor() EIP712("WomHello", "1") {}

    function ping(bytes32 tag) external {
        emit Ping(msg.sender, tag, block.timestamp);
    }

    /// @notice Direct split: caller must be `from` (prevents anyone spending another holder's allowance).
    function pullAndSplit(IERC20 token, address from, address[] calldata recipients, uint256[] calldata amounts)
        external
    {
        if (msg.sender != from) revert NotFrom();
        _split(token, from, recipients, amounts);
    }

    /// @notice Relayed split: msg.sender (relayer) pays gas; `from` authorized exactly this split via EIP-712.
    function relayedSplit(
        IERC20 token,
        address from,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 structHash = keccak256(
            abi.encode(
                SPLIT_AUTH_TYPEHASH,
                address(token),
                from,
                keccak256(abi.encodePacked(recipients)),
                keccak256(abi.encodePacked(amounts)),
                _useNonce(from),
                deadline
            )
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != from) revert InvalidSigner(signer, from);
        _split(token, from, recipients, amounts);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _split(IERC20 token, address from, address[] calldata recipients, uint256[] calldata amounts) internal {
        uint256 n = recipients.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients();
        uint256 total = 0;
        for (uint256 i = 0; i < n; ++i) {
            total += amounts[i];
            // `from` is either msg.sender (pullAndSplit) or proven by an EIP-712 signature (relayedSplit).
            // forge-lint: disable-next-line(arbitrary-send-erc20)
            token.safeTransferFrom(from, recipients[i], amounts[i]);
        }
        emit Split(address(token), from, msg.sender, n, total);
    }
}
