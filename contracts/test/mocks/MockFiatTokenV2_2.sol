// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @title MockFiatTokenV2_2 — test double of Circle's FiatTokenV2_2 (Arc USDC `0x3600…`).
/// @notice Faithfully reproduces what Vouch depends on, with Circle's exact revert strings:
///   - EIP-712 domain {name:"USDC", version:"2", chainId, verifyingContract: this}; EIP-3009 typehashes.
///   - receiveWithAuthorization (v,r,s and bytes/ERC-1271 overloads): payee check `msg.sender == to` FIRST
///     ("FiatTokenV2: caller must be the payee"), then validAfter/validBefore, then unused-nonce, then signature,
///     then mark used + transfer. Same order as FiatTokenV2._receiveWithAuthorization.
///   - transferWithAuthorization, cancelAuthorization (both overloads), authorizationState.
///   - Blacklisting (`notBlacklisted` on msg.sender/from/to for transfer & authorizations) and pausing.
///   - Circle's SignatureChecker: EOA → ECRecover (rejects high-s and v ∉ {27,28}); contract → ERC-1271.
/// Source reference: circlefin/stablecoin-evm contracts/v2/FiatTokenV2.sol, v2/FiatTokenV2_2.sol, util/ECRecover.sol.
contract MockFiatTokenV2_2 {
    string public constant name = "USDC";
    string public constant symbol = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429;

    uint256 public totalSupply;
    bool public paused;
    mapping(address => uint256) private _balances;
    mapping(address => bool) private _blacklisted;
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    /// @dev Counts successful receiveWithAuthorization calls per payee (QE convenience).
    mapping(address => uint256) public receiveCalls;
    address public lastReceiveCaller;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
    event Blacklisted(address indexed account);
    event UnBlacklisted(address indexed account);

    modifier notBlacklisted(address account) {
        require(!_blacklisted[account], "Blacklistable: account is blacklisted");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Pausable: paused");
        _;
    }

    // ---------------------------------------------------------------- test admin (not on the real token)
    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function blacklist(address account) external {
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unBlacklist(address account) external {
        _blacklisted[account] = false;
        emit UnBlacklisted(account);
    }

    function setPaused(bool p) external {
        paused = p;
    }

    // ---------------------------------------------------------------- ERC-20 (subset)
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function transfer(address to, uint256 value)
        external
        whenNotPaused
        notBlacklisted(msg.sender)
        notBlacklisted(to)
        returns (bool)
    {
        _transfer(msg.sender, to, value);
        return true;
    }

    // ---------------------------------------------------------------- EIP-712 / EIP-3009
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused notBlacklisted(from) notBlacklisted(to) {
        _receiveWithAuthorization(from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external whenNotPaused notBlacklisted(from) notBlacklisted(to) {
        _receiveWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external whenNotPaused notBlacklisted(from) notBlacklisted(to) {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);
        _requireValidSignature(
            from,
            keccak256(
                abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
            ),
            signature
        );
        _markAuthorizationAsUsed(from, nonce);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
        external
        whenNotPaused
    {
        _cancelAuthorization(authorizer, nonce, abi.encodePacked(r, s, v));
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) external whenNotPaused {
        _cancelAuthorization(authorizer, nonce, signature);
    }

    // ---------------------------------------------------------------- internals (FiatTokenV2 order)
    function _receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) internal {
        require(to == msg.sender, "FiatTokenV2: caller must be the payee");
        _requireValidAuthorization(from, nonce, validAfter, validBefore);
        _requireValidSignature(
            from,
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)),
            signature
        );
        _markAuthorizationAsUsed(from, nonce);
        _transfer(from, to, value);
        receiveCalls[msg.sender] += 1;
        lastReceiveCaller = msg.sender;
    }

    function _cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) internal {
        _requireUnusedAuthorization(authorizer, nonce);
        _requireValidSignature(
            authorizer, keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)), signature
        );
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _requireValidAuthorization(address authorizer, bytes32 nonce, uint256 validAfter, uint256 validBefore)
        internal
        view
    {
        require(block.timestamp > validAfter, "FiatTokenV2: authorization is not yet valid");
        require(block.timestamp < validBefore, "FiatTokenV2: authorization is expired");
        _requireUnusedAuthorization(authorizer, nonce);
    }

    function _requireUnusedAuthorization(address authorizer, bytes32 nonce) internal view {
        require(!_authorizationStates[authorizer][nonce], "FiatTokenV2: authorization is used or canceled");
    }

    function _markAuthorizationAsUsed(address authorizer, bytes32 nonce) internal {
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationUsed(authorizer, nonce);
    }

    function _requireValidSignature(address signer, bytes32 structHash, bytes memory signature) internal view {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        require(_isValidSignatureNow(signer, digest, signature), "FiatTokenV2: invalid signature");
    }

    /// @dev Circle util/SignatureChecker.sol: EOAs via ECRecover (reverting on malformed sigs), contracts via 1271.
    function _isValidSignatureNow(address signer, bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        if (signer.code.length == 0) {
            return _ecRecover(digest, signature) == signer;
        }
        (bool success, bytes memory result) =
            signer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
        return success && result.length >= 32
            && abi.decode(result, (bytes32)) == bytes32(IERC1271.isValidSignature.selector);
    }

    function _ecRecover(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "ECRecover: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "ECRecover: invalid signature 's' value"
        );
        require(v == 27 || v == 28, "ECRecover: invalid signature 'v' value");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ECRecover: invalid signature");
        return signer;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(value <= _balances[from], "ERC20: transfer amount exceeds balance");
        _balances[from] -= value;
        _balances[to] += value;
        emit Transfer(from, to, value);
    }
}
