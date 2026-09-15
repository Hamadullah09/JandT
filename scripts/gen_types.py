"""Generate `frontend/lib/types.gen.ts` from the FastAPI OpenAPI schema.

    python scripts/gen_types.py                 # imports the app, no server needed
    python scripts/gen_types.py --url http://localhost:8000/openapi.json

One schema, two languages (harness rule H9): Pydantic models on the API side
become TypeScript interfaces on the web side, so a field rename cannot silently
diverge.  The output is committed so `npm run build` never needs a live API.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "frontend" / "lib" / "types.gen.ts"

PRIMITIVES = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
    "null": "null",
}


def ts_type(schema: dict[str, Any] | None) -> str:
    """Render one JSON-Schema node as a TypeScript type expression."""
    if not schema:
        return "unknown";

    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]

    if "const" in schema:
        return json.dumps(schema["const"])

    if "enum" in schema:
        return " | ".join(json.dumps(v) for v in schema["enum"])

    for key in ("anyOf", "oneOf"):
        if key in schema:
            parts = [ts_type(s) for s in schema[key]]
            seen: list[str] = []
            for part in parts:
                if part not in seen:
                    seen.append(part)
            return " | ".join(seen)

    if "allOf" in schema:
        parts = [ts_type(s) for s in schema["allOf"]]
        return " & ".join(parts) if parts else "unknown"

    kind = schema.get("type")
    if isinstance(kind, list):
        return " | ".join(PRIMITIVES.get(k, "unknown") for k in kind)

    if kind == "array":
        return f"{ts_type(schema.get('items'))}[]"

    if kind == "object":
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            return f"Record<string, {ts_type(extra)}>"
        if extra is True or extra is None:
            return "Record<string, unknown>"
        return "Record<string, never>"

    if kind in PRIMITIVES:
        # FastAPI renders Decimal as `string` with a `decimal` format; keep it
        # a string so precision survives the round trip.
        return PRIMITIVES[kind]

    return "unknown"


def render_interface(name: str, schema: dict[str, Any]) -> str:
    if "enum" in schema:
        values = " | ".join(json.dumps(v) for v in schema["enum"])
        return f"export type {name} = {values};\n"

    properties: dict[str, Any] = schema.get("properties", {})
    required = set(schema.get("required", []))
    lines = [f"export interface {name} {{"]

    if description := schema.get("description"):
        lines.insert(0, f"/** {description.strip().splitlines()[0]} */")

    if not properties:
        lines.append("  [key: string]: unknown;")

    for prop, node in properties.items():
        optional = "" if prop in required else "?"
        doc = node.get("description")
        if doc:
            lines.append(f"  /** {doc.strip().splitlines()[0]} */")
        lines.append(f"  {prop}{optional}: {ts_type(node)};")

    lines.append("}")
    return "\n".join(lines) + "\n"


def load_schema(url: str | None) -> dict[str, Any]:
    if url:
        import urllib.request

        with urllib.request.urlopen(url, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    sys.path.insert(0, str(REPO / "backend"))
    from app.main import app  # noqa: PLC0415

    return app.openapi()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=None, help="fetch from a running API instead")
    args = parser.parse_args()

    schema = load_schema(args.url)
    components: dict[str, Any] = schema.get("components", {}).get("schemas", {})

    body = [
        "/* eslint-disable */",
        "/**",
        " * GENERATED FILE - do not edit.",
        " *",
        " * Source: FastAPI OpenAPI schema (`app.main:app`).",
        " * Regenerate: python scripts/gen_types.py",
        " */",
        "",
    ]
    for name in sorted(components):
        body.append(render_interface(name, components[name]))

    # RFC 7807 payload, which FastAPI does not model as a component
    body.append(
        "\n".join(
            [
                "/** RFC 7807 problem+json body returned by every error path. */",
                "export interface Problem {",
                "  type: string;",
                "  title: string;",
                "  status: number;",
                "  detail?: string;",
                "  instance?: string;",
                "  row_errors?: RowError[];",
                "}",
                "",
            ]
        )
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(body), encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)} ({len(components)} schemas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
