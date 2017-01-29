pragma solidity ^0.4.5;

import "BlockOneUser.sol";
import "BlockOneOracleClient.sol";
import "BlockOneOracleEntityConnect.sol";
import "RicUri.sol";

contract Ratings is BlockOneUser, BlockOneOracleClient, BlockOneOracleEntityConnect {
    uint constant IPFS_INDEX = 0;
    uint constant NAME_INDEX = 1;
    uint constant DESCRIPTION_INDEX = 2;
    uint constant RIC_INDEX = 3;

    uint constant COMPANY_INTERACTIONS_LEVEL = 1;
    uint constant AUDITOR_CONNECTIONS_LEVEL = 2;

    enum Status {
        OPEN, REFUND, PAYOUT
    }

    struct Auditor {
        bool joined; // Whether has joined
        bytes32 permid; // the auditor's perm id.
        uint inCommon; // Common degrees
        uint rating; // The rating
        string ipfsHash; // Document that comes with the rating
        bool paid;
    }

    struct RequestTarget {
        bytes32 key; // The key of the request for rating
        address auditorAddr; // The auditor in question, or 0
    }

    struct RequestForRating {
        // [ IPFS_INDEX ]: Document to rate
        // [ NAME_INDEX ]: Name of the rating required
        // [ DESCRIPTION_INDEX ]: Description of the rating required
        // [ RIC_INDEX ]: RIC code as known by Thomson Reuters
        string[] info;
        bytes32 permid;
        uint totalInteractions; // Total interactions.
        uint deadline; // As a 1970 timestamp
        uint reward; // In Ether in escrow in this contract
        uint maxAuditors; // Max number of auditors to work on it
        mapping(address => uint) contributors; // More than one person may contribute
        uint auditorCount; // Count of auditors enrolled
        uint submissionCount; // Count of received submissions
        mapping(address => Auditor) auditors; // Enrolled auditors and ratings
        Status status; // Controls what can be done
    }

    mapping(bytes32 => RequestForRating) public requestForRatings;
    mapping(uint => RequestTarget) public requests;
    RicUri public ricUri;

    event LogRequestForRatingSubmitted(
        bytes32 indexed key,
        address indexed investor,
        string ipfsHash,
        string name,
        string description,
        string ric,
        bytes32 permid,
        uint deadline,
        uint maxAuditors,
        uint reward);
    event LogRequestForRatingInteractionsUpdated(
        bytes32 indexed key,
        uint totalInteractions);
    event LogRequestForRatingContributed(
        bytes32 indexed key,
        address indexed investor,
        uint contribution,
        uint totalReward);
    event LogAuditorJoined(
        bytes32 indexed key,
        address indexed auditor,
        bytes32 permid,
        uint auditorCount);
    event LogAuditorSubmitted(
        bytes32 indexed key,
        address indexed auditor,
        uint rating,
        string ipfsHash,
        uint submissionCount);
    event LogAuditorConnectionsUpdated(
        bytes32 indexed key,
        address indexed auditor,
        uint totalConnections);
    event LogAuditorPaid(
        bytes32 indexed key,
        address indexed auditor,
        uint reward);
    event LogInvestorRefunded(
        bytes32 indexed key,
        address indexed investor,
        uint contribution);
    event LogEntityConnect_onOracleFailure(
        uint requestId,
        bytes32 key,
        address auditorAddr,
        uint reason);

    function Ratings(address entitlementRegistry, address ricUriAddress)
        BlockOneUser(entitlementRegistry) 
        BlockOneOracleClient(entitlementRegistry) {
        ricUri = RicUri(ricUriAddress);
    }

    modifier entitledInvestorOnly {
        if (!Entitlement(getEntitlement("com.b9lab.drating.investor")).isEntitled(msg.sender)) throw;
        _;
    }

    modifier entitledAuditorOnly {
        if (!Entitlement(getEntitlement("com.b9lab.drating.auditor")).isEntitled(msg.sender)) throw;
        _;
    }

    function getInfo(bytes32 key)
        constant
        returns (string ipfsHash, string name, string description, string ric) {
        RequestForRating request = requestForRatings[key];
        return (request.info[IPFS_INDEX], request.info[NAME_INDEX],
            request.info[DESCRIPTION_INDEX], request.info[RIC_INDEX]);
    }

    function getAuditor(bytes32 key, address auditorAddr)
        constant
        returns (bool joined, uint rating, string ipfsHash, bool paid) {
        Auditor auditor = requestForRatings[key].auditors[auditorAddr];
        return (auditor.joined, auditor.rating, auditor.ipfsHash, auditor.paid);
    }

    /**
     * It may fail if
     *      - no Ether
     *      - not entitled investor
     */
    function submitRequestForRating(string name, string description, string ric,
        bytes32 permid, uint deadline, uint maxAuditors, string ipfsHash)
        entitledInvestorOnly
        payable
        returns (bool success) {
        if (msg.value == 0 || maxAuditors == 0 || bytes(ipfsHash).length == 0 || deadline <= now) {
            throw;
        }
        bytes32 key = sha3(msg.sender, name, description, ric, permid,
            deadline, msg.value, maxAuditors, ipfsHash, block.number);
        RequestForRating request = requestForRatings[key];
        if (request.info.length != 0) {
            throw;
        }
        request.info.length = 5;
        request.info[IPFS_INDEX] = ipfsHash;
        request.info[NAME_INDEX] = name;
        request.info[DESCRIPTION_INDEX] = description;
        request.info[RIC_INDEX] = ric;
        request.permid = permid;
        request.deadline = deadline;
        request.reward = msg.value;
        request.maxAuditors = maxAuditors;
        request.auditorCount = 0;
        request.submissionCount = 0;
        request.status = Status.OPEN;
        requestForRatings[key].contributors[msg.sender] = msg.value;
        LogRequestForRatingSubmitted(
            key, msg.sender, ipfsHash,
            name, description, ric, permid,
            deadline,
            maxAuditors, msg.value);
        uint queryId = request_EntityConnect(permid, 0, COMPANY_INTERACTIONS_LEVEL);
        requests[queryId] = RequestTarget({
            key: key,
            auditorAddr: 0
        });
        return true;
    }

    function contributeToRequestForRating(bytes32 key)
        entitledInvestorOnly
        payable
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        if (msg.value == 0
            || request.info.length == 0
            || request.deadline < now
            || request.status != Status.OPEN) {
            throw;
        }
        request.reward += msg.value;
        request.contributors[msg.sender] += msg.value;
        LogRequestForRatingContributed(key, msg.sender, msg.value, request.reward);
        return true;
    }

    function joinRating(bytes32 key, bytes32 permid)
        entitledAuditorOnly
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        Auditor auditor = request.auditors[msg.sender];
        if (request.info.length == 0
            || request.auditorCount == request.maxAuditors
            || auditor.joined
            || request.deadline < now
            || request.status != Status.OPEN) {
            throw;
        }
        auditor.joined = true;
        auditor.permid = permid;
        LogAuditorJoined(key, msg.sender, permid, ++request.auditorCount);
        uint queryId = request_EntityConnect(request.permid, permid, AUDITOR_CONNECTIONS_LEVEL);
        requests[queryId] = RequestTarget({
            key: key,
            auditorAddr: msg.sender
        });
        return true;
    }

    function submitRating(bytes32 key, uint rating, string ipfsHash)
        entitledAuditorOnly
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        Auditor auditor = request.auditors[msg.sender];
        if (request.info.length == 0
            || !auditor.joined
            || request.deadline < now
            || bytes(ipfsHash).length == 0
            || request.status != Status.OPEN) {
            throw;
        }
        if (bytes(auditor.ipfsHash).length == 0) {
            // We let the auditor submit a new document, but then we do not increase count.
            request.submissionCount++;
        }
        auditor.rating = rating;
        auditor.ipfsHash = ipfsHash;
        LogAuditorSubmitted(key, msg.sender, rating, ipfsHash, request.submissionCount);
        return true;
    }

    function requestPayout(bytes32 key)
        entitledAuditorOnly
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        Auditor auditor = request.auditors[msg.sender];
        if (request.status == Status.OPEN) {
            // Ready to pay out is true:
            //      - if the deadline has passed
            //      - or if we have all submissions.
            bool readyToPayOut = (request.deadline < now)
                || (request.submissionCount == request.maxAuditors);
            if (request.info.length == 0
                || request.submissionCount == 0 // No work done
                || !readyToPayOut) {
                throw;
            }
            request.status = Status.PAYOUT;
        } else if (request.status == Status.PAYOUT) {
            // Ok
        } else {
            throw;
        }
        if (!auditor.joined // Do not pay if never joined
            || bytes(auditor.ipfsHash).length == 0 // Do not pay if no rating
            || auditor.paid) { // Do not pay if already paid
            throw;
        }
        auditor.paid = true;
        uint payout = request.reward / request.submissionCount;
        // TODO remainded to be kept by owner.
        if (!msg.sender.send(payout)) {
            throw;
        }
        LogAuditorPaid(key, msg.sender, payout);
        return true;
    }

    function requestRefund(bytes32 key)
        entitledInvestorOnly
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        if (request.status == Status.OPEN) {
            bool readyToRefund = (request.deadline < now)
                && (request.submissionCount == 0);
            if (request.info.length == 0
                || !readyToRefund) { 
                throw;
            }
            request.status = Status.REFUND;
        } else if (request.status == Status.REFUND) {
            // Ok
        } else {
            throw;
        }
        if (request.contributors[msg.sender] == 0) { // Prevent trolls
            throw;
        }
        uint refund = request.contributors[msg.sender];
        request.contributors[msg.sender] = 0;
        if (!msg.sender.send(refund)) {
            throw;
        }
        LogInvestorRefunded(key, msg.sender, refund);
        return true;
    }

    // Oracle response

    function respondSuccess_EntityConnect(uint requestId, uint connections) {
        RequestTarget target = requests[requestId];
        RequestForRating request = requestForRatings[target.key];
        if (request.info.length == 0) {
            throw;
        }
        if (target.auditorAddr == 0) {
            request.totalInteractions = connections;
            LogRequestForRatingInteractionsUpdated(target.key, connections);
        } else  {
            Auditor auditor = request.auditors[target.auditorAddr];
            if (!auditor.joined) {
                throw;
            }
            auditor.inCommon = connections;
            LogAuditorConnectionsUpdated(target.key, target.auditorAddr, connections);
        }
    }

    function respondError_EntityConnect(uint requestId, uint reason) {
        RequestTarget target = requests[requestId];
        LogEntityConnect_onOracleFailure(
            requestId,
            target.key,
            target.auditorAddr,
            reason);
    }
}