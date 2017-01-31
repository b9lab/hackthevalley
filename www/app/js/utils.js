filterGetPromise = function (filter) {
	return new Promise(function (resolve, reject) {
		try {
			filter.get(function (error, logs) {
				if (error) {
					reject(error);
				} else {
					resolve(logs);
				}
			});
		} catch (error) {
			reject(error);
		}
	});
};