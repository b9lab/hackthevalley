setListDetails = function(modal, listitem) {
	// get list data
    console.log("set details for ");
    console.log(listitem);
    console.log("modal:");
    console.log(modal);

    var f_ipfs_hash = listitem.data("ipfs-hash");
    var f_name = listitem.data("name");
    var f_description = listitem.data("description");
    var f_status = listitem.data("status");
    var f_ric = listitem.data("ric");
    var f_permid = listitem.data("permid");
    var f_deadline = new Date(listitem.data("deadline")).toLocaleString();
    var f_joined_auditors = listitem.data("joined-slots");
    var f_max_auditors = listitem.data("max-auditors");
    var f_submitted_auditors = listitem.data("submitted-slots");
    var f_reward = web3.fromWei(listitem.data("reward")) + " Ether";

    $(modal).find("#F_company_name").html(f_name);
    $(modal).find("#F_description").html(f_description);
    $(modal).find("#F_status").html(f_status);
    $(modal).find("#F_ipfs_link").html(f_ipfs_hash);
    $(modal).find("#F_ric").html(f_ric);
    $(modal).find("#F_permid").html(f_permid);
    $(modal).find("#F_deadline").html(f_deadline);
    $(modal).find("#F_joined_auditors").html(f_joined_auditors);
    $(modal).find("#F_auditor_max").html(f_max_auditors);
    $(modal).find("#F_submission_num").html(f_submitted_auditors);
    $(modal).find("#F_submission_max").html(f_joined_auditors);
    $(modal).find("#F_reward").html(f_reward);

    //F_auditor_num
    //F_submission_num

    // ratings
}
