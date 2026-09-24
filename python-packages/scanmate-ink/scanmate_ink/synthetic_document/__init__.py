"""Synthetic pages and simulated scans, for tests and deployment smoke checks."""

from .draw_label_algorithm import LabelOptions, draw_label, label_size
from .synthetic_document_algorithm import (
    DocumentOptions,
    ScanOptions,
    SimulatedScan,
    SyntheticDocument,
    create_synthetic_document,
    draw_line,
    draw_signature,
    draw_tick,
    fill_rect,
    simulate_scan,
    stroke_rect,
)

__all__ = [
    "DocumentOptions",
    "LabelOptions",
    "ScanOptions",
    "SimulatedScan",
    "SyntheticDocument",
    "create_synthetic_document",
    "draw_label",
    "draw_line",
    "draw_signature",
    "draw_tick",
    "fill_rect",
    "label_size",
    "simulate_scan",
    "stroke_rect",
]
