"""Consistent API error responses and application error handlers."""
from __future__ import annotations

from typing import Any

from flask import Flask, current_app, jsonify
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException


def error_response(status: int, code: str, message: str, details: Any = None):
    return jsonify({"error": {"code": code, "message": message, "details": details}}), status


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ValidationError)
    def handle_validation_error(exc: ValidationError):
        return error_response(400, "validation_error", "Request validation failed", exc.errors())

    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        status = exc.code or 500
        codes = {
            400: "bad_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
            422: "unprocessable_entity",
        }
        message = exc.description if status < 500 else "Internal server error"
        return error_response(status, codes.get(status, "http_error"), message)

    @app.errorhandler(Exception)
    def handle_unexpected_error(exc: Exception):
        # Supabase PostgREST duplicate-key errors expose a stable code/message.
        text = str(exc).lower()
        if "23505" in text and ("usn" in text or "students" in text):
            return error_response(409, "duplicate_usn", "A student with this USN already exists")
        if "remediation_status" in text and ("column" in text or "42703" in text or "pgrst204" in text):
            return error_response(
                500, "schema_outdated",
                "The database is missing students.remediation_status. Run "
                "database/migrations/002_remediation_and_package_tiers.sql in the Supabase SQL editor.")
        if ("relation" in text and "does not exist" in text) or "pgrst205" in text:
            return error_response(500, "schema_missing",
                                  "Database tables are missing. Run database/schema.sql in the Supabase SQL editor.")
        current_app.logger.exception("Unhandled API error")
        details = None
        message = "Internal server error"
        if current_app.debug or current_app.testing:
            details = {"type": type(exc).__name__}
            message = str(exc) or message
        return error_response(500, "internal_server_error", message, details)