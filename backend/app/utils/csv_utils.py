"""CSV helpers shared by every export endpoint."""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any, Iterable

from flask import Response


def safe_cell(value: Any) -> str:
    """Neutralise spreadsheet formula injection (cells starting with = + - @)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        # Plain negative numbers are data, not formulas.
        try:
            float(text)
            return text
        except ValueError:
            return "'" + text
    return text


def csv_response(header: list[str], rows: Iterable[Iterable[Any]], stem: str) -> Response:
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(header)
    for row in rows:
        writer.writerow([safe_cell(v) for v in row])
    filename = f"{stem}_{date.today().isoformat()}.csv"
    return Response(
        "﻿" + out.getvalue(), mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
