pragma solidity ^0.4.5;

import "BlockOneUser.sol";

contract Ratings is BlockOneUser {
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
        string ipfsHash; // Document to rate
        string name; // Name of the rating required
        string description; // Description of the rating required
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

    event LogRequestForRatingSubmitted(
        bytes32 indexed key,
        address indexed investor,
        string indexed ipfsHash,
        string name,
        string description,
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

    function Ratings(address entitlementRegistry)
        BlockOneUser(entitlementRegistry) {
    }

    modifier entitledInvestorOnly {
        if (!Entitlement(getEntitlement("com.b9lab.drating.investor")).isEntitled(msg.sender)) throw;
        _;
    }

    modifier entitledAuditorOnly {
        if (!Entitlement(getEntitlement("com.b9lab.drating.auditor")).isEntitled(msg.sender)) throw;
        _;
    }

    function submitRequestForRating(string name, string description,
        uint deadline, uint maxAuditors, string ipfsHash)
        entitledInvestorOnly
        payable
        returns (bool success) {
        if (msg.value == 0 || maxAuditors == 0 || bytes(ipfsHash).length == 0 || deadline <= now) {
            throw;
        }
        bytes32 key = sha3(msg.sender, name, description,
            deadline, msg.value, maxAuditors, ipfsHash, block.number);
        if (bytes(requestForRatings[key].ipfsHash).length != 0) {
            throw;
        }
        requestForRatings[key] = RequestForRating({
            name: name,
            description: description,
            deadline: deadline,
            reward: msg.value,
            maxAuditors: maxAuditors,
            ipfsHash: ipfsHash,
            auditorCount: 0,
            submissionCount: 0,
            status: Status.OPEN
        });
        requestForRatings[key].contributors[msg.sender] = msg.value;
        LogRequestForRatingSubmitted(
            key, msg.sender, ipfsHash,
            name, description, deadline,
            maxAuditors, msg.value);
        return true;
    }

    function contributeToRequestForRating(bytes32 key)
        entitledInvestorOnly
        payable
        returns (bool success) {
        RequestForRating request = requestForRatings[key];
        if (msg.value == 0
            || bytes(request.ipfsHash).length == 0
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
        if (bytes(request.ipfsHash).length == 0
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
        if (bytes(request.ipfsHash).length == 0
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
            if (bytes(request.ipfsHash).length == 0
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
            if (bytes(request.ipfsHash).length == 0
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