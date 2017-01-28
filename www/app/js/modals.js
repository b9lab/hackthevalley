$(document).ready(function() {
	$("#submit-request").click(function() {
		data = {
			name: $("#nameInput").val(),
			url: $("#urlInput").val(),
			ric: $("#ricInput").val(),
			hash: $("#hashInput").val(),
			description: $("#descriptionInput").val(),
			amount: $("#etherInput").val()
		}
		// TODO create request
	})
})