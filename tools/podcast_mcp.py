#!/usr/bin/env python3
"""
A minimal stdio MCP client, so a script can drive the same tools Claude uses.

Writes to the wiki must pass through the MCP server rather than the MediaWiki
API, because the proposal wrapper that marks a claim as unverified is applied
by that server middleware. Reimplementing the wrapper here would duplicate the
one piece of this system it is least safe to get subtly wrong.
"""

import json
import subprocess
import threading


class McpStdioClient:
    def __init__(self, command, env_extra=None, cwd=None):
        import os
        env = dict(os.environ)
        env.update(env_extra or {})
        self.proc = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1, env=env, cwd=cwd,
        )
        self._id = 0
        self.stderr_tail = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stderr(self):
        for line in self.proc.stderr:
            self.stderr_tail.append(line.rstrip())
            del self.stderr_tail[:-40]

    def _send(self, payload):
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def request(self, method, params=None, timeout=120):
        self._id += 1
        rid = self._id
        self._send({"jsonrpc": "2.0", "id": rid, "method": method,
                    "params": params or {}})
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError(
                    "MCP server closed stdout. stderr tail:\n"
                    + "\n".join(self.stderr_tail[-15:]))
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == rid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result")

    def notify(self, method, params=None):
        self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def start(self):
        self.request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "podcast-bulk", "version": "1"},
        })
        self.notify("notifications/initialized")
        return self

    def call_tool(self, name, arguments):
        result = self.request("tools/call", {"name": name, "arguments": arguments})
        text = "\n".join(
            block.get("text", "")
            for block in result.get("content", [])
            if block.get("type") == "text"
        )
        return text, bool(result.get("isError"))

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        self.proc.terminate()


PICKIPEDIA = (
    ["node", "/home/magent/workspace/pickipedia-mcp/dist/index.js"],
    {"CONFIG": "/home/magent/.config/mediawiki-mcp/config.json"},
)
