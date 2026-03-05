"""
Picoclaw HTTP API Server
Expose TimeX tools via HTTP for remote access from any server
"""

import os
from functools import wraps

from flask import Flask, jsonify, request

from picoclaw_client import PicoclawClient

app = Flask(__name__)

client = PicoclawClient()
API_KEY = os.getenv("PICOCLAW_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing required environment variable: PICOCLAW_API_KEY")


def require_api_key(func):
    """Decorator to require API key."""

    @wraps(func)
    def decorated_function(*args, **kwargs):
        key = request.headers.get("X-API-Key")
        if key != API_KEY:
            return jsonify({"error": "Invalid API key"}), 401
        return func(*args, **kwargs)

    return decorated_function


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    workspace = client.get_workspace() if hasattr(client, "get_workspace") else "unknown"
    return jsonify({"status": "ok", "service": "picoclaw-api", "workspace": workspace})


@app.route("/api/v1/files/read", methods=["POST"])
@require_api_key
def read_file():
    """Read a file from workspace."""
    try:
        data = request.get_json(silent=True) or {}
        path = data.get("path")
        if not path:
            return jsonify({"error": "Missing 'path' parameter"}), 400

        content = client.read_file(path)
        return jsonify({"success": True, "path": path, "content": content, "size": len(content)})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/files/write", methods=["POST"])
@require_api_key
def write_file():
    """Write a file to workspace."""
    try:
        data = request.get_json(silent=True) or {}
        path = data.get("path")
        content = data.get("content")
        if not path or content is None:
            return jsonify({"error": "Missing 'path' or 'content' parameter"}), 400

        client.write_file(path, content)
        return jsonify({"success": True, "path": path, "message": "File written successfully"})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/files/append", methods=["POST"])
@require_api_key
def append_file():
    """Append to a file."""
    try:
        data = request.get_json(silent=True) or {}
        path = data.get("path")
        content = data.get("content")
        if not path or content is None:
            return jsonify({"error": "Missing 'path' or 'content' parameter"}), 400

        client.append_file(path, content)
        return jsonify({"success": True, "path": path, "message": "Content appended successfully"})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/files/list", methods=["POST"])
@require_api_key
def list_files():
    """List directory contents."""
    try:
        data = request.get_json(silent=True) or {}
        path = data.get("path", ".")

        files = client.list_dir(path)
        return jsonify({"success": True, "path": path, "files": files, "count": len(files)})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/exec", methods=["POST"])
@require_api_key
def execute_command():
    """Execute a shell command."""
    try:
        data = request.get_json(silent=True) or {}
        command = data.get("command")
        if not command:
            return jsonify({"error": "Missing 'command' parameter"}), 400

        output = client.exec(command)
        return jsonify({"success": True, "command": command, "output": output})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/web/search", methods=["POST"])
@require_api_key
def web_search():
    """Search the web."""
    try:
        data = request.get_json(silent=True) or {}
        query = data.get("query")
        count = data.get("count", 5)
        if not query:
            return jsonify({"error": "Missing 'query' parameter"}), 400

        results = client.web_search(query, count=count)
        return jsonify({"success": True, "query": query, "results": results, "count": len(results)})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/web/fetch", methods=["POST"])
@require_api_key
def web_fetch():
    """Fetch a webpage."""
    try:
        data = request.get_json(silent=True) or {}
        url = data.get("url")
        max_chars = data.get("max_chars", 5000)
        if not url:
            return jsonify({"error": "Missing 'url' parameter"}), 400

        content = client.web_fetch(url, max_chars=max_chars)
        return jsonify({"success": True, "url": url, "content": content, "length": len(content)})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/memory/save", methods=["POST"])
@require_api_key
def save_memory():
    """Save to memory."""
    try:
        data = request.get_json(silent=True) or {}
        key = data.get("key")
        value = data.get("value")
        if not key or value is None:
            return jsonify({"error": "Missing 'key' or 'value' parameter"}), 400

        client.save_memory(key, value)
        return jsonify({"success": True, "key": key, "message": "Saved to memory"})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/memory/load", methods=["POST"])
@require_api_key
def load_memory():
    """Load from memory."""
    try:
        data = request.get_json(silent=True) or {}
        key = data.get("key")
        if not key:
            return jsonify({"error": "Missing 'key' parameter"}), 400

        value = client.load_memory(key)
        return jsonify({"success": True, "key": key, "value": value})
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/v1/docs", methods=["GET"])
def docs():
    """API documentation."""
    return jsonify(
        {
            "service": "Picoclaw HTTP API",
            "version": "1.0",
            "endpoints": {
                "health": "GET /health",
                "files": {
                    "read": "POST /api/v1/files/read",
                    "write": "POST /api/v1/files/write",
                    "append": "POST /api/v1/files/append",
                    "list": "POST /api/v1/files/list",
                },
                "execution": {"exec": "POST /api/v1/exec"},
                "web": {
                    "search": "POST /api/v1/web/search",
                    "fetch": "POST /api/v1/web/fetch",
                },
                "memory": {
                    "save": "POST /api/v1/memory/save",
                    "load": "POST /api/v1/memory/load",
                },
            },
            "authentication": "Include 'X-API-Key' header with requests",
        }
    )


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def server_error(_error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False") == "True"
    workspace = client.get_workspace() if hasattr(client, "get_workspace") else "unknown"

    print("🦞 Picoclaw HTTP API Server")
    print(f"📁 Workspace: {workspace}")
    print(f"🚀 Starting on port {port}...")
    print(f"📖 Docs: http://localhost:{port}/api/v1/docs")

    app.run(host="0.0.0.0", port=port, debug=debug)
