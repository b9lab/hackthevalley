module.exports = {
    build: {
        "index.html": "index.html",
        "app.js": [
            "js/app.js"
        ],
        "app.css": [
            "css/app.css"
        ],
        "images/": "images/"
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
