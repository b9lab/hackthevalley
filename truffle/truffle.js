module.exports = {
    build: {
        "index.html": "index.html",
        "app.js": [
            "js/utils.js",
            "js/app.js"
        ],
        "list.js": [
            "js/list.js"
        ],
        "app.css": [
            "css/app.css"
        ]
    },
    rpc: {
        host: "localhost",
        port: 8545
    },
    networks: {
        norsborg: {
            network_id: 16123
        }
    }
};
