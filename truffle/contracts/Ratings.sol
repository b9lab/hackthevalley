pragma solidity ^0.4.5;

import "BlockOneUser.sol";
import "RicUri.sol";

contract Ratings is BlockOneUser {
    uint constant IPFS_INDEX = 0;
    uint constant NAME_INDEX = 1;
    uint constant DESCRIPTION_INDEX = 2;
    uint constant RIC_INDEX = 3;
    uint constant PERMID_INDEX = 4;

    enum Status {
        OPEN, REFUND, PAYOUT
    }

    struct Auditor {
        bool joined; // Whether has joined
        uint rating; // The rating
        string ipfsHash; // Document that comes with the rating
        bool paid;
    }

    struct RequestForRating {
        // [ IPFS_INDEX ]: Document to rate
        // [ NAME_INDEX ]: Name of the rating required
        // [ DESCRIPTION_INDEX ]: Description of the rating required
        // [ RIC_INDEX ]: RIC code as known by Thomson Reuters
        // [ PERMID_INDEX ]: Uri as  known by Thomson Reuters
        string[] info;
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
    RicUri public ricUri;

    event LogRequestForRatingSubmitted(
        bytes32 indexed key,
        address indexed investor,
        string indexed ipfsHash,
        string name,
        string description,
        string ric,
        string uri,
        uint deadline,
        uint maxAuditors,
        uint reward);
    event LogRequestForRatingContributed(
        bytes32 indexed key,
        address indexed investor,
        uint contribution,
        uint totalReward);
    event LogAuditorJoined(
        bytes32 indexed key,
        address indexed auditor,
        uint auditorCount);
    event LogAuditorSubmitted(
        bytes32 indexed key,
        address indexed auditor,
        uint rating,
        string ipfsHash,
        uint submissionCount);
    event LogAuditorPaid(
        bytes32 indexed key,
        address indexed auditor,
        uint reward);
    event LogInvestorRefunded(
        bytes32 indexed key,
        address indexed investor,
        uint contribution);

    function Ratings(address entitlementRegistry, address ricUriAddress)
        BlockOneUser(entitlementRegistry) {
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

    /**
     * It may fail if
     *      - no Ether
     *      - not entitled investor
     */
    function submitRequestForRating(string name, string description, string ric,
        string uri, uint deadline, uint maxAuditors, string ipfsHash)
        entitledInvestorOnly
        payable
        returns (bool success) {
        if (msg.value == 0 || maxAuditors == 0 || bytes(ipfsHash).length == 0 || deadline <= now) {
            throw;
        }
        bytes32 key = sha3(msg.sender, name, description,
            deadline, msg.value, maxAuditors, ipfsHash, block.number);
        if (bytes(requestForRatings[key].info[IPFS_INDEX]).length != 0) {
            throw;
        }
        RequestForRating request = requestForRatings[key];
        request.info[IPFS_INDEX] = ipfsHash;
        request.info[NAME_INDEX] = name;
        request.info[DESCRIPTION_INDEX] = description;
        request.info[RIC_INDEX] = ric;
        request.info[PERMID_INDEX] = uri;
        request.deadline = deadline;
        request.reward = msg.value;
        request.maxAuditors = maxAuditors;
        request.auditorCount = 0;
        request.submissionCount = 0;
        request.status = Status.OPEN;
        requestForRatings[key].contributors[msg.sender] = msg.value;
        LogRequestForRatingSubmitted(
            key, msg.sender, ipfsHash,
            name, description, ric, uri,
            deadline,
            maxAuditors, msg.value);
        return true;
    }

    function contributeToRequestForRating(bytes32 key)
        entitledInvestorOnly
        payable
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        if (msg.value == 0
            || bytes(request.info[IPFS_INDEX]).length == 0
            || request.deadline < now
            || request.status != Status.OPEN) {
            throw;
        }
        request.reward += msg.value;
        request.contributors[msg.sender] += msg.value;
        LogRequestForRatingContributed(key, msg.sender, msg.value, request.reward);
        return true;
    }

    function joinRating(bytes32 key)
        entitledAuditorOnly
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        Auditor auditor = request.auditors[msg.sender];
        if (bytes(request.info[IPFS_INDEX]).length == 0
            || request.auditorCount == request.maxAuditors
            || auditor.joined
            || request.deadline < now
            || request.status != Status.OPEN) {
            throw;
        }
        request.auditors[msg.sender].joined == true;
        LogAuditorJoined(key, msg.sender, ++request.auditorCount);
        return true;
    }

    function submitRating(bytes32 key, uint rating, string ipfsHash)
        entitledAuditorOnly
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        Auditor auditor = request.auditors[msg.sender];
        if (bytes(request.info[IPFS_INDEX]).length == 0
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
            if (bytes(request.info[IPFS_INDEX]).length == 0
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
            if (bytes(request.info[IPFS_INDEX]).length == 0
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
}