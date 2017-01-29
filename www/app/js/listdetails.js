setListDetails = function(modal, listitem) {
	// get list data
    console.log("set details for ");
    console.log(listitem);
    console.log("modal:");
    console.log(modal);

    var f_ipfs_hash = listitem.data("ipfsHash");
    var f_name = listitem.data("name");
    var f_description = listitem.data("description");
    var f_ric = listitem.data("ipfsHash");
    var f_permid = listitem.data("ipfsHash");
    var f_deadline = listitem.data("deadline");
    var f_max_auditors = listitem.data("maxAuditors");
    var f_reward = listitem.data("reward");

    $(modal).find("#F_company_name").html(f_name);
    $(modal).find("#F_ipfs_link").html(f_ipfs_hash);
    $(modal).find("#F_description").html(f_description);
    $(modal).find("#F_ric").html(f_ric);
    $(modal).find("#F_permid").html(f_permid);
    $(modal).find("#F_deadline").html(f_deadline);
    $(modal).find("#F_auditor_max").html(f_max_auditors);
    $(modal).find("#F_reward").html(f_reward);

    //F_auditor_num
    //F_submission_num

    // ratings
}