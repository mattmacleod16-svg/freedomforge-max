"""
Picoclaw Remote Client
Call TimeX from any remote server via HTTP
"""

import json
from typing import Any, Dict, List, Optional

import requests


class PicoclawRemoteClient:
    """HTTP client for calling Picoclaw API from remote servers."""

    def __init__(self, endpoint: str, api_key: str):
        """
        Initialize remote client.

        Args:
            endpoint: Base URL of Picoclaw API (e.g., "https://picoclaw.example.com")
            api_key: API key for authentication
        """
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }

    # ============ FILE OPERATIONS ============

    def read_file(self, path: str) -> str:
        """Read file from remote workspace."""
        response = self._request("POST", "/api/v1/files/read", {"path": path})
        return response.get("content", "")

    def write_file(self, path: str, content: str) -> bool:
        """Write file to remote workspace."""
        response = self._request("POST", "/api/v1/files/write", {"path": path, "content": content})
        return response.get("success", False)

    def append_file(self, path: str, content: str) -> bool:
        """Append to file in remote workspace."""
        response = self._request("POST", "/api/v1/files/append", {"path": path, "content": content})
        return response.get("success", False)

    def list_dir(self, path: str = ".") -> List[str]:
        """List directory contents."""
        response = self._request("POST", "/api/v1/files/list", {"path": path})
        return response.get("files", [])

    # ============ COMMAND EXECUTION ============

    def exec(self, command: str) -> str:
        """Execute shell command on remote."""
        response = self._request("POST", "/api/v1/exec", {"command": command})
        return response.get("output", "")

    # ============ WEB OPERATIONS ============

    def web_search(self, query: str, count: int = 5) -> List[Dict[str, str]]:
        """Search the web."""
        response = self._request("POST", "/api/v1/web/search", {"query": query, "count": count})
        return response.get("results", [])

    def web_fetch(self, url: str, max_chars: int = 5000) -> str:
        """Fetch webpage content."""
        response = self._request("POST", "/api/v1/web/fetch", {"url": url, "max_chars": max_chars})
        return response.get("content", "")

    # ============ MEMORY OPERATIONS ============

    def save_memory(self, key: str, value: Any) -> bool:
        """Save to remote memory."""
        response = self._request("POST", "/api/v1/memory/save", {"key": key, "value": value})
        return response.get("success", False)

    def load_memory(self, key: str) -> Optional[str]:
        """Load from remote memory."""
        response = self._request("POST", "/api/v1/memory/load", {"key": key})
        return response.get("value")

    # ============ HEALTH & INFO ============

    def health(self) -> Dict[str, Any]:
        """Check if API is healthy."""
        try:
            response = requests.get(f"{self.endpoint}/health", timeout=5)
            return response.json()
        except Exception as error:
            return {"error": str(error)}

    def docs(self) -> Dict[str, Any]:
        """Get API documentation."""
        try:
            response = requests.get(f"{self.endpoint}/api/v1/docs", timeout=5)
            return response.json()
        except Exception as error:
            return {"error": str(error)}

    # ============ HELPERS ============

    def _request(self, method: str, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make HTTP request to API."""
        url = f"{self.endpoint}{endpoint}"

        try:
            if method == "GET":
                response = requests.get(url, headers=self.headers, timeout=30)
            else:
                response = requests.post(url, headers=self.headers, json=data, timeout=30)

            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as error:
            return {"error": f"Request failed: {str(error)}"}
        except json.JSONDecodeError:
            return {"error": "Invalid JSON response"}


if __name__ == "__main__":
    client = PicoclawRemoteClient(
        endpoint="http://localhost:5000",
        api_key="your-secret-key-here",
    )

    print("🏥 Health check:")
    print(client.health())

    print("\n📖 Reading file:")
    content = client.read_file("memory/MEMORY.md")
    print(content[:200])

    print("\n⚙️  Executing command:")
    result = client.exec("date")
    print(result)

    print("\n🔍 Web search:")
    results = client.web_search("python asyncio", count=3)
    for item in results:
        print(f"- {item.get('title')}")

    print("\n💾 Saving to memory:")
    client.save_memory("remote_test", "Hello from remote!")

    print("\n📚 Loading from memory:")
    value = client.load_memory("remote_test")
    print(f"Value: {value}")
