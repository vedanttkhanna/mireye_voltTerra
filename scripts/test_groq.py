#!/usr/bin/env python3
"""Minimal Groq connectivity diagnostic for VOLT-TERRA.

Uses only Python's standard library. It reads GROQ_* settings from the
project's .env without printing the API key.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def load_env(path: Path) -> None:
    if not path.exists():
        raise RuntimeError(f"Missing environment file: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(name, value)


def main() -> int:
    load_env(ENV_PATH)
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    model = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b").strip()
    provider = os.environ.get("LLM_PROVIDER", "auto").strip()

    if not api_key:
        print("FAIL: GROQ_API_KEY is empty in .env", file=sys.stderr)
        return 2

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Reply in one short sentence confirming that Groq is reachable.",
            }
        ],
        "temperature": 0,
        "max_completion_tokens": 256,
    }
    request = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "volt-terra-groq-diagnostic/1.0",
        },
    )

    print(f"Provider setting: {provider}")
    print(f"Groq model: {model}")
    print(f"API key present: yes (length {len(api_key)}, prefix valid: {api_key.startswith('gsk_')})")

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = response.status
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        retry_after = error.headers.get("Retry-After")
        print(f"FAIL: Groq returned HTTP {error.code}", file=sys.stderr)
        if retry_after:
            print(f"Retry-After: {retry_after}", file=sys.stderr)
        try:
            parsed = json.loads(body)
            print(json.dumps(parsed.get("error", parsed), indent=2), file=sys.stderr)
        except json.JSONDecodeError:
            print(body[:1000], file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"FAIL: Network request failed: {error}", file=sys.stderr)
        return 1

    message = data.get("choices", [{}])[0].get("message", {})
    answer = message.get("content") or message.get("reasoning") or "<empty response>"
    usage = data.get("usage", {})

    print(f"HTTP status: {status}")
    print(f"Returned model: {data.get('model', model)}")
    print(f"Response: {answer.strip()}")
    print(
        "Tokens: "
        f"prompt={usage.get('prompt_tokens', 'unknown')}, "
        f"completion={usage.get('completion_tokens', 'unknown')}"
    )
    print("PASS: Groq authentication and completion request succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
