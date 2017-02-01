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

pushDataHash = function (obj, hash) {
    // we are using jquery here, but it also works without using Object.keys(obj).
    $.each(hash, function(key, value) {
        obj.data(key, value);
    });
};

// give objects = [obj0, obj1,..], datasets=[{key:val,..},...]
pushMultiDataHash = function (objects, datasets) {
	if (objects.length != datasets.length) { console.log("pushMultiDataHash error! count mismatch"); return false;}

	for (int i=0; i<objects.length; i++)
	{
		pushDataHash(objects[i], datasets[i]);
	}
}
