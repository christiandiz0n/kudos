// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Stand-in for Arc's native-balance precompile (0x1800…): a SEPARATE call frame that moves balances, with a
///         configurable fixed cost (`burn` keccak rounds) to model an expensive precompile.
contract QeLedger {
    address public immutable token;
    mapping(address => uint256) public bal;
    uint256 public burn;

    constructor(address token_) {
        token = token_;
    }

    function setBurn(uint256 b) external {
        burn = b;
    }

    function credit(address to, uint256 v) external {
        require(msg.sender == token, "ledger: only token");
        bal[to] += v;
    }

    function move(address from, address to, uint256 v) external returns (bool) {
        require(msg.sender == token, "ledger: only token");
        uint256 x;
        for (uint256 i; i < burn; ++i) {
            x = uint256(keccak256(abi.encode(x, i)));
        }
        require(bal[from] >= v, "ledger: insufficient balance");
        bal[from] -= v;
        bal[to] += v;
        return x != 1 || true;
    }
}

/// @notice Arc-shaped USDC: same external surface Vouch + the QE fixture use (mint/balanceOf/transfer/blacklist/
///         DOMAIN_SEPARATOR/authorizationState/receiveWithAuthorization(bytes)), FiatTokenV2 check order and revert
///         strings, but every balance move is a NESTED call into QeLedger (like NativeFiatTokenV2_2 → precompile).
/// @dev Designed to be vm.etch-ed over the fixture's MockFiatTokenV2_2 address (no constructor state: call setLedger).
contract QeNestedUsdc {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    // etched over a MockFiatTokenV2_2 address that has had no storage writes yet, so layouts cannot collide
    QeLedger public ledger;
    mapping(address => bool) public isBlacklisted;
    mapping(address => mapping(bytes32 => bool)) internal _auth;
    bool public hooks; // ERC-777-style: notify contract recipients after a transfer (real USDC has NO hooks)

    event Transfer(address indexed from, address indexed to, uint256 value);

    function setLedger(QeLedger l) external {
        ledger = l;
    }

    function setHooks(bool on) external {
        hooks = on;
    }

    function mint(address to, uint256 v) external {
        ledger.credit(to, v);
        emit Transfer(address(0), to, v);
    }

    function blacklist(address a) external {
        isBlacklisted[a] = true;
    }

    function balanceOf(address a) external view returns (uint256) {
        return ledger.bal(a);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                address(this)
            )
        );
    }

    function authorizationState(address a, bytes32 n) external view returns (bool) {
        return _auth[a][n];
    }

    function transfer(address to, uint256 v) external returns (bool) {
        require(!isBlacklisted[msg.sender] && !isBlacklisted[to], "Blacklistable: account is blacklisted");
        _move(msg.sender, to, v);
        return true;
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(!isBlacklisted[from] && !isBlacklisted[to], "Blacklistable: account is blacklisted");
        require(to == msg.sender, "FiatTokenV2: caller must be the payee");
        require(block.timestamp > validAfter, "FiatTokenV2: authorization is not yet valid");
        require(block.timestamp < validBefore, "FiatTokenV2: authorization is expired");
        require(!_auth[from][nonce], "FiatTokenV2: authorization is used or canceled");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
                )
            )
        );
        require(signature.length == 65, "ECRecover: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        require(ecrecover(digest, v, r, s) == from, "FiatTokenV2: invalid signature");
        _auth[from][nonce] = true;
        _move(from, to, value);
    }

    /// @dev Like the real token: a low-level call to the balance "precompile", reverting if it fails.
    function _move(address from, address to, uint256 v) internal {
        (bool ok,) = address(ledger).call(abi.encodeCall(QeLedger.move, (from, to, v)));
        require(ok, "NativeFiatToken: native transfer failed");
        emit Transfer(from, to, v);
        if (hooks && to.code.length > 0) {
            (bool hookOk,) = to.call(abi.encodeWithSignature("onUsdcReceived(address,uint256)", from, v));
            hookOk; // a reverting hook is ignored (the recipient cannot veto)
        }
    }
}
