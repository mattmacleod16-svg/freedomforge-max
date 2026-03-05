"""
Simple example - copy this to test your setup
"""

import os

from picoclaw_remote_client import PicoclawRemoteClient


client = PicoclawRemoteClient(
    endpoint=os.getenv("PICOCLAW_ENDPOINT", "http://localhost:5000"),
    api_key=os.getenv("PICOCLAW_API_KEY", ""),
)

print("✅ Testing connection...")
health = client.health()
print(f"Status: {health}")

print("\n📖 Reading a file...")
try:
    content = client.read_file("memory/MEMORY.md")
    print(f"Read {len(content)} characters")
except Exception as error:
    print(f"Error: {error}")

print("\n✍️ Writing a file...")
try:
    client.write_file("test.txt", "Hello from VS Code!")
    print("✅ File written")
except Exception as error:
    print(f"Error: {error}")

print("\n⚙️ Executing command...")
try:
    result = client.exec("date")
    print(f"Result: {result}")
except Exception as error:
    print(f"Error: {error}")

print("\n✨ All tests complete!")
